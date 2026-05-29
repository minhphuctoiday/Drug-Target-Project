from __future__ import annotations

import argparse
from dataclasses import dataclass

from pyspark.ml import Pipeline
from pyspark.ml.clustering import KMeans
from pyspark.ml.feature import Imputer, StandardScaler, VectorAssembler
from pyspark.sql import SparkSession, Window
from pyspark.sql import functions as F


@dataclass
class Paths:
    refined_root: str
    outputs_root: str
    checkpoint_root: str


def build_spark(app_name: str) -> SparkSession:
    return (
        SparkSession.builder.appName(app_name)
        .config("spark.sql.adaptive.enabled", "true")
        .config("spark.sql.parquet.compression.codec", "snappy")
        .getOrCreate()
    )


def minmax(col_name: str) -> F.Column:
    return F.coalesce(F.col(col_name), F.lit(0.0))


def run_da_ml_pipeline(spark: SparkSession, paths: Paths) -> None:
    """Cluster-ready DA/ML stage derived from notebooks/DA&ML_onColab.ipynb.

    The Colab notebook remains the canonical executed version currently stored
    in the repository. This script expresses the same target-prioritization
    intent as a Spark/HDFS entrypoint for a real 5-node run.
    """

    spark.sparkContext.setCheckpointDir(paths.checkpoint_root)

    gdc = spark.read.parquet(f"{paths.refined_root}/gdc/annotate.parquet")
    geo = spark.read.parquet(f"{paths.refined_root}/geo/annotate.parquet")
    nodes = spark.read.parquet(f"{paths.refined_root}/STRING/nodes_gene.parquet")

    gdc_expr = (
        gdc.withColumn("gene_name_norm", F.upper(F.trim(F.col("gene_name"))))
        .withColumn("log2_tpm", F.log2(F.col("tpm_unstranded").cast("double") + F.lit(1.0)))
        .groupBy("gene_name_norm")
        .pivot("sample_type", ["tumor", "normal"])
        .agg(F.avg("log2_tpm"))
        .withColumnRenamed("tumor", "tumor_mean_log2_tpm")
        .withColumnRenamed("normal", "normal_mean_log2_tpm")
        .withColumn("gdc_log2_fc", F.col("tumor_mean_log2_tpm") - F.col("normal_mean_log2_tpm"))
        .withColumn("gdc_abs_log2_fc", F.abs(F.col("gdc_log2_fc")))
    )

    geo_signal = (
        geo.withColumn("gene_name_norm", F.upper(F.trim(F.col("Gene_Symbol"))))
        .withColumn("Expression_Value", F.col("Expression_Value").cast("double"))
        .groupBy("gene_name_norm")
        .agg(F.stddev("Expression_Value").alias("geo_stage_signal"))
        .withColumn(
            "geo_validation_status",
            F.when(F.col("geo_stage_signal") > 0, F.lit("validated")).otherwise(F.lit("missing_geo")),
        )
    )

    ppi = (
        nodes.withColumn("gene_name_norm", F.upper(F.trim(F.col("gene_name_norm"))))
        .select(
            "gene_name_norm",
            F.col("degree_gene").cast("double"),
            F.col("weighted_degree_gene").cast("double"),
        )
    )

    master = (
        gdc_expr.join(geo_signal, "gene_name_norm", "left")
        .join(ppi, "gene_name_norm", "left")
        .fillna({"geo_validation_status": "missing_geo", "degree_gene": 0.0, "weighted_degree_gene": 0.0})
        .withColumn("expression_component", F.least(F.col("gdc_abs_log2_fc") / F.lit(5.0), F.lit(1.0)))
        .withColumn("network_component", F.least(F.log1p(F.col("degree_gene")) / F.lit(8.0), F.lit(1.0)))
        .withColumn(
            "validation_component",
            F.when(F.col("geo_validation_status") == "validated", F.lit(1.0)).otherwise(F.lit(0.0)),
        )
        .withColumn(
            "target_score",
            F.lit(0.56) * minmax("expression_component")
            + F.lit(0.26) * minmax("network_component")
            + F.lit(0.18) * minmax("validation_component"),
        )
    )

    rank_window = Window.orderBy(F.col("target_score").desc(), F.col("gdc_abs_log2_fc").desc())
    master = master.withColumn("target_rank", F.row_number().over(rank_window))
    master.write.mode("overwrite").parquet(f"{paths.outputs_root}/master_biomarker_features.parquet")
    master.orderBy("target_rank").limit(200).coalesce(1).write.mode("overwrite").option("header", True).csv(
        f"{paths.outputs_root}/top_drug_targets_csv"
    )

    feature_cols = [
        "gdc_abs_log2_fc",
        "degree_gene",
        "weighted_degree_gene",
        "expression_component",
        "network_component",
        "validation_component",
        "target_score",
    ]
    assembler = VectorAssembler(inputCols=feature_cols, outputCol="raw_features", handleInvalid="keep")
    imputer = Imputer(inputCols=feature_cols, outputCols=[f"{c}_imputed" for c in feature_cols])
    assembled_cols = [f"{c}_imputed" for c in feature_cols]
    vector = VectorAssembler(inputCols=assembled_cols, outputCol="features_unscaled", handleInvalid="keep")
    scaler = StandardScaler(inputCol="features_unscaled", outputCol="features")
    kmeans = KMeans(k=12, seed=42, featuresCol="features", predictionCol="protein_target_cluster")
    pipeline = Pipeline(stages=[imputer, vector, scaler, kmeans])
    model = pipeline.fit(master.select("gene_name_norm", *feature_cols))
    clustered = model.transform(master.select("gene_name_norm", *feature_cols))

    ranking = (
        master.join(clustered.select("gene_name_norm", "protein_target_cluster"), "gene_name_norm", "left")
        .withColumn("protein_ml_priority_score", F.col("target_score"))
        .withColumn("protein_ml_rank", F.row_number().over(Window.orderBy(F.col("protein_ml_priority_score").desc())))
    )
    ranking.write.mode("overwrite").parquet(f"{paths.outputs_root}/ml_models/protein_target_ranking.parquet")

    summary = spark.createDataFrame(
        [
            ("n_targets", ranking.count()),
            ("n_features", len(feature_cols)),
            ("n_clusters", 12),
        ],
        ["metric", "value"],
    )
    summary.coalesce(1).write.mode("overwrite").json(f"{paths.outputs_root}/ml_models/protein_target_ranker_summary_json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Distributed DA/ML pipeline for LUAD protein target ranking.")
    parser.add_argument("--refined-root", required=True)
    parser.add_argument("--outputs-root", required=True)
    parser.add_argument("--checkpoint-root", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    spark = build_spark("DrugTarget-DA-ML-Protein-Ranking")
    try:
        run_da_ml_pipeline(spark, Paths(args.refined_root, args.outputs_root, args.checkpoint_root))
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
