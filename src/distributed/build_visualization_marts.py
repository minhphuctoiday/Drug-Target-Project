from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


DEFAULT_HDFS_BASE = "hdfs://master11:9000/drugtarget/data"


def clean_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (int, str, bool)):
        return value
    return value


def row_to_dict(row: Any) -> dict[str, Any]:
    return {key: clean_value(value) for key, value in row.asDict(recursive=True).items()}


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def collect_items(df: Any, limit: int | None = None) -> list[dict[str, Any]]:
    if limit is not None:
        df = df.limit(limit)
    return [row_to_dict(row) for row in df.collect()]


def neg_log10_expr(F: Any, column: str, cap: float = 300.0) -> Any:
    return F.when(F.col(column).isNull(), None).when(F.col(column) <= 0, cap).otherwise(-F.log10(F.col(column)))


def histogram(df: Any, F: Any, column: str, bins: list[float], count_key: str, group_key: str | None = None) -> dict[str, Any]:
    parts = []
    for start, end in zip(bins, bins[1:]):
        condition = (F.col(column) >= F.lit(start)) & (F.col(column) < F.lit(end))
        if group_key:
            rows = (
                df.filter(condition)
                .groupBy(group_key)
                .agg(F.count("*").alias(count_key))
                .withColumn("bin_start", F.lit(start))
                .withColumn("bin_end", F.lit(end))
                .select("bin_start", "bin_end", group_key, count_key)
            )
        else:
            rows = df.filter(condition).agg(F.count("*").alias(count_key)).withColumn("bin_start", F.lit(start)).withColumn("bin_end", F.lit(end)).select("bin_start", "bin_end", count_key)
        parts.extend(collect_items(rows))
    return {"items": parts, "source_column": column, "bins": bins}


def build_real_marts(output_dir: Path, hdfs_base: str) -> None:
    from pyspark.sql import SparkSession, functions as F

    spark = SparkSession.builder.appName("drugtarget-build-real-visualization-marts").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    paths = {
        "qc": f"{hdfs_base}/refined/gdc/quality_check",
        "expr": f"{hdfs_base}/analysis/gdc_qc_pass_expression",
        "deg": f"{hdfs_base}/analysis/gdc_deg_result",
        "mapped": f"{hdfs_base}/analysis/deg_mapped_proteins",
        "network_features": f"{hdfs_base}/analysis/protein_network_features",
        "candidate_features": f"{hdfs_base}/analysis/candidate_target_features",
        "top_targets": f"{hdfs_base}/mart/top_candidate_targets",
        "top_enriched": f"{hdfs_base}/mart/top_candidate_targets_enriched",
        "geo_result": f"{hdfs_base}/analysis/geo_validation_result",
        "geo_summary": f"{hdfs_base}/analysis/geo_validation_summary",
        "geo_supported": f"{hdfs_base}/analysis/geo_supported_top_candidates",
        "candidate_clusters": f"{hdfs_base}/analysis/candidate_clusters",
        "ml_k": f"{hdfs_base}/analysis/ml_k_selection",
        "ml_summary": f"{hdfs_base}/analysis/ml_cluster_summary",
        "edges": f"{hdfs_base}/refined/STRING/edges_protein",
    }

    qc = spark.read.parquet(paths["qc"]).cache()
    expr = spark.read.parquet(paths["expr"])
    deg = spark.read.parquet(paths["deg"]).cache()
    mapped = spark.read.parquet(paths["mapped"]).cache()
    network_features = spark.read.parquet(paths["network_features"])
    candidate_features = spark.read.parquet(paths["candidate_features"]).cache()
    mapped_confidence = mapped.select("protein_id", "gene_confidence").dropDuplicates(["protein_id"])
    top_enriched = spark.read.parquet(paths["top_enriched"]).join(mapped_confidence, on="protein_id", how="left").cache()
    geo_result = spark.read.parquet(paths["geo_result"]).cache()
    geo_summary = spark.read.parquet(paths["geo_summary"])
    geo_supported = spark.read.parquet(paths["geo_supported"]).cache()
    clusters = spark.read.parquet(paths["candidate_clusters"]).cache()
    ml_k = spark.read.parquet(paths["ml_k"])
    ml_summary = spark.read.parquet(paths["ml_summary"]).cache()
    edges = spark.read.parquet(paths["edges"])

    passed_qc = ~(F.col("is_outlier_library_size") | F.col("is_outlier_detected_genes"))
    qc_counts = (
        qc.groupBy("sample_group")
        .agg(
            F.count("*").cast("long").alias("samples_before_qc"),
            F.sum(passed_qc.cast("int")).cast("long").alias("samples_after_qc"),
        )
        .withColumn("samples_removed", F.col("samples_before_qc") - F.col("samples_after_qc"))
        .orderBy("sample_group")
    )
    qc_exclusions = (
        qc.filter(~passed_qc)
        .withColumn(
            "exclusion_reason",
            F.when(F.col("is_outlier_library_size") & F.col("is_outlier_detected_genes"), F.lit("Both library size and detected genes outlier"))
            .when(F.col("is_outlier_library_size"), F.lit("Library size outlier"))
            .when(F.col("is_outlier_detected_genes"), F.lit("Detected genes outlier"))
            .otherwise(F.lit("Other QC exclusion")),
        )
        .groupBy("exclusion_reason")
        .agg(F.count("*").cast("long").alias("sample_count"))
        .orderBy(F.desc("sample_count"))
    )

    deg_plot = (
        deg.withColumn("minus_log10_p_value", neg_log10_expr(F, "p_value"))
        .withColumn(
            "plot_minus_log10_p_value",
            F.when(F.col("minus_log10_p_value").isNull(), None).otherwise(F.least(F.col("minus_log10_p_value"), F.lit(60.0))),
        )
        .select(
            "gene_name",
            "gene_id_base",
            "log2FC",
            "p_value",
            "minus_log10_p_value",
            "plot_minus_log10_p_value",
            "deg_direction",
            "is_deg",
        )
    )
    deg_summary = (
        deg.withColumn("display_direction", F.when(F.col("is_deg") == F.lit(False), F.lit("Not significant")).otherwise(F.col("deg_direction")))
        .groupBy("display_direction")
        .agg(F.count("*").cast("long").alias("gene_count"))
        .withColumnRenamed("display_direction", "deg_direction")
    )
    top_deg = (
        deg.filter(F.col("is_deg") == F.lit(True))
        .withColumn("abs_log2FC", F.abs(F.col("log2FC")))
        .orderBy(F.desc("abs_log2FC"))
        .select("gene_name", "gene_id_base", "log2FC", "abs_log2FC", "p_value", "deg_direction")
    )

    deg_total = deg.filter(F.col("is_deg") == F.lit(True)).count()
    mapped_total = mapped.select("gene_id_base").distinct().count()
    unmapped = (
        deg.filter(F.col("is_deg") == F.lit(True))
        .join(mapped.select("gene_id_base").distinct(), on="gene_id_base", how="left_anti")
        .withColumn("abs_log2FC", F.abs(F.col("log2FC")))
        .orderBy(F.desc("abs_log2FC"))
        .withColumn("mapping_status", F.lit("Not mapped"))
        .withColumn("mapping_reason", F.lit("No matching STRING protein_id in refined STRING gene_map for this DEG."))
        .select("gene_name", "gene_id_base", "log2FC", "p_value", "mapping_status", "mapping_reason")
    )
    mapping_summary = {
        "items": [
            {"mapping_status": "Mapped to STRING protein", "gene_count": mapped_total, "percentage": (mapped_total / deg_total * 100) if deg_total else 0},
            {"mapping_status": "Not mapped", "gene_count": max(deg_total - mapped_total, 0), "percentage": (max(deg_total - mapped_total, 0) / deg_total * 100) if deg_total else 0},
        ],
        "source": {"deg_total": deg_total, "mapped_distinct_genes": mapped_total},
    }
    mapping_confidence = (
        mapped.groupBy("gene_confidence")
        .agg(F.countDistinct("protein_id").cast("long").alias("number_of_proteins"))
        .orderBy("gene_confidence")
    )

    top_nodes = (
        top_enriched.orderBy("rank")
        .select(
            "protein_id",
            "ensp_id",
            "gene_name",
            "rank",
            "final_score",
            "log2FC",
            "p_value",
            "deg_direction",
            "degree_protein",
            "weighted_degree_protein",
            "num_interactions_in_deg_network",
            "avg_combined_score",
            "cluster_id",
            "candidate_group",
            "geo_match_status",
            "geo_coverage_rate",
            "geo_mean_percentile",
            "geo_top_quartile_rate",
            "geo_support_score",
            "geo_support_level",
            "gene_confidence",
        )
        .withColumn("node_size", F.least(F.lit(26.0), F.lit(7.0) + F.log1p(F.col("weighted_degree_protein")) * F.lit(2.2)))
        .cache()
    )
    top_ids = top_nodes.select(F.col("protein_id").alias("candidate_protein_id"))
    edge_nodes_src = top_ids.withColumnRenamed("candidate_protein_id", "protein_id_src")
    edge_nodes_dst = top_ids.withColumnRenamed("candidate_protein_id", "protein_id_dst")
    ppi_edges = (
        edges.join(F.broadcast(edge_nodes_src), on="protein_id_src", how="inner")
        .join(F.broadcast(edge_nodes_dst), on="protein_id_dst", how="inner")
        .filter(F.col("edge_weight_protein") >= F.lit(0.4))
        .join(top_nodes.select(F.col("protein_id").alias("protein_id_src"), F.col("gene_name").alias("gene_name_src")), on="protein_id_src", how="left")
        .join(top_nodes.select(F.col("protein_id").alias("protein_id_dst"), F.col("gene_name").alias("gene_name_dst")), on="protein_id_dst", how="left")
        .select("protein_id_src", "protein_id_dst", "gene_name_src", "gene_name_dst", "combined_score_protein", "edge_weight_protein")
        .cache()
    )
    score_dist = histogram(ppi_edges, F, "edge_weight_protein", [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01], "number_of_edges")
    top_targets = top_enriched.orderBy("rank").select(
        "rank",
        "gene_name",
        "gene_id_base",
        "protein_id",
        "ensp_id",
        "log2FC",
        "p_value",
        "deg_direction",
        "degree_protein",
        "weighted_degree_protein",
        "num_interactions_in_deg_network",
        "avg_combined_score",
        "expression_score",
        "protein_network_score",
        "string_confidence_score",
        "final_score",
        "geo_validation_mode",
        "geo_match_status",
        "geo_num_samples_available",
        "geo_total_samples",
        "geo_coverage_rate",
        "geo_mean_expression",
        "geo_median_expression",
        "geo_mean_percentile",
        "geo_top_quartile_rate",
        "geo_support_score",
        "geo_support_level",
        "cluster_id",
        "candidate_group",
        "gene_confidence",
    )

    geo_summary_count = geo_summary.agg(F.sum("candidate_count").alias("total")).first()["total"] or 0
    geo_summary_payload = {
        "mode": "tumor_cohort_expression_support",
        "description": "GEO contains tumor samples only. Support metrics summarize expression coverage and within-cohort expression percentile; they do not re-rank GDC + STRING candidates.",
        "items": [
            {
                "geo_support_level": row["geo_support_level"],
                "count": row["candidate_count"],
                "percentage": row["candidate_percentage"] if row["candidate_percentage"] is not None else ((row["candidate_count"] / geo_summary_count * 100) if geo_summary_count else 0),
            }
            for row in geo_summary.collect()
        ],
    }
    geo_unmatched = (
        geo_result.filter(F.col("geo_support_level") == F.lit("Not Found"))
        .orderBy("rank")
        .select("rank", "gene_name", "protein_id", "final_score", "geo_validation_mode", "geo_match_status", "geo_support_level")
    )
    geo_top_supported = (
        geo_supported
        .orderBy("geo_support_rank")
        .select(
            "geo_support_rank",
            "rank",
            "gene_name",
            "protein_id",
            "ensp_id",
            "final_score",
            "geo_coverage_rate",
            "geo_mean_percentile",
            "geo_top_quartile_rate",
            "geo_support_score",
            "geo_support_level",
        )
    )
    geo_support_scatter = (
        geo_result
        .orderBy("rank")
        .select(
            "rank",
            "gene_name",
            "protein_id",
            "final_score",
            "geo_support_score",
            "geo_support_level",
            "geo_coverage_rate",
            "geo_mean_expression",
            "geo_median_expression",
            "geo_mean_percentile",
            "geo_top_quartile_rate",
        )
    )
    geo_overlap = (
        geo_result
        .orderBy("rank")
        .select(
            "rank",
            "gene_name",
            "protein_id",
            "final_score",
            "geo_match_status",
            "geo_num_samples_available",
            "geo_total_samples",
            "geo_coverage_rate",
            "geo_mean_expression",
            "geo_median_expression",
            "geo_mean_percentile",
            "geo_top_quartile_rate",
            "geo_support_score",
            "geo_support_level",
        )
    )

    ml_points = clusters.select(
        "gene_name",
        "protein_id",
        "ensp_id",
        "abs_log2FC",
        "weighted_degree_protein",
        "avg_combined_score",
        "num_interactions_in_deg_network",
        "final_score",
        "cluster_id",
        "candidate_group",
    )
    cluster_summary = ml_summary.orderBy("cluster_id")

    sample_ids = []
    for group in ["tumor", "normal"]:
        sample_ids.extend([row["sample_id"] for row in expr.filter(F.col("sample_group") == group).select("sample_id").distinct().limit(32).collect()])
    heatmap_genes = [row["gene_name"] for row in top_deg.select("gene_name").limit(24).collect()]
    heatmap_rows = (
        expr.filter(F.col("sample_id").isin(sample_ids) & F.col("gene_name").isin(heatmap_genes))
        .select("gene_name", "sample_id", "sample_group", "log2_tpm")
        .collect()
    )
    heatmap_lookup = {(row["gene_name"], row["sample_id"]): clean_value(row["log2_tpm"]) for row in heatmap_rows}
    sample_groups = {}
    for row in heatmap_rows:
        sample_groups[row["sample_id"]] = row["sample_group"]
    heatmap_payload = {
        "genes": heatmap_genes,
        "samples": sample_ids,
        "sample_groups": [sample_groups.get(sample, "unknown") for sample in sample_ids],
        "matrix": [[heatmap_lookup.get((gene, sample)) for sample in sample_ids] for gene in heatmap_genes],
        "value_label": "log2 TPM from Phase 1 QC-passed expression",
        "source": paths["expr"],
    }

    qc_counts_items = collect_items(qc_counts)
    tumor_after = sum(row["samples_after_qc"] for row in qc_counts_items if str(row["sample_group"]).lower() == "tumor")
    normal_after = sum(row["samples_after_qc"] for row in qc_counts_items if str(row["sample_group"]).lower() == "normal")
    supported_geo = sum(item["count"] for item in geo_summary_payload["items"] if item["geo_support_level"] != "Not Found")
    ppi_edge_count = ppi_edges.count()
    overview_payload = {
        "metrics": [
            {"metric_name": "GDC samples before QC", "metric_value": sum(row["samples_before_qc"] for row in qc_counts_items), "metric_unit": "samples", "phase_name": "Overview", "description": "Rows in refined GDC quality_check before removing QC outliers."},
            {"metric_name": "GDC samples after QC", "metric_value": sum(row["samples_after_qc"] for row in qc_counts_items), "metric_unit": "samples", "phase_name": "Phase 1", "description": "Samples passing library-size and detected-gene QC flags."},
            {"metric_name": "Tumor samples", "metric_value": tumor_after, "metric_unit": "samples", "phase_name": "Phase 1", "description": "Tumor samples retained after QC."},
            {"metric_name": "Normal samples", "metric_value": normal_after, "metric_unit": "samples", "phase_name": "Phase 1", "description": "Normal samples retained after QC."},
            {"metric_name": "Differentially expressed genes", "metric_value": deg_total, "metric_unit": "genes", "phase_name": "Phase 2", "description": "Genes where Phase 2 is_deg is true."},
            {"metric_name": "DEG mapped to proteins", "metric_value": mapped_total, "metric_unit": "genes", "phase_name": "Phase 3", "description": "Distinct DEG genes with STRING protein_id mapping."},
            {"metric_name": "Protein candidates", "metric_value": candidate_features.count(), "metric_unit": "proteins", "phase_name": "Phase 5", "description": "Candidate protein rows scored by Phase 5."},
            {"metric_name": "PPI edges in top-target graph", "metric_value": ppi_edge_count, "metric_unit": "edges", "phase_name": "Phase 4", "description": "STRING edges among top targets with edge_weight_protein >= 0.4."},
            {"metric_name": "Top candidate targets", "metric_value": top_enriched.count(), "metric_unit": "targets", "phase_name": "Phase 5", "description": "Rows in HDFS mart/top_candidate_targets_enriched."},
            {"metric_name": "Candidates with GEO support", "metric_value": supported_geo, "metric_unit": "targets", "phase_name": "Phase 6", "description": "Top targets with GEO tumor-cohort expression support metrics."},
            {"metric_name": "ML clusters", "metric_value": cluster_summary.count(), "metric_unit": "clusters", "phase_name": "Phase 7", "description": "Clusters in analysis/ml_cluster_summary."},
        ],
        "pipeline": ["GDC samples", "QC", "Protein-coding expression", "DEG", "Differentially expressed genes", "Gene to STRING protein mapping", "STRING PPI edges", "Network features", "Scoring", "Top candidate targets", "GEO tumor-cohort support + ML clustering"],
        "summary": "Dashboard built from real HDFS phase outputs. Overview is a navigation summary, not an analysis phase.",
        "source": paths,
    }

    outputs = {
        "overview_summary": overview_payload,
        "qc_sample_counts": {"items": qc_counts_items, "source": paths["qc"], "x_axis": "sample_group", "y_axis": "number of samples"},
        "qc_exclusion_summary": {"items": collect_items(qc_exclusions), "source": paths["qc"], "x_axis": "QC exclusion reason", "y_axis": "number of excluded samples"},
        "qc_library_size": histogram(qc, F, "total_raw_count", [0, 25_000_000, 50_000_000, 75_000_000, 100_000_000, 150_000_000, 250_000_000], "number_of_samples", "sample_group"),
        "qc_zero_gene_rate": histogram(qc, F, "pct_zero_genes", [0.0, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0], "number_of_samples", "sample_group"),
        "volcano_points": {"items": collect_items(deg_plot), "source": paths["deg"], "x_axis": "log2FC", "y_axis": "-log10(p_value), capped at 60 for plotting when p_value underflows to 0"},
        "deg_summary": {"items": collect_items(deg_summary), "source": paths["deg"], "x_axis": "DEG status", "y_axis": "number of genes"},
        "top_deg_genes": {"items": collect_items(top_deg, 50), "source": paths["deg"], "x_axis": "absolute log2FC", "y_axis": "gene_name"},
        "deg_heatmap_matrix": heatmap_payload,
        "gene_protein_mapping_summary": mapping_summary,
        "gene_protein_mapping_confidence": {"items": collect_items(mapping_confidence), "source": paths["mapped"]},
        "mapping_unmapped_genes": {"items": collect_items(unmapped, 100), "source": {"deg": paths["deg"], "mapped": paths["mapped"]}},
        "ppi_visualization_nodes": {"items": collect_items(top_nodes, 100), "source": paths["top_enriched"]},
        "ppi_visualization_edges": {"items": collect_items(ppi_edges), "source": paths["edges"], "edge_filter": "edge_weight_protein >= 0.4 and both proteins are in top_candidate_targets_enriched"},
        "network_top_proteins": {"items": collect_items(top_nodes.orderBy(F.desc("weighted_degree_protein")), 100), "source": paths["top_enriched"]},
        "network_score_distribution": {**score_dist, "source": paths["edges"], "x_axis": "edge_weight_protein (STRING combined_score / 1000)", "y_axis": "number of top-target PPI edges"},
        "top_candidate_targets_enriched": {"items": collect_items(top_targets), "source": paths["top_enriched"]},
        "geo_validation_summary": geo_summary_payload,
        "geo_unmatched_candidates": {"items": collect_items(geo_unmatched), "source": paths["geo_result"]},
        "geo_supported_top_candidates": {"items": collect_items(geo_top_supported, 100), "source": paths["geo_supported"]},
        "geo_gdc_vs_support_scatter": {"items": collect_items(geo_support_scatter, 100), "source": paths["geo_result"]},
        "geo_top_candidate_overlap": {"items": collect_items(geo_overlap, 100), "source": paths["geo_result"]},
        "geo_expression_availability": {"items": collect_items(geo_overlap, 100), "source": paths["geo_result"]},
        "ml_k_selection": {"items": collect_items(ml_k.orderBy("k")), "source": paths["ml_k"]},
        "ml_cluster_points": {"items": collect_items(ml_points), "source": paths["candidate_clusters"]},
        "ml_cluster_summary": {"items": collect_items(cluster_summary), "source": paths["ml_summary"]},
        "ml_clusters": {"items": collect_items(cluster_summary), "source": paths["ml_summary"]},
    }

    for name, payload in outputs.items():
        write_json(output_dir / f"{name}.json", payload)
    print(f"Wrote {len(outputs)} real visualization mart snapshots to {output_dir}")
    spark.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build dashboard visualization marts from real HDFS phase outputs. This job only reads HDFS and writes local JSON snapshots.")
    parser.add_argument("--hdfs-base", default=DEFAULT_HDFS_BASE)
    parser.add_argument("--output-dir", type=Path, default=Path("data/mart"))
    args = parser.parse_args()
    build_real_marts(args.output_dir.resolve(), args.hdfs_base.rstrip("/"))


if __name__ == "__main__":
    main()
