from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .repository import MartRepository
from .settings import FRONTEND_DIR, settings


app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_repository = MartRepository(
    mart_dir=settings.mart_dir,
    mongodb_enabled=settings.mongodb_enabled,
    mongodb_uri=settings.mongodb_uri,
    mongodb_db=settings.mongodb_db,
)

CLUSTER_INTERPRETATIONS = {
    0: "Biểu hiện mạnh, mạng cân bằng",
    1: "Thiên về biểu hiện, mạng thấp",
    2: "Protein hub, mạng tương tác mạnh",
}

ML_FEATURES = [
    {"key": "abs_log2FC", "model_key": "abs_log2FC", "label": "|log2FC|", "meaning": "Độ lớn thay đổi expression giữa Tumor và Normal."},
    {"key": "weighted_degree_protein", "model_key": "log1p(weighted_degree_protein)", "label": "Weighted degree", "meaning": "Tổng trọng số kết nối STRING của protein; mô hình dùng log1p trước khi scale."},
    {"key": "avg_combined_score", "model_key": "avg_combined_score", "label": "Avg STRING score", "meaning": "Độ tin cậy STRING trung bình của các tương tác."},
    {"key": "num_interactions_in_deg_network", "model_key": "log1p(num_interactions_in_deg_network)", "label": "DEG interactions", "meaning": "Số tương tác trong mạng DEG; mô hình dùng log1p trước khi scale."},
]


def unavailable_mart(name: str) -> dict[str, Any]:
    return {
        "available": False,
        "items": [],
        "message": f"Mart `{name}` is not available. Run the real HDFS mart builder with spark-submit; no mock fallback is used.",
    }


def mart(name: str) -> Any:
    loaded = _repository.read(name)
    return loaded if loaded is not None else unavailable_mart(name)


def item_list(name: str) -> list[dict[str, Any]]:
    data = mart(name)
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    if isinstance(data, list):
        return data
    return []


def target_rows() -> list[dict[str, Any]]:
    return item_list("top_candidate_targets_enriched")


def normalize_gene_key(value: Any) -> str:
    return str(value or "").strip().upper()


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def cluster_interpretation(cluster_id: Any) -> str:
    try:
        key = int(cluster_id)
    except (TypeError, ValueError):
        return "Chưa có diễn giải"
    return CLUSTER_INTERPRETATIONS.get(key, f"Cluster {key}")


def enrich_cluster_row(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "cluster_interpretation": cluster_interpretation(row.get("cluster_id"))}


def median_value(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2


def find_target(protein_id: str) -> dict[str, Any]:
    token = protein_id.upper()
    for row in target_rows():
        values = [row.get("protein_id"), row.get("gene_name"), row.get("ensp_id")]
        if any(value and str(value).upper() == token for value in values):
            return row
    raise HTTPException(status_code=404, detail="Candidate protein target not found in real mart data")


def filtered_targets(
    limit: int,
    offset: int,
    search: str | None,
    cluster_id: int | None,
    candidate_group: str | None,
    geo_support_level: str | None,
    deg_direction: str | None,
    min_final_score: float | None,
    geo_validation_status: str | None = None,
) -> dict[str, Any]:
    rows = target_rows()
    if search:
        term = search.upper()
        rows = [row for row in rows if term in str(row.get("gene_name", "")).upper() or term in str(row.get("protein_id", "")).upper() or term in str(row.get("ensp_id", "")).upper()]
    if cluster_id is not None:
        rows = [row for row in rows if row.get("cluster_id") is not None and int(row["cluster_id"]) == cluster_id]
    if candidate_group:
        rows = [row for row in rows if candidate_group.lower() in str(row.get("candidate_group", "")).lower()]
    support_filter = geo_support_level or geo_validation_status
    if support_filter:
        rows = [row for row in rows if str(row.get("geo_support_level", "")).lower() == support_filter.lower()]
    if deg_direction:
        rows = [row for row in rows if str(row.get("deg_direction", "")).lower() == deg_direction.lower()]
    if min_final_score is not None:
        rows = [row for row in rows if row.get("final_score") is not None and float(row["final_score"]) >= min_final_score]
    rows = sorted(rows, key=lambda row: row.get("rank") or 10**9)
    return {"items": [enrich_cluster_row(row) for row in rows[offset : offset + limit]], "total": len(rows), "limit": limit, "offset": offset, "source": "real_mart"}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/pipeline")
def pipeline_page() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/{asset_name}")
def frontend_asset(asset_name: str) -> FileResponse:
    if asset_name not in {"app.js", "styles.css"}:
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(FRONTEND_DIR / asset_name)


@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "app": settings.app_name,
        "api_version": "v1",
        "mart_source": _repository.source_label,
        "mart_dir": str(settings.mart_dir),
        "mongodb_enabled": settings.mongodb_enabled,
        "ai_mode": "ui_only_placeholder",
        "mock_data": False,
    }


@app.get("/api/health")
def legacy_health() -> dict[str, Any]:
    return health()


@app.get("/api/v1/overview")
def overview() -> Any:
    return mart("overview_summary")


@app.get("/api/v1/visualizations/qc/sample-counts")
def qc_sample_counts() -> Any:
    return mart("qc_sample_counts")


@app.get("/api/v1/visualizations/qc/exclusions")
def qc_exclusions() -> Any:
    return mart("qc_exclusion_summary")


@app.get("/api/v1/visualizations/qc/library-size")
def qc_library_size() -> Any:
    return mart("qc_library_size")


@app.get("/api/v1/visualizations/qc/zero-gene-rate")
def qc_zero_gene_rate() -> Any:
    return mart("qc_zero_gene_rate")


@app.get("/api/v1/visualizations/deg/volcano")
def deg_volcano(max_points: int = Query(2000, ge=20, le=20000), highlight_top_n: int = Query(20, ge=0, le=200)) -> dict[str, Any]:
    targets_by_gene = {normalize_gene_key(row.get("gene_name")): row.get("rank") for row in target_rows() if row.get("gene_name") and row.get("rank")}
    rows = item_list("volcano_points")[:max_points]
    for row in rows:
        rank = targets_by_gene.get(normalize_gene_key(row.get("gene_name")))
        row["rank"] = rank
        row["is_top_candidate"] = bool(rank and rank <= highlight_top_n)
    data = mart("volcano_points")
    return {"items": rows, "max_points": max_points, "highlight_top_n": highlight_top_n, "source": data.get("source") if isinstance(data, dict) else None, "x_axis": "log2FC", "y_axis": "-log10(p_value), capped at 60 for plotting"}


@app.get("/api/v1/visualizations/deg/summary")
def deg_summary() -> Any:
    return mart("deg_summary")


@app.get("/api/v1/visualizations/deg/top-genes")
def deg_top_genes(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    data = mart("top_deg_genes")
    return {"items": item_list("top_deg_genes")[:limit], "limit": limit, "source": data.get("source") if isinstance(data, dict) else None}


@app.get("/api/v1/visualizations/deg/heatmap")
def deg_heatmap(top_n: int = Query(24, ge=5, le=80)) -> dict[str, Any]:
    data = mart("deg_heatmap_matrix")
    if not isinstance(data, dict):
        return unavailable_mart("deg_heatmap_matrix")
    return {**data, "genes": data.get("genes", [])[:top_n], "matrix": data.get("matrix", [])[:top_n], "top_n": top_n}


@app.get("/api/v1/visualizations/mapping/summary")
def mapping_summary() -> Any:
    return mart("gene_protein_mapping_summary")


@app.get("/api/v1/visualizations/mapping/confidence")
def mapping_confidence() -> Any:
    return mart("gene_protein_mapping_confidence")


@app.get("/api/v1/mapping/unmapped")
def mapping_unmapped() -> Any:
    return mart("mapping_unmapped_genes")


@app.get("/api/v1/visualizations/network")
def network(
    top_n: int = Query(50, ge=5, le=100),
    min_edge_score: float = Query(0.4, ge=0.0, le=1.0),
    cluster_id: int | None = None,
    deg_direction: str | None = None,
    geo_support_level: str | None = None,
    geo_validation_status: str | None = None,
    protein_id: str | None = None,
) -> dict[str, Any]:
    nodes = [enrich_cluster_row(row) for row in sorted(item_list("ppi_visualization_nodes"), key=lambda row: row.get("rank") or 10**9)[:top_n]]
    if cluster_id is not None:
        nodes = [row for row in nodes if row.get("cluster_id") is not None and int(row["cluster_id"]) == cluster_id]
    if deg_direction:
        nodes = [row for row in nodes if str(row.get("deg_direction", "")).lower() == deg_direction.lower()]
    support_filter = geo_support_level or geo_validation_status
    if support_filter:
        nodes = [row for row in nodes if str(row.get("geo_support_level", "")).lower() == support_filter.lower()]
    if protein_id:
        keep = {find_target(protein_id)["protein_id"]}
        connected = {
            edge["protein_id_dst"] if edge["protein_id_src"] in keep else edge["protein_id_src"]
            for edge in item_list("ppi_visualization_edges")
            if edge["protein_id_src"] in keep or edge["protein_id_dst"] in keep
        }
        keep |= connected
        nodes = [row for row in nodes if row.get("protein_id") in keep]
    node_ids = {row.get("protein_id") for row in nodes}
    edges = [
        edge
        for edge in item_list("ppi_visualization_edges")
        if edge.get("protein_id_src") in node_ids and edge.get("protein_id_dst") in node_ids and float(edge.get("edge_weight_protein") or 0) >= min_edge_score
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "filters": {"top_n": top_n, "min_edge_score": min_edge_score, "cluster_id": cluster_id, "deg_direction": deg_direction, "geo_support_level": geo_support_level or geo_validation_status},
        "edge_explanation": "An edge means STRING reports an interaction between two candidate proteins. edge_weight_protein = combined_score_protein / 1000; 0.4 is medium confidence, 0.7 is high confidence.",
    }


@app.get("/api/v1/visualizations/network/top-proteins")
def network_top_proteins(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    data = mart("network_top_proteins")
    return {"items": item_list("network_top_proteins")[:limit], "limit": limit, "source": data.get("source") if isinstance(data, dict) else None}


@app.get("/api/v1/visualizations/network/score-distribution")
def network_score_distribution() -> Any:
    return mart("network_score_distribution")


@app.get("/api/v1/targets")
def targets(
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    search: str | None = None,
    cluster_id: int | None = None,
    candidate_group: str | None = None,
    geo_support_level: str | None = None,
    geo_validation_status: str | None = None,
    deg_direction: str | None = None,
    min_final_score: float | None = None,
) -> dict[str, Any]:
    return filtered_targets(limit, offset, search, cluster_id, candidate_group, geo_support_level, deg_direction, min_final_score, geo_validation_status)


@app.get("/api/v1/targets/{protein_id}/score-breakdown")
def target_score_breakdown(protein_id: str) -> dict[str, Any]:
    row = find_target(protein_id)
    components = [
        ("Expression score", safe_float(row.get("expression_score")), 0.50),
        ("Protein network score", safe_float(row.get("protein_network_score")), 0.30),
        ("STRING confidence score", safe_float(row.get("string_confidence_score")), 0.20),
    ]
    return {
        "protein_id": row.get("protein_id"),
        "gene_name": row.get("gene_name"),
        "components": [
            {"name": name, "raw_score": raw, "weight": weight, "weighted_score": round(raw * weight, 4)}
            for name, raw, weight in components
        ],
        "final_score": row.get("final_score"),
    }


@app.get("/api/v1/targets/{protein_id}")
def target_detail(protein_id: str) -> dict[str, Any]:
    row = find_target(protein_id)
    return {
        "identity": {
            "gene_name": row.get("gene_name"),
            "protein_id": row.get("protein_id"),
            "ensp_id": row.get("ensp_id"),
            "rank": row.get("rank"),
        },
        "phase_2_deg": {
            "log2FC": row.get("log2FC"),
            "p_value": row.get("p_value"),
            "deg_direction": row.get("deg_direction"),
        },
        "phase_3_mapping": {"gene_confidence": row.get("gene_confidence")},
        "phase_4_ppi": {
            "degree_protein": row.get("degree_protein"),
            "weighted_degree_protein": row.get("weighted_degree_protein"),
            "num_interactions_in_deg_network": row.get("num_interactions_in_deg_network"),
            "avg_combined_score": row.get("avg_combined_score"),
            "max_combined_score": row.get("max_combined_score"),
        },
        "phase_5_scoring": {
            "expression_score": row.get("expression_score"),
            "protein_network_score": row.get("protein_network_score"),
            "string_confidence_score": row.get("string_confidence_score"),
            "final_score": row.get("final_score"),
        },
        "phase_6_geo": {
            "mode": row.get("geo_validation_mode") or "tumor_cohort_expression_support",
            "match_status": row.get("geo_match_status"),
            "coverage_rate": row.get("geo_coverage_rate"),
            "mean_expression": row.get("geo_mean_expression"),
            "median_expression": row.get("geo_median_expression"),
            "mean_percentile": row.get("geo_mean_percentile"),
            "top_quartile_rate": row.get("geo_top_quartile_rate"),
            "support_score": row.get("geo_support_score"),
            "support_level": row.get("geo_support_level"),
        },
        "phase_7_ml": {
            "cluster_id": row.get("cluster_id"),
            "cluster_interpretation": cluster_interpretation(row.get("cluster_id")),
            "candidate_group_source": row.get("candidate_group"),
        },
    }


@app.get("/api/v1/visualizations/geo/summary")
def geo_summary() -> Any:
    return mart("geo_validation_summary")


@app.get("/api/v1/visualizations/geo/top-supported")
def geo_top_supported(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    data = mart("geo_supported_top_candidates")
    return {"items": item_list("geo_supported_top_candidates")[:limit], "limit": limit, "source": data.get("source") if isinstance(data, dict) else None}


@app.get("/api/v1/visualizations/geo/gdc-vs-support")
def geo_gdc_vs_support() -> Any:
    return mart("geo_gdc_vs_support_scatter")


@app.get("/api/v1/visualizations/geo/top-candidate-overlap")
def geo_top_candidate_overlap(limit: int = Query(100, ge=1, le=100)) -> dict[str, Any]:
    data = mart("geo_top_candidate_overlap")
    return {"items": item_list("geo_top_candidate_overlap")[:limit], "limit": limit, "source": data.get("source") if isinstance(data, dict) else None}


@app.get("/api/v1/geo/unmatched-candidates")
def geo_unmatched_candidates() -> Any:
    rows = item_list("geo_unmatched_candidates")
    targets_by_gene = {normalize_gene_key(row.get("gene_name")): row for row in target_rows()}
    enriched = []
    for row in rows:
        target = targets_by_gene.get(normalize_gene_key(row.get("gene_name")), {})
        enriched.append({
            **row,
            "protein_id": row.get("protein_id") or target.get("protein_id"),
            "geo_match_reason": row.get("geo_match_reason") or "No matching GEO tumor-cohort expression entry for this candidate gene in the support mart.",
        })
    data = mart("geo_unmatched_candidates")
    return {"items": enriched, "source": data.get("source") if isinstance(data, dict) else None}


@app.get("/api/v1/visualizations/geo/expression-availability")
def geo_expression_availability(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    data = mart("geo_expression_availability")
    return {"items": item_list("geo_expression_availability")[:limit], "limit": limit, "source": data.get("source") if isinstance(data, dict) else None}


@app.get("/api/v1/visualizations/ml/k-selection")
def ml_k_selection() -> Any:
    return mart("ml_k_selection")


@app.get("/api/v1/visualizations/ml/scatter")
def ml_scatter(limit: int = Query(100, ge=1, le=5000), cluster_id: int | None = None, top_only: bool = False) -> dict[str, Any]:
    rows = item_list("ml_cluster_points")
    if cluster_id is not None:
        rows = [row for row in rows if row.get("cluster_id") is not None and int(row["cluster_id"]) == cluster_id]
    if top_only:
        top_ids = {row.get("protein_id") for row in target_rows()[:100]}
        rows = [row for row in rows if row.get("protein_id") in top_ids]
    return {"items": [enrich_cluster_row(row) for row in rows[:limit]], "limit": limit, "cluster_id": cluster_id, "top_only": top_only}


@app.get("/api/v1/visualizations/ml/cluster-summary")
def ml_cluster_summary() -> Any:
    data = mart("ml_cluster_summary")
    return {**data, "items": [enrich_cluster_row(row) for row in item_list("ml_cluster_summary")]} if isinstance(data, dict) else data


@app.get("/api/v1/ml/clusters")
def ml_clusters() -> Any:
    data = mart("ml_clusters")
    return {**data, "items": [enrich_cluster_row(row) for row in item_list("ml_clusters")]} if isinstance(data, dict) else data


@app.get("/api/v1/visualizations/ml/explainability")
def ml_explainability() -> dict[str, Any]:
    points = item_list("ml_cluster_points")
    summaries = {int(row["cluster_id"]): row for row in item_list("ml_cluster_summary") if row.get("cluster_id") is not None}
    top_targets = sorted(target_rows(), key=lambda row: row.get("rank") or 10**9)[:100]
    top_by_cluster: dict[int, list[dict[str, Any]]] = {}
    for row in top_targets:
        if row.get("cluster_id") is None:
            continue
        top_by_cluster.setdefault(int(row["cluster_id"]), []).append(row)

    total_candidates = len(points)
    total_top = len(top_targets)
    profiles = []
    for cluster_id in sorted(summaries):
        summary = summaries[cluster_id]
        members = [row for row in points if row.get("cluster_id") is not None and int(row["cluster_id"]) == cluster_id]
        top_members = top_by_cluster.get(cluster_id, [])
        feature_ranges = {}
        for feature in ML_FEATURES:
            values = [safe_float(row.get(feature["key"])) for row in members if row.get(feature["key"]) is not None]
            feature_ranges[feature["key"]] = {"min": min(values) if values else None, "median": median_value(values), "max": max(values) if values else None}
        profiles.append({
            **summary,
            "cluster_interpretation": cluster_interpretation(cluster_id),
            "source_candidate_group": summary.get("candidate_group"),
            "population_percentage": (len(members) / total_candidates * 100) if total_candidates else 0,
            "top_100_count": len(top_members),
            "top_100_percentage": (len(top_members) / total_top * 100) if total_top else 0,
            "top_100_capture_rate": (len(top_members) / len(members) * 100) if members else 0,
            "top_genes": [row.get("gene_name") for row in top_members[:10]],
            "feature_ranges": feature_ranges,
        })

    k_rows = item_list("ml_k_selection")
    best_k = max(k_rows, key=lambda row: safe_float(row.get("silhouette_score")), default={})
    return {
        "assignment": {
            "algorithm": "KMeans on StandardScaler-transformed features",
            "fixed_score_threshold": False,
            "rule": "Mỗi candidate được gán vào centroid gần nhất trong không gian 4 feature đã chuẩn hóa; không có ngưỡng điểm cố định để vào Cluster 0, 1 hoặc 2.",
            "features": ML_FEATURES,
            "selected_k": best_k.get("k"),
            "silhouette_score": best_k.get("silhouette_score"),
            "note": "Khoảng min/median/max chỉ mô tả các thành viên hiện tại và có thể chồng lấp; chúng không phải luật gán cluster.",
        },
        "items": profiles,
        "top_100_total": total_top,
        "total_candidates": total_candidates,
        "source": {"points": "ml_cluster_points", "summary": "ml_cluster_summary", "top_targets": "top_candidate_targets_enriched"},
    }


@app.post("/api/v1/chat")
def chat(payload: dict[str, Any]) -> dict[str, Any]:
    question = str(payload.get("question", "")).strip()
    target = str(payload.get("target", "")).strip()
    focus = f" for {target}" if target else ""
    return {
        "mode": "ui_only_placeholder",
        "answer": (
            f"AI model, RAG and finetune are not connected in this build. "
            f"The interface captured your question{focus}: '{question}'. "
            "This hook is ready for a future project-grounded model service."
        ),
        "citations": [],
    }
