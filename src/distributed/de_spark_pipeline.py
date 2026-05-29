from __future__ import annotations

import argparse
from dataclasses import dataclass

from pyspark.sql import SparkSession
from pyspark.sql import functions as F


@dataclass
class Paths:
    raw_root: str
    refined_root: str
    checkpoint_root: str


def build_spark(app_name: str) -> SparkSession:
    return (
        SparkSession.builder.appName(app_name)
        .config("spark.sql.adaptive.enabled", "true")
        .config("spark.sql.parquet.compression.codec", "snappy")
        .getOrCreate()
    )


def normalize_gene_name(column: str) -> F.Column:
    return F.upper(F.trim(F.regexp_replace(F.col(column), r"[^A-Za-z0-9_-]", "")))


def run_de_pipeline(spark: SparkSession, paths: Paths) -> None:
    """Cluster-ready DE stage derived from notebooks/DE_onColab.ipynb.

    This entrypoint is intentionally conservative: it validates and materializes
    the core refined artifacts expected by the downstream DA/ML stage. The
    executed Colab notebook remains the canonical completed run in this repo.
    """

    spark.sparkContext.setCheckpointDir(paths.checkpoint_root)

    gdc_counts = spark.read.parquet(f"{paths.refined_root}/gdc_counts_clean.parquet")
    gdc_sample_case = spark.read.parquet(f"{paths.refined_root}/gdc_sample_case_clean.parquet")

    gdc_annotate = (
        gdc_counts.join(gdc_sample_case, on="file_id", how="left")
        .withColumn("gene_name_norm", normalize_gene_name("gene_name"))
        .withColumn("tpm_unstranded", F.col("tpm_unstranded").cast("double"))
        .repartition(64, "gene_name_norm")
    )
    gdc_annotate.write.mode("overwrite").parquet(f"{paths.refined_root}/gdc/annotate.parquet")

    geo_expr = spark.read.parquet(f"{paths.refined_root}/geo_expr_long.parquet")
    geo_meta = spark.read.parquet(f"{paths.refined_root}/geo_meta_clean.parquet")
    geo_annotate = (
        geo_expr.join(geo_meta, on="Patient_ID", how="left")
        .withColumn("Gene_Symbol", normalize_gene_name("Gene_Symbol"))
        .withColumn("Expression_Value", F.col("Expression_Value").cast("double"))
        .repartition(48, "Gene_Symbol")
    )
    geo_annotate.write.mode("overwrite").parquet(f"{paths.refined_root}/geo/annotate.parquet")

    gene_map = spark.read.parquet(f"{paths.refined_root}/STRING/gene_map.parquet")
    edges = spark.read.parquet(f"{paths.refined_root}/STRING/edges_gene.parquet")
    nodes = spark.read.parquet(f"{paths.refined_root}/STRING/nodes_gene.parquet")

    # Lightweight distributed QC manifests for cluster runs.
    qc_rows = [
        ("gdc_annotate_rows", gdc_annotate.count()),
        ("gdc_distinct_genes", gdc_annotate.select("gene_name_norm").distinct().count()),
        ("geo_annotate_rows", geo_annotate.count()),
        ("geo_distinct_genes", geo_annotate.select("Gene_Symbol").distinct().count()),
        ("string_gene_map_rows", gene_map.count()),
        ("string_edges_rows", edges.count()),
        ("string_nodes_rows", nodes.count()),
    ]
    qc = spark.createDataFrame(qc_rows, ["metric", "value"])
    qc.coalesce(1).write.mode("overwrite").json(f"{paths.refined_root}/_qc/de_cluster_qc")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Distributed DE pipeline for LUAD drug target project.")
    parser.add_argument("--raw-root", required=True)
    parser.add_argument("--refined-root", required=True)
    parser.add_argument("--checkpoint-root", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    spark = build_spark("DrugTarget-DE-Refined-Lake")
    try:
        run_de_pipeline(spark, Paths(args.raw_root, args.refined_root, args.checkpoint_root))
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
