from __future__ import annotations

import json
import math
import re
import warnings
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from src.backend.rag import RagChunk, get_project_rag
from src.backend.settings import get_settings


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUTS = PROJECT_ROOT / "outputs"
ML_INPUTS = OUTPUTS / "ml_inputs"
ML_MODELS = OUTPUTS / "ml_models"
BIO_EVIDENCE = OUTPUTS / "biological_evidence"
DOCS = PROJECT_ROOT / "docs"

PROTEIN_TARGET_NAMES = {
    "PLK1": "Polo-like kinase 1",
    "AURKB": "Aurora kinase B",
    "TOP2A": "DNA topoisomerase II alpha",
    "CCNB1": "Cyclin B1",
    "CCNB2": "Cyclin B2",
    "CCNA2": "Cyclin A2",
    "CDC20": "Cell division cycle protein 20 homolog",
    "BIRC5": "Survivin",
    "UBE2C": "Ubiquitin-conjugating enzyme E2 C",
    "CENPA": "Histone H3-like centromeric protein A",
    "SPP1": "Osteopontin",
    "CAV1": "Caveolin-1",
    "COL1A1": "Collagen alpha-1(I) chain",
    "KIF20A": "Kinesin-like protein KIF20A",
    "BUB1B": "Mitotic checkpoint serine/threonine-protein kinase BUB1 beta",
    "CDC6": "Cell division control protein 6 homolog",
    "CDC45": "Cell division control protein 45 homolog",
    "EXO1": "Exonuclease 1",
    "RECQL4": "ATP-dependent DNA helicase Q4",
    "CDCA8": "Borealin",
}


class ArtifactError(RuntimeError):
    pass


@dataclass
class PredictionResult:
    label: str
    probability_tumor: float
    threshold: float
    confidence: float
    missing_features: int
    supplied_features: int
    top_contributions: list[dict[str, Any]]


def _json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if not math.isfinite(float(value)):
            return None
        return float(value)
    if pd.isna(value):
        return None
    return value


def dataframe_records(frame: pd.DataFrame, limit: int | None = None) -> list[dict[str, Any]]:
    if limit is not None:
        frame = frame.head(limit)
    frame = frame.replace([np.inf, -np.inf], np.nan)
    return clean_json(frame.to_dict(orient="records"))


def clean_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean_json(v) for v in value]
    if isinstance(value, tuple):
        return [clean_json(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        value = float(value)
        return value if math.isfinite(value) else None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


class ArtifactStore:
    def __init__(self) -> None:
        self.model_bundle = self._load_model_bundle()
        self.model = self.model_bundle["model"]
        self.model_name = self.model_bundle.get("model_name", "unknown")
        self.threshold = float(self.model_bundle.get("threshold", 0.5))
        self.features = list(self.model_bundle["features"])
        self.protocol = self.model_bundle.get("protocol", "unknown")
        self.metrics = self._load_json(ML_MODELS / "best_model_metrics.json", default={})
        self.protein_ranker_summary = self._load_json(ML_MODELS / "protein_target_ranker_summary.json", default={})
        self.da_summary = self._load_json(OUTPUTS / "da_run_summary.json", default={})
        self.target_features = self._load_table(ML_INPUTS / "target_prioritization_features.parquet")
        self.master = self._load_table(OUTPUTS / "master_biomarker_features.parquet")
        self.top_targets = self._load_table(OUTPUTS / "top_drug_targets.csv")
        self.feature_importance = self._load_table(ML_MODELS / "best_model_feature_importance_joined.parquet")
        self.protein_target_ranking = self._load_table(ML_MODELS / "protein_target_ranking.parquet")
        self.volcano = self._load_table(OUTPUTS / "volcano_points.parquet")
        self.heatmap = self._load_table(OUTPUTS / "heatmap_matrix.parquet")
        self.network = self._load_json(OUTPUTS / "network_subgraph.json", default={"nodes": [], "edges": []})
        self.network = self._annotate_network(self.network)
        self.enriched_targets = self._load_table(BIO_EVIDENCE / "target_evidence_enriched.parquet")
        self.pathway_enrichment = self._load_table(BIO_EVIDENCE / "pathway_enrichment_top100.csv")
        self.gene_reports = self._load_json(BIO_EVIDENCE / "gene_reports.json", default={})
        self.bio_summary = self._load_json(BIO_EVIDENCE / "biological_evidence_summary.json", default={})
        self.docs_index = self._build_docs_index()

    def _load_model_bundle(self) -> dict[str, Any]:
        candidates = [
            ML_MODELS / "best_tumor_normal_model_strict.joblib",
            ML_MODELS / "best_tumor_normal_model.joblib",
            PROJECT_ROOT / "src" / "ai_model" / "baseline_tumor_normal_logistic.joblib",
        ]
        for path in candidates:
            if path.exists():
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    bundle = joblib.load(path)
                if isinstance(bundle, dict) and "model" in bundle and "features" in bundle:
                    bundle["artifact_path"] = str(path)
                    return bundle
                raise ArtifactError(f"Unsupported model bundle format: {path}")
        raise ArtifactError("No model artifact found. Expected outputs/ml_models/best_tumor_normal_model_strict.joblib")

    @staticmethod
    def _load_json(path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _load_table(path: Path) -> pd.DataFrame:
        if not path.exists():
            return pd.DataFrame()
        if path.suffix == ".csv":
            return pd.read_csv(path)
        return pd.read_parquet(path)

    def _build_docs_index(self) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        for path in sorted(DOCS.glob("*.md")):
            text = path.read_text(encoding="utf-8", errors="ignore")
            chunks = re.split(r"\n(?=# )|\n(?=## )|\n\n+", text)
            for i, chunk in enumerate(chunks):
                cleaned = chunk.strip()
                if len(cleaned) >= 80:
                    rows.append({"source": path.name, "chunk_id": str(i), "text": cleaned[:2500]})

        for path in [
            OUTPUTS / "da_run_summary.json",
            ML_MODELS / "best_model_metrics.json",
            BIO_EVIDENCE / "biological_evidence_summary.json",
            OUTPUTS / "top_drug_targets.csv",
            ML_MODELS / "top_100_model_features_joined.csv",
        ]:
            if path.exists():
                text = path.read_text(encoding="utf-8", errors="ignore")
                rows.append({"source": path.name, "chunk_id": "0", "text": text[:4000]})
        return rows

    @staticmethod
    def protein_target_name(gene: str) -> str:
        key = str(gene).upper().strip()
        return PROTEIN_TARGET_NAMES.get(key, f"{key} protein")

    def _annotate_protein_frame(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty or "gene_name_norm" not in frame.columns:
            return frame
        annotated = frame.copy()
        genes = annotated["gene_name_norm"].astype(str).str.upper().str.strip()
        annotated["encoded_by_gene"] = genes
        annotated["protein_target"] = genes.map(self.protein_target_name)
        annotated["target_entity"] = "protein target inferred from protein-coding gene"
        annotated["ppi_network_entity"] = "STRING protein-protein interaction node"
        return annotated

    def _annotate_network(self, payload: dict[str, Any]) -> dict[str, Any]:
        for node in payload.get("nodes", []):
            data = node.get("data", {})
            gene = str(data.get("id") or data.get("label") or "").upper().strip()
            if gene:
                data["encoded_by_gene"] = gene
                data["protein_target"] = self.protein_target_name(gene)
                data["target_entity"] = "protein target"
        return payload

    @staticmethod
    def _minmax(values: pd.Series) -> pd.Series:
        numeric = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan)
        if numeric.notna().sum() == 0:
            return pd.Series(np.zeros(len(numeric)), index=numeric.index)
        lo = numeric.min()
        hi = numeric.max()
        if not np.isfinite(lo) or not np.isfinite(hi) or hi == lo:
            return pd.Series(np.zeros(len(numeric)), index=numeric.index)
        return ((numeric - lo) / (hi - lo)).clip(0, 1).fillna(0)

    def _fallback_evidence_frame(self) -> pd.DataFrame:
        frame = self.top_targets.copy()
        if frame.empty:
            frame = self.master.copy()
        if frame.empty or "gene_name_norm" not in frame.columns:
            return pd.DataFrame()
        frame = self._merge_protein_ranker(frame)

        if "model_importance" not in frame.columns and not self.feature_importance.empty:
            keep = [c for c in ["gene_name_norm", "model_importance"] if c in self.feature_importance.columns]
            if len(keep) == 2:
                frame = frame.merge(self.feature_importance[keep], on="gene_name_norm", how="left")

        abs_fc = frame["gdc_abs_log2_fc"] if "gdc_abs_log2_fc" in frame.columns else frame.get("gdc_log2_fc", pd.Series(0, index=frame.index)).abs()
        fdr = frame["gdc_neg_log10_fdr"] if "gdc_neg_log10_fdr" in frame.columns else pd.Series(0, index=frame.index)
        frame["expression_component"] = 0.55 * self._minmax(abs_fc) + 0.45 * self._minmax(fdr)

        network_parts = []
        for col in ["pagerank", "weighted_degree_gene", "degree_gene", "betweenness_centrality"]:
            if col in frame.columns:
                network_parts.append(self._minmax(frame[col]))
        frame["network_component"] = pd.concat(network_parts, axis=1).mean(axis=1) if network_parts else 0.0

        if "geo_validation_status" in frame.columns:
            status = frame["geo_validation_status"].astype(str).str.lower()
            frame["validation_component"] = np.select(
                [status.eq("validated"), status.str.contains("weak", na=False)],
                [1.0, 0.45],
                default=0.0,
            )
        else:
            frame["validation_component"] = 0.0

        frame["druggability_score"] = self._minmax(frame["druggability_score"]) if "druggability_score" in frame.columns else 0.0
        frame["model_component"] = self._minmax(frame["model_importance"]) if "model_importance" in frame.columns else 0.0
        frame["survival_component"] = self._minmax(frame["survival_component"]) if "survival_component" in frame.columns else 0.0

        if "integrated_evidence_score" not in frame.columns:
            if "protein_ml_priority_score" in frame.columns:
                frame["integrated_evidence_score"] = (
                    0.45 * self._minmax(frame["target_score"] if "target_score" in frame.columns else frame["protein_ml_priority_score"])
                    + 0.35 * self._minmax(frame["protein_ml_priority_score"])
                    + 0.20 * frame["validation_component"]
                )
            elif "target_score" in frame.columns:
                frame["integrated_evidence_score"] = self._minmax(frame["target_score"])
            else:
                frame["integrated_evidence_score"] = frame["expression_component"]
        if "integrated_evidence_rank" not in frame.columns:
            frame["integrated_evidence_rank"] = frame["integrated_evidence_score"].rank(method="dense", ascending=False).astype(int)
        if "evidence_level" not in frame.columns:
            rank = frame["integrated_evidence_rank"]
            frame["evidence_level"] = np.select([rank <= 50, rank <= 200, rank <= 500], ["high", "medium", "exploratory"], default="background")
        return self._annotate_protein_frame(frame)

    def model_info(self) -> dict[str, Any]:
        test_metrics = self.metrics.get("strict_test_metrics") or self.metrics.get("test_metrics") or {}
        ci = self.metrics.get("strict_test_bootstrap_ci", {})
        return {
            "model_name": self.model_name,
            "protocol": self.protocol,
            "artifact_path": self.model_bundle.get("artifact_path"),
            "threshold": self.threshold,
            "n_features": len(self.features),
            "feature_preview": self.features[:12],
            "test_metrics": test_metrics,
            "bootstrap_ci": ci,
            "class_counts": self.metrics.get("class_counts", {}),
            "protein_target_ranker": {
                "available": not self.protein_target_ranking.empty,
                "artifact": str(ML_MODELS / "protein_target_ranker.joblib"),
                "task": "Unsupervised candidate protein target prioritization",
                "summary": self.protein_ranker_summary,
            },
        }

    def project_overview(self) -> dict[str, Any]:
        network = self.da_summary.get("network", {})
        labels = self.da_summary.get("gdc_labels", {})
        expression_counts = dict(self.da_summary.get("expression_status_counts", []))
        geo_counts = dict(self.da_summary.get("geo_validation_counts", []))
        return clean_json({
            "title": "Big Data Analytics for Drug Target Identification",
            "disease": "Lung Adenocarcinoma (TCGA-LUAD)",
            "data_sources": [
                {
                    "name": "TCGA/GDC",
                    "role": "Primary RNA-seq expression cohort for tumor-vs-normal analysis and ML training.",
                    "artifact": "data/refined/gdc/annotate.parquet",
                    "samples": labels.get("file_counts", {}),
                },
                {
                    "name": "GEO",
                    "role": "Independent validation signal using stage-associated expression patterns.",
                    "artifact": "data/refined/geo/annotate.parquet",
                },
                {
                    "name": "STRING",
                    "role": "Protein-protein interaction network for hub/context evidence.",
                    "artifact": "data/refined/STRING",
                    "high_confidence_edges": network.get("graph_edges"),
                },
            ],
            "big_data_workflow": [
                "Batch ingestion with NiFi-style raw/refined zones.",
                "Columnar Parquet storage for large gene/protein tables.",
                "Distributed analytics design: differential expression, PPI graph metrics, clustering and target scoring.",
                "Artifact serving through FastAPI for dashboard and model inference.",
            ],
            "analytics_outputs": {
                "candidate_protein_target_rows": self.da_summary.get("master_rows"),
                "expression_status_counts": expression_counts,
                "geo_validation_counts": geo_counts,
                "ppi_nodes": network.get("graph_nodes"),
                "ppi_edges": network.get("graph_edges"),
                "top_targets": self.da_summary.get("top_20_targets", [])[:10],
                "biological_evidence": self.bio_summary,
            },
            "platform_capabilities": [
                "Integrates gene expression datasets.",
                "Ranks disease-associated candidate protein targets inferred from protein-coding genes.",
                "Visualizes biological interaction networks.",
                "Uses tumor-vs-normal ML only as an auxiliary phenotype-evidence layer.",
                "Links ML feature importance back to protein target-prioritization evidence.",
            ],
        })

    def predict(self, expression: dict[str, float], input_scale: str = "tpm", top_k: int = 12) -> PredictionResult:
        normalized = {str(k).upper().strip(): float(v) for k, v in expression.items() if v is not None}
        row_values = []
        missing = 0
        for gene in self.features:
            value = normalized.get(gene.upper())
            if value is None:
                row_values.append(np.nan)
                missing += 1
            elif input_scale == "log2_tpm":
                row_values.append(value)
            else:
                row_values.append(math.log2(max(value, 0.0) + 1.0))
        frame = pd.DataFrame([row_values], columns=self.features)
        probability = float(self.model.predict_proba(frame)[0, 1])
        label = "Tumor" if probability >= self.threshold else "Normal"
        confidence = probability if label == "Tumor" else 1.0 - probability
        return PredictionResult(
            label=label,
            probability_tumor=probability,
            threshold=self.threshold,
            confidence=float(confidence),
            missing_features=missing,
            supplied_features=len(normalized),
            top_contributions=self._contributions(frame, normalized, top_k),
        )

    def _contributions(self, frame: pd.DataFrame, supplied: dict[str, float], top_k: int) -> list[dict[str, Any]]:
        model_step = getattr(self.model, "named_steps", {}).get("model")
        if model_step is None or not hasattr(model_step, "coef_"):
            return []
        coefs = model_step.coef_[0]
        imputer = self.model.named_steps.get("imputer")
        scaler = self.model.named_steps.get("scaler")
        values: Any = frame
        if imputer is not None:
            values = imputer.transform(values)
        if scaler is not None:
            values = scaler.transform(values)
        contributions = values[0] * coefs
        table = pd.DataFrame(
            {
                "gene_name_norm": self.features,
                "contribution": contributions,
                "coefficient": coefs,
                "input_present": [gene.upper() in supplied for gene in self.features],
            }
        )
        if not self.target_features.empty:
            keep = ["gene_name_norm", "target_score", "target_rank", "evidence_level"]
            table = table.merge(self.target_features[[c for c in keep if c in self.target_features.columns]], on="gene_name_norm", how="left")
        table["abs_contribution"] = table["contribution"].abs()
        table = table.sort_values("abs_contribution", ascending=False).head(max(1, min(top_k, 50)))
        return dataframe_records(table)

    def targets(self, limit: int = 50, query: str | None = None) -> list[dict[str, Any]]:
        frame = self.enriched_targets.copy() if not self.enriched_targets.empty else self.top_targets.copy()
        if frame.empty:
            frame = self.master.sort_values("target_rank")
        frame = self._merge_protein_ranker(frame)
        frame = self._annotate_protein_frame(frame)
        if query:
            q = query.upper().strip()
            haystack = frame["gene_name_norm"].astype(str).str.upper()
            if "protein_target" in frame.columns:
                haystack = haystack + " " + frame["protein_target"].astype(str).str.upper()
            frame = frame[haystack.str.contains(q, na=False)]
        cols = [
            "protein_target",
            "encoded_by_gene",
            "target_entity",
            "gene_name_norm",
            "target_rank",
            "target_score",
            "integrated_evidence_rank",
            "integrated_evidence_score",
            "protein_ml_priority_score",
            "protein_ml_rank",
            "protein_target_cluster",
            "druggability_class",
            "gdc_log2_fc",
            "gdc_adj_p_value",
            "geo_validation_status",
            "degree_gene",
            "pagerank",
            "evidence_level",
        ]
        return dataframe_records(frame[[c for c in cols if c in frame.columns]].sort_values("target_rank"), limit=limit)

    def enriched_targets_rows(self, limit: int = 100) -> list[dict[str, Any]]:
        frame = self.enriched_targets.copy()
        if frame.empty:
            frame = self._fallback_evidence_frame()
        else:
            frame = self._merge_protein_ranker(frame)
            frame = self._annotate_protein_frame(frame)
        frame = self._annotate_protein_frame(frame)
        if frame.empty:
            return []
        return dataframe_records(frame.sort_values("integrated_evidence_rank"), limit=limit)

    def _merge_protein_ranker(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty or self.protein_target_ranking.empty or "gene_name_norm" not in frame.columns:
            return frame
        keep = [
            "gene_name_norm",
            "protein_ml_priority_score",
            "protein_ml_rank",
            "protein_target_cluster",
            "isolation_priority_score",
            "gmm_rarity_score",
            "cluster_priority_score",
        ]
        cols = [c for c in keep if c in self.protein_target_ranking.columns]
        if len(cols) <= 1:
            return frame
        cols = [c for c in cols if c == "gene_name_norm" or c not in frame.columns]
        if len(cols) <= 1:
            return frame
        return frame.merge(self.protein_target_ranking[cols], on="gene_name_norm", how="left")

    def enrichment_rows(self) -> list[dict[str, Any]]:
        if self.pathway_enrichment.empty:
            return self._fallback_enrichment_rows()
        return dataframe_records(self.pathway_enrichment.sort_values(["fdr", "overlap_count"], ascending=[True, False]))

    def _fallback_enrichment_rows(self) -> list[dict[str, Any]]:
        frame = self._fallback_evidence_frame()
        if frame.empty:
            return []
        top = set(frame.sort_values("integrated_evidence_rank")["gene_name_norm"].astype(str).head(300))
        gene_sets = {
            "Cell cycle and mitotic control": {"PLK1", "CDK1", "CDC20", "CCNB1", "CCNB2", "CCNA2", "BUB1B", "KIF20A", "ANLN", "CENPA", "UBE2C"},
            "DNA replication and repair": {"TOP2A", "RAD51", "EXO1", "RECQL4", "CDC6", "CDC45", "MCM2", "MCM4", "MCM6", "BRCA1"},
            "Inflammation and cytokine signaling": {"IL6", "STAT1", "JUN", "CSF3", "CXCL8", "CXCL10", "CCL2", "TNF", "IRF1"},
            "Extracellular matrix and invasion": {"COL1A1", "COL4A4", "SPP1", "MMP9", "MMP1", "FN1", "VTN", "CAV1"},
            "Hypoxia and tumor microenvironment": {"HIF1A", "VEGFA", "SPP1", "ALB", "CD4", "CD68", "VIM", "ITGAM"},
            "Drug-targetable kinases and enzymes": {"PLK1", "AURKB", "CDK1", "TOP2A", "MET", "EGFR", "ERBB2", "ALK", "PIK3CA", "PARP1"},
        }
        rows = []
        for pathway, genes in gene_sets.items():
            overlap = sorted(top & genes)
            if not overlap:
                continue
            rows.append(
                {
                    "pathway": pathway,
                    "overlap_count": len(overlap),
                    "fdr": round(1.0 / (len(overlap) + 8), 5),
                    "overlap_genes": ", ".join(overlap),
                    "source": "fallback_curated_gene_set",
                }
            )
        return sorted(rows, key=lambda row: (-row["overlap_count"], row["fdr"]))

    def gene_report(self, gene: str) -> dict[str, Any]:
        key = gene.upper().strip()
        report = self.gene_reports.get(key, {})
        rows = []
        for frame in [self.enriched_targets, self.master, self.feature_importance, self.protein_target_ranking]:
            if frame.empty or "gene_name_norm" not in frame.columns:
                continue
            match = frame[frame["gene_name_norm"].astype(str).str.upper() == key]
            if not match.empty:
                rows.append(match.iloc[0].to_dict())
        merged: dict[str, Any] = {}
        for row in rows:
            merged.update(row)
        merged["encoded_by_gene"] = key
        merged["protein_target"] = self.protein_target_name(key)
        merged["target_entity"] = "protein target inferred from protein-coding gene"
        return clean_json({"gene": key, "encoded_by_gene": key, "protein_target": self.protein_target_name(key), "report": report, "features": merged})

    def compare_genes(self, genes: list[str]) -> dict[str, Any]:
        unique = []
        for gene in genes:
            key = gene.upper().strip()
            if key and key not in unique:
                unique.append(key)
        reports = [self.gene_report(gene) for gene in unique[:8]]
        rows = []
        for item in reports:
            features = item.get("features", {})
            rows.append(
                {
                    "gene": item["gene"],
                    "protein_target": item.get("protein_target"),
                    "encoded_by_gene": item.get("encoded_by_gene"),
                    "target_rank": features.get("target_rank"),
                    "target_score": features.get("target_score"),
                    "integrated_evidence_rank": features.get("integrated_evidence_rank"),
                    "integrated_evidence_score": features.get("integrated_evidence_score"),
                    "protein_ml_priority_score": features.get("protein_ml_priority_score"),
                    "protein_ml_rank": features.get("protein_ml_rank"),
                    "protein_target_cluster": features.get("protein_target_cluster"),
                    "druggability_class": features.get("druggability_class"),
                    "drug_class": features.get("drug_class"),
                    "known_drugs": features.get("known_drugs"),
                    "gdc_log2_fc": features.get("gdc_log2_fc"),
                    "geo_validation_status": features.get("geo_validation_status"),
                    "survival_time_fdr": features.get("survival_time_fdr"),
                    "model_importance": features.get("model_importance"),
                }
            )
        return clean_json({"items": rows})

    def gene_report_html(self, gene: str) -> str:
        payload = self.gene_report(gene)
        report = payload.get("report", {})
        features = payload.get("features", {})
        tags = report.get("druggability_tags", [])
        pathways = report.get("pathways", [])
        rows = [
            ("Target rank", features.get("target_rank")),
            ("Target score", features.get("target_score")),
            ("Integrated rank", features.get("integrated_evidence_rank")),
            ("Integrated score", features.get("integrated_evidence_score")),
            ("ML protein priority rank", features.get("protein_ml_rank")),
            ("ML protein priority score", features.get("protein_ml_priority_score")),
            ("Protein target cluster", features.get("protein_target_cluster")),
            ("log2FC", features.get("gdc_log2_fc")),
            ("GEO validation", features.get("geo_validation_status")),
            ("Druggability", features.get("druggability_class")),
            ("Drug class", features.get("drug_class")),
            ("Known drugs", features.get("known_drugs")),
            ("Survival FDR", features.get("survival_time_fdr")),
            ("Model importance", features.get("model_importance")),
        ]
        metric_rows = "\n".join(f"<tr><th>{k}</th><td>{'' if v is None else v}</td></tr>" for k, v in rows)
        tag_html = " ".join(f"<span>{tag}</span>" for tag in tags) or "<em>No curated tags</em>"
        pathway_html = "".join(f"<li>{pathway}</li>" for pathway in pathways) or "<li>No curated top-target pathway overlap</li>"
        return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{payload['gene']} Target Evidence Report</title>
  <style>
    body {{ font-family: Inter, Arial, sans-serif; margin: 40px; color: #10201d; }}
    h1 {{ font-size: 34px; margin-bottom: 4px; }}
    .subtitle {{ color: #527067; margin-bottom: 28px; }}
    table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
    th, td {{ border: 1px solid #d7e5df; padding: 10px 12px; text-align: left; }}
    th {{ width: 220px; background: #edf7f3; }}
    span {{ display: inline-block; padding: 6px 10px; margin: 3px; border-radius: 999px; background: #dff7ed; color: #046b4f; font-weight: 700; }}
    .note {{ padding: 14px 16px; background: #f6faf8; border-left: 4px solid #19a974; }}
  </style>
</head>
<body>
  <h1>{payload['gene']}</h1>
  <div class="subtitle">Candidate protein target evidence report | encoded by {payload['gene']}</div>
  <p class="note">{report.get('summary', 'No summary available.')}</p>
  <h2>Evidence metrics</h2>
  <table>{metric_rows}</table>
  <h2>Druggability tags</h2>
  <p>{tag_html}</p>
  <h2>Pathway context</h2>
  <ul>{pathway_html}</ul>
  <p class="subtitle">Generated from local project artifacts. Candidate evidence only; not clinical validation.</p>
</body>
</html>"""

    def volcano_points(self, limit: int = 20000) -> list[dict[str, Any]]:
        frame = self.volcano.copy()
        if "target_rank" in frame.columns:
            frame = frame.sort_values("target_rank")
        return dataframe_records(frame, limit=limit)

    def feature_importance_rows(self, limit: int = 100) -> list[dict[str, Any]]:
        cols = [
            "gene_name_norm",
            "model_importance",
            "coefficient",
            "target_score",
            "target_rank",
            "evidence_level",
            "gdc_abs_log2_fc",
            "pagerank",
        ]
        frame = self.feature_importance[[c for c in cols if c in self.feature_importance.columns]].copy()
        frame = self._annotate_protein_frame(frame)
        return dataframe_records(frame.sort_values("model_importance", ascending=False), limit=limit)

    def heatmap_payload(self, genes: int = 40, samples: int = 80) -> dict[str, Any]:
        if self.heatmap.empty:
            return {"genes": [], "samples": [], "matrix": []}
        frame = self.heatmap.copy()
        top_gene_order = []
        if not self.top_targets.empty and "gene_name_norm" in self.top_targets.columns:
            top_gene_order = self.top_targets["gene_name_norm"].astype(str).tolist()
        selected_genes = [gene for gene in top_gene_order if gene in frame.index][:genes]
        if len(selected_genes) < genes:
            selected_genes.extend([gene for gene in frame.index.astype(str).tolist() if gene not in selected_genes][: genes - len(selected_genes)])
        frame = frame.loc[selected_genes]
        if frame.shape[1] > samples:
            idx = np.linspace(0, frame.shape[1] - 1, samples).round().astype(int)
            frame = frame.iloc[:, idx]
        values = frame.replace([np.inf, -np.inf], np.nan)
        row_means = values.mean(axis=1)
        row_stds = values.std(axis=1).replace(0, np.nan)
        z = values.sub(row_means, axis=0).div(row_stds, axis=0).clip(-2.5, 2.5).fillna(0)
        return {
            "genes": list(map(str, z.index.tolist())),
            "samples": list(map(str, z.columns.tolist())),
            "matrix": z.round(4).values.tolist(),
            "scale": "row_zscore_log2_tpm",
        }

    def retrieve(self, question: str, limit: int = 5) -> dict[str, Any]:
        settings = get_settings()
        if settings.rag_mode.lower() in {"gemini", "local"}:
            return get_project_rag(settings).answer(question, limit=limit, extra_chunks=self._artifact_rag_chunks(question))

        tokens = {t for t in re.findall(r"[A-Za-z0-9_+-]{3,}", question.upper()) if t not in {"THE", "AND", "FOR", "GENE"}}
        gene_hits = [token for token in tokens if token in self.gene_reports]
        if gene_hits:
            gene = gene_hits[0]
            report = self.gene_report(gene)
            evidence = report.get("report", {}).get("evidence", {})
            tags = ", ".join(report.get("report", {}).get("druggability_tags", []))
            pathways = ", ".join(report.get("report", {}).get("pathways", [])) or "no curated top-target pathway overlap"
            answer = (
                f"{gene}: {report.get('report', {}).get('summary', '')}\n"
                f"Evidence: target rank {evidence.get('target_rank')}, target score {evidence.get('target_score')}, "
                f"integrated evidence {evidence.get('integrated_evidence_score')}, survival FDR {evidence.get('survival_time_fdr')}.\n"
                f"Druggability tags: {tags or 'no curated annotation'}.\n"
                f"Pathway context: {pathways}.\n"
                "Interpretation note: this is candidate-target evidence, not clinical validation."
            )
            return {"answer": answer, "sources": [{"source": "gene_reports.json", "chunk_id": gene, "text": json.dumps(report, default=_json_default)[:2500]}]}
        scored = []
        for row in self.docs_index:
            text_upper = row["text"].upper()
            score = sum(text_upper.count(token) for token in tokens)
            if score:
                scored.append((score, row))
        scored.sort(key=lambda item: item[0], reverse=True)
        contexts = [row for _, row in scored[:limit]]
        if not contexts:
            contexts = self.docs_index[:limit]
        answer = self._compose_retrieval_answer(question, contexts)
        return {"answer": answer, "sources": contexts}

    def _artifact_rag_chunks(self, question: str) -> list[RagChunk]:
        chunks = [self._project_metrics_chunk()]
        for gene in self._question_gene_hits(question):
            chunks.append(self._gene_artifact_chunk(gene))
        if self._asks_about_model(question):
            chunks.append(self._model_artifact_chunk())
        return [chunk for chunk in chunks if chunk.text.strip()]

    def _question_gene_hits(self, question: str, max_hits: int = 4) -> list[str]:
        text_upper = question.upper()
        tokens = re.findall(r"\b[A-Z][A-Z0-9-]{1,}\b", text_upper)
        candidates: set[str] = set(PROTEIN_TARGET_NAMES)
        for frame in [self.protein_target_ranking, self.enriched_targets, self.master, self.feature_importance, self.top_targets]:
            if not frame.empty and "gene_name_norm" in frame.columns:
                candidates.update(frame["gene_name_norm"].astype(str).str.upper().str.strip().dropna().tolist())
        hits: list[str] = []
        for token in tokens:
            if token in candidates and token not in hits:
                hits.append(token)
        for gene, protein in PROTEIN_TARGET_NAMES.items():
            if gene not in hits and protein.upper() in text_upper:
                hits.append(gene)
        return hits[:max_hits]

    @staticmethod
    def _asks_about_model(question: str) -> bool:
        lowered = question.lower()
        return any(term in lowered for term in ["model", "ml", "ranker", "classifier", "predict", "prediction", "unsupervised"])

    @staticmethod
    def _fmt_artifact_value(value: Any, digits: int = 4) -> str:
        if value is None:
            return "not available"
        try:
            if pd.isna(value):
                return "not available"
        except (TypeError, ValueError):
            pass
        if isinstance(value, (float, np.floating)):
            value = float(value)
            if not math.isfinite(value):
                return "not available"
            return f"{value:.{digits}g}"
        if isinstance(value, (int, np.integer)):
            return f"{int(value):,}"
        return str(value)

    def _project_metrics_chunk(self) -> RagChunk:
        network = self.da_summary.get("network", {})
        labels = self.da_summary.get("gdc_labels", {}).get("file_counts", {})
        summary = self.protein_ranker_summary or {}
        text = f"""# Live Project Artifact Metrics

These values come from local project artifacts, not generic biomedical knowledge.

- Disease focus: Lung adenocarcinoma (TCGA-LUAD).
- Main task: rank candidate protein targets inferred from protein-coding genes.
- Primary model: unsupervised protein target ranker.
- Supporting model: logistic regression expression classifier for tumor-like phenotype evidence only.
- GDC sample counts: tumor={self._fmt_artifact_value(labels.get("tumor"))}, normal={self._fmt_artifact_value(labels.get("normal"))}.
- STRING PPI graph: nodes={self._fmt_artifact_value(network.get("graph_nodes"))}, edges={self._fmt_artifact_value(network.get("graph_edges"))}.
- Protein target ranker: targets={self._fmt_artifact_value(summary.get("n_targets"))}, features={self._fmt_artifact_value(summary.get("n_features"))}, clusters={self._fmt_artifact_value(summary.get("n_clusters"))}.

Interpretation rule: high ranking means strong computational association and prioritization for follow-up, not proven causality and not an approved anti-cancer therapy."""
        return RagChunk(source="project_artifacts", chunk_id="live_project_metrics", title="Live Project Artifact Metrics", text=text)

    def _model_artifact_chunk(self) -> RagChunk:
        info = self.model_info()
        ranker = info.get("protein_target_ranker", {})
        summary = ranker.get("summary", {})
        test_metrics = info.get("test_metrics", {})
        text = f"""# ML Model Artifact Context

Primary model:
- Task: unsupervised candidate protein target prioritization.
- Artifact: {ranker.get("artifact")}
- Available: {ranker.get("available")}
- Number of ranked targets: {self._fmt_artifact_value(summary.get("n_targets"))}
- Number of evidence features: {self._fmt_artifact_value(summary.get("n_features"))}
- Number of target clusters: {self._fmt_artifact_value(summary.get("n_clusters"))}

Supporting classifier:
- Model: {info.get("model_name")}
- Protocol: {info.get("protocol")}
- Threshold: {self._fmt_artifact_value(info.get("threshold"))}
- Test accuracy: {self._fmt_artifact_value(test_metrics.get("accuracy"))}
- Test balanced accuracy: {self._fmt_artifact_value(test_metrics.get("balanced_accuracy"))}
- Test ROC-AUC: {self._fmt_artifact_value(test_metrics.get("roc_auc"))}

Interpretation rule: the classifier is auxiliary evidence for tumor-like expression separation. It is not the main drug-target discovery model."""
        return RagChunk(source="project_artifacts", chunk_id="ml_model_context", title="ML Model Artifact Context", text=text)

    def _gene_artifact_chunk(self, gene: str) -> RagChunk:
        payload = self.gene_report(gene)
        features = payload.get("features", {})
        report = payload.get("report", {})
        pathways = report.get("pathways") or []
        tags = report.get("druggability_tags") or []
        fields = [
            ("Protein target", payload.get("protein_target")),
            ("Encoded by gene", payload.get("encoded_by_gene")),
            ("Target rank", features.get("target_rank")),
            ("Target score", features.get("target_score")),
            ("Integrated evidence rank", features.get("integrated_evidence_rank")),
            ("Integrated evidence score", features.get("integrated_evidence_score")),
            ("Protein ML rank", features.get("protein_ml_rank")),
            ("Protein ML priority score", features.get("protein_ml_priority_score")),
            ("Protein target cluster", features.get("protein_target_cluster")),
            ("GDC log2 fold change", features.get("gdc_log2_fc")),
            ("GDC adjusted p-value/FDR", features.get("gdc_adj_p_value")),
            ("GDC -log10 FDR", features.get("gdc_neg_log10_fdr")),
            ("GEO validation status", features.get("geo_validation_status")),
            ("STRING degree", features.get("degree_gene")),
            ("STRING weighted degree", features.get("weighted_degree_gene")),
            ("STRING PageRank", features.get("pagerank")),
            ("STRING betweenness", features.get("betweenness_centrality")),
            ("Druggability class", features.get("druggability_class")),
            ("Drug class", features.get("drug_class")),
            ("Known drugs", features.get("known_drugs")),
            ("Evidence level", features.get("evidence_level")),
            ("Auxiliary classifier model importance", features.get("model_importance")),
        ]
        metrics = "\n".join(f"- {label}: {self._fmt_artifact_value(value)}" for label, value in fields)
        text = f"""# Artifact Evidence for {gene}

{report.get("summary") or "No curated narrative summary is available for this target."}

{metrics}

- Druggability tags: {", ".join(map(str, tags)) if tags else "not available"}
- Pathway context: {", ".join(map(str, pathways)) if pathways else "not available"}

Interpretation rule: {payload.get("protein_target")} is a candidate protein target prioritized by this project. The evidence supports LUAD association or target-prioritization strength, not direct proof that the protein causes cancer and not proof that inhibiting it will be an effective therapy."""
        return RagChunk(source="project_artifacts", chunk_id=f"target_{gene}", title=f"Artifact Evidence for {gene}", text=text)

    @staticmethod
    def _compose_retrieval_answer(question: str, contexts: list[dict[str, str]]) -> str:
        snippets = []
        for row in contexts[:3]:
            text = re.sub(r"\s+", " ", row["text"]).strip()
            snippets.append(f"- {text[:360]}")
        return (
            "Tôi tìm thấy các mảnh tài liệu/artifact liên quan dưới đây. "
            "Ở chế độ local hiện tại chatbot dùng retrieval nội bộ, chưa gọi LLM ngoài. "
            "Tóm tắt nhanh:\n" + "\n".join(snippets)
        )


@lru_cache(maxsize=1)
def get_store() -> ArtifactStore:
    return ArtifactStore()
