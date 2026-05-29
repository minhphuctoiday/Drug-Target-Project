from __future__ import annotations

from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from src.backend.schemas import ChatPayload, ExpressionPayload, PredictResponse
from src.backend.mongo import mongo_logger
from src.backend.settings import get_settings
from src.backend.services import ArtifactError, get_store


PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "src" / "frontend"

app = FastAPI(
    title="Protein Target Discovery API",
    description="Protein target ranking, STRING PPI visualization, auxiliary phenotype-evidence ML, and lightweight RAG endpoints for TCGA-LUAD.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


def store_or_503():
    try:
        return get_store()
    except ArtifactError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/")
def index():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"status": "ok", "docs": "/docs"}


@app.get("/docs-page")
def docs_page():
    path = FRONTEND_DIR / "docs.html"
    if path.exists():
        return FileResponse(path)
    return {"detail": "docs page not found"}


@app.get("/api/health")
def health():
    store = store_or_503()
    settings = get_settings()
    return {
        "status": "ok",
        "model": store.model_name,
        "features": len(store.features),
        "mongodb_enabled": settings.mongodb_enabled,
        "mongodb_connected": mongo_logger.enabled,
        "rag_mode": settings.rag_mode,
    }


@app.get("/api/model")
def model_info():
    return store_or_503().model_info()


@app.get("/api/project")
def project_overview():
    return store_or_503().project_overview()


@app.post("/api/predict", response_model=PredictResponse)
def predict(payload: ExpressionPayload):
    result = store_or_503().predict(payload.expression, input_scale=payload.input_scale, top_k=payload.top_k)
    mongo_logger.insert(
        get_settings().mongodb_predictions_collection,
        {
            "label": result.label,
            "probability_tumor": result.probability_tumor,
            "supplied_features": result.supplied_features,
            "missing_features": result.missing_features,
        },
    )
    return result.__dict__


@app.get("/api/demo-sample")
def demo_sample(split: str = Query("test", pattern="^(train|val|test)$"), index: int = Query(0, ge=0)):
    path = PROJECT_ROOT / "outputs" / "ml_inputs" / f"X_{split}.parquet"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Missing {path}")
    frame = pd.read_parquet(path)
    if index >= len(frame):
        raise HTTPException(status_code=404, detail=f"Index {index} out of range for {split} ({len(frame)} samples).")
    row = frame.iloc[index].dropna()
    return {"split": split, "index": index, "input_scale": "log2_tpm", "expression": row.to_dict()}


@app.get("/api/targets")
def targets(limit: int = Query(50, ge=1, le=500), q: str | None = None):
    return {"items": store_or_503().targets(limit=limit, query=q)}


@app.get("/api/targets/enriched")
def targets_enriched(limit: int = Query(100, ge=1, le=500)):
    return {"items": store_or_503().enriched_targets_rows(limit=limit)}


@app.get("/api/enrichment")
def enrichment():
    return {"items": store_or_503().enrichment_rows()}


@app.get("/api/gene/{gene}")
def gene_report(gene: str):
    payload = store_or_503().gene_report(gene)
    mongo_logger.insert(get_settings().mongodb_reports_collection, {"gene": gene.upper()})
    return payload


@app.get("/api/protein-target/{gene}")
def protein_target_report(gene: str):
    return gene_report(gene)


@app.get("/api/gene/{gene}/report", response_class=HTMLResponse)
def gene_report_html(gene: str):
    return store_or_503().gene_report_html(gene)


@app.get("/api/protein-target/{gene}/report", response_class=HTMLResponse)
def protein_target_report_html(gene: str):
    return gene_report_html(gene)


@app.get("/api/compare")
def compare_genes(genes: str = Query(..., description="Comma-separated protein-coding gene symbols that encode candidate protein targets, e.g. PLK1,AURKB,TOP2A")):
    return store_or_503().compare_genes(genes.split(","))


@app.get("/api/volcano")
def volcano(limit: int = Query(20000, ge=100, le=30000)):
    return {"items": store_or_503().volcano_points(limit=limit)}


@app.get("/api/network")
def network():
    return store_or_503().network


@app.get("/api/heatmap")
def heatmap(genes: int = Query(40, ge=5, le=100), samples: int = Query(80, ge=10, le=200)):
    return store_or_503().heatmap_payload(genes=genes, samples=samples)


@app.get("/api/feature-importance")
def feature_importance(limit: int = Query(100, ge=1, le=500)):
    return {"items": store_or_503().feature_importance_rows(limit=limit)}


@app.get("/api/metrics")
def metrics():
    store = store_or_503()
    return {"model": store.model_info(), "da_summary": store.da_summary}


@app.post("/api/chat")
def chat(payload: ChatPayload):
    response = store_or_503().retrieve(payload.question, limit=payload.limit)
    mongo_logger.insert(get_settings().mongodb_chat_collection, {"question": payload.question, "sources": response.get("sources", [])})
    return response


@app.get("/api/v1/luad/volcano")
def legacy_volcano():
    return {"status": "success", "data": store_or_503().volcano_points(limit=20000)}


@app.get("/api/v1/luad/heatmap/top-targets")
def legacy_heatmap():
    payload = store_or_503().heatmap_payload(genes=40, samples=80)
    return {
        "status": "success",
        "patients_x": payload["samples"],
        "genes_y": payload["genes"],
        "expression_matrix_z": payload["matrix"],
        "scale": payload["scale"],
    }


@app.get("/api/v1/luad/network")
def legacy_network():
    payload = store_or_503().network
    return {"status": "success", **payload}
