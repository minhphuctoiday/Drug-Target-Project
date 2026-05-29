from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.mixture import GaussianMixture
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import MinMaxScaler, RobustScaler


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUTS = PROJECT_ROOT / "outputs"
ML_MODELS = OUTPUTS / "ml_models"
BIO_EVIDENCE = OUTPUTS / "biological_evidence"
ML_INPUTS = OUTPUTS / "ml_inputs"


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
}


def read_table(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    if path.suffix == ".csv":
        return pd.read_csv(path)
    return pd.read_parquet(path)


def minmax(series: pd.Series) -> pd.Series:
    values = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    if values.notna().sum() == 0:
        return pd.Series(np.zeros(len(values)), index=values.index)
    lo = values.min()
    hi = values.max()
    if not np.isfinite(lo) or not np.isfinite(hi) or hi == lo:
        return pd.Series(np.zeros(len(values)), index=values.index)
    return ((values - lo) / (hi - lo)).clip(0, 1).fillna(0)


def percentile_score(values: np.ndarray) -> np.ndarray:
    series = pd.Series(values).replace([np.inf, -np.inf], np.nan).fillna(np.nanmedian(values))
    return series.rank(method="average", pct=True).to_numpy()


def load_feature_table() -> pd.DataFrame:
    enriched = read_table(BIO_EVIDENCE / "target_evidence_enriched.parquet")
    target_features = read_table(ML_INPUTS / "target_prioritization_features.parquet")
    master = read_table(OUTPUTS / "master_biomarker_features.parquet")
    importance = read_table(ML_MODELS / "best_model_feature_importance_joined.parquet")
    if importance.empty:
        importance = read_table(ML_INPUTS / "model_feature_importance_joined.parquet")

    base = enriched if not enriched.empty else target_features
    if base.empty:
        base = master
    if base.empty or "gene_name_norm" not in base.columns:
        raise FileNotFoundError("No target feature table found. Expected biological_evidence or ml_inputs artifacts.")

    frame = base.copy()
    frame["gene_name_norm"] = frame["gene_name_norm"].astype(str).str.upper().str.strip()

    for extra in [target_features, master, importance]:
        if extra.empty or "gene_name_norm" not in extra.columns:
            continue
        extra = extra.copy()
        extra["gene_name_norm"] = extra["gene_name_norm"].astype(str).str.upper().str.strip()
        keep = [c for c in extra.columns if c == "gene_name_norm" or c not in frame.columns]
        frame = frame.merge(extra[keep], on="gene_name_norm", how="left")

    frame = frame.drop_duplicates("gene_name_norm").reset_index(drop=True)
    return frame


def build_ranker(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    feature_candidates = [
        "gdc_abs_log2_fc",
        "gdc_neg_log10_fdr",
        "gdc_neg_log10_p",
        "target_score",
        "integrated_evidence_score",
        "expression_component",
        "network_component",
        "validation_component",
        "druggability_score",
        "model_component",
        "survival_component",
        "degree_gene",
        "weighted_degree_gene",
        "pagerank",
        "betweenness_centrality",
        "geo_validation_bonus",
        "geo_component_score",
        "model_importance",
        "survival_time_neg_log10_fdr",
    ]
    feature_cols = [c for c in feature_candidates if c in frame.columns]
    if len(feature_cols) < 5:
        raise ValueError(f"Too few usable protein target features: {feature_cols}")

    x = frame[feature_cols].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    n = len(x)
    n_clusters = int(np.clip(round(np.sqrt(n / 2)), 4, 12))
    contamination = float(np.clip(80 / max(n, 1), 0.03, 0.12))
    gmm_components = int(np.clip(n_clusters // 2, 2, 6))

    preprocess = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", RobustScaler()),
    ])
    x_scaled = preprocess.fit_transform(x)

    pca_components = min(12, x_scaled.shape[1], max(2, x_scaled.shape[0] - 1))
    pca = PCA(n_components=pca_components, random_state=42)
    x_pca = pca.fit_transform(x_scaled)

    isolation = IsolationForest(
        n_estimators=600,
        contamination=contamination,
        random_state=42,
        n_jobs=-1,
    )
    isolation.fit(x_pca)
    isolation_priority = percentile_score(-isolation.score_samples(x_pca))

    kmeans = KMeans(n_clusters=n_clusters, n_init=30, random_state=42)
    clusters = kmeans.fit_predict(x_pca)

    gmm = GaussianMixture(n_components=gmm_components, covariance_type="full", random_state=42, reg_covar=1e-5)
    gmm.fit(x_pca)
    gmm_rarity = percentile_score(-gmm.score_samples(x_pca))

    evidence_parts = []
    for col in [
        "target_score",
        "integrated_evidence_score",
        "gdc_abs_log2_fc",
        "gdc_neg_log10_fdr",
        "network_component",
        "druggability_score",
        "model_importance",
    ]:
        if col in frame.columns:
            evidence_parts.append(minmax(frame[col]))
    evidence_prior = np.mean(np.vstack([p.to_numpy() for p in evidence_parts]), axis=0) if evidence_parts else np.zeros(n)

    cluster_table = pd.DataFrame({"cluster": clusters, "evidence_prior": evidence_prior})
    cluster_priority_map = cluster_table.groupby("cluster")["evidence_prior"].mean().rank(pct=True).to_dict()
    cluster_priority = np.array([cluster_priority_map[c] for c in clusters])

    score = (
        0.34 * isolation_priority
        + 0.24 * gmm_rarity
        + 0.24 * cluster_priority
        + 0.18 * evidence_prior
    )

    result = frame.copy()
    result["encoded_by_gene"] = result["gene_name_norm"]
    result["protein_target"] = result["gene_name_norm"].map(lambda g: PROTEIN_TARGET_NAMES.get(g, f"{g} protein"))
    result["protein_target_cluster"] = clusters.astype(int)
    result["isolation_priority_score"] = isolation_priority
    result["gmm_rarity_score"] = gmm_rarity
    result["cluster_priority_score"] = cluster_priority
    result["evidence_prior_score"] = evidence_prior
    result["protein_ml_priority_score"] = minmax(pd.Series(score)).to_numpy()
    result["protein_ml_rank"] = result["protein_ml_priority_score"].rank(method="dense", ascending=False).astype(int)
    result = result.sort_values(["protein_ml_rank", "target_rank"], na_position="last").reset_index(drop=True)

    bundle = {
        "task": "unsupervised_protein_target_prioritization",
        "feature_cols": feature_cols,
        "preprocess": preprocess,
        "pca": pca,
        "isolation_forest": isolation,
        "kmeans": kmeans,
        "gmm": gmm,
        "score_formula": "0.34*isolation + 0.24*gmm_rarity + 0.24*cluster_priority + 0.18*evidence_prior",
        "n_targets": int(n),
        "n_clusters": int(n_clusters),
        "contamination": contamination,
        "interpretation": "Ranks candidate protein targets from multi-omics and STRING PPI feature profiles without target/non-target labels.",
    }
    summary = {
        "task": bundle["task"],
        "n_targets": int(n),
        "n_features": len(feature_cols),
        "feature_cols": feature_cols,
        "n_clusters": int(n_clusters),
        "contamination": contamination,
        "top_30": result[
            [
                "protein_ml_rank",
                "protein_target",
                "encoded_by_gene",
                "protein_ml_priority_score",
                "protein_target_cluster",
                *[c for c in ["target_rank", "target_score", "integrated_evidence_score", "druggability_class"] if c in result.columns],
            ]
        ].head(30).to_dict(orient="records"),
    }
    return result, {"bundle": bundle, "summary": summary}


def main() -> None:
    ML_MODELS.mkdir(parents=True, exist_ok=True)
    frame = load_feature_table()
    ranking, payload = build_ranker(frame)

    ranking.to_parquet(ML_MODELS / "protein_target_ranking.parquet", index=False)
    ranking.to_csv(ML_MODELS / "protein_target_ranking.csv", index=False)
    ranking.head(100).to_csv(ML_MODELS / "top_100_protein_target_ranking.csv", index=False)
    joblib.dump(payload["bundle"], ML_MODELS / "protein_target_ranker.joblib")
    with (ML_MODELS / "protein_target_ranker_summary.json").open("w", encoding="utf-8") as f:
        json.dump(payload["summary"], f, indent=2)

    print("DONE")
    print(f"Saved: {ML_MODELS / 'protein_target_ranker.joblib'}")
    print(f"Ranking: {ML_MODELS / 'protein_target_ranking.csv'}")
    print(ranking[["protein_ml_rank", "protein_target", "encoded_by_gene", "protein_ml_priority_score", "protein_target_cluster"]].head(20))


if __name__ == "__main__":
    main()
