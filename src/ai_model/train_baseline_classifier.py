from __future__ import annotations

import json
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUTS = Path(os.environ.get("DRUGTARGET_OUTPUTS_DIR", PROJECT_ROOT / "outputs"))
ML_INPUTS = OUTPUTS / "ml_inputs"
MODEL_DIR = PROJECT_ROOT / "src" / "ai_model"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def load_split(split: str) -> tuple[pd.DataFrame, pd.Series]:
    x = pd.read_parquet(ML_INPUTS / f"X_{split}.parquet")
    y_frame = pd.read_parquet(ML_INPUTS / f"y_{split}.parquet")
    y = y_frame.set_index("file_id").reindex(x.index)["label"].astype(int)
    return x, y


def build_model(c: float) -> Pipeline:
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            (
                "model",
                LogisticRegression(
                    C=c,
                    penalty="l2",
                    solver="liblinear",
                    class_weight="balanced",
                    random_state=42,
                    max_iter=2000,
                ),
            ),
        ]
    )


def evaluate(model: Pipeline, x: pd.DataFrame, y: pd.Series) -> dict:
    proba = model.predict_proba(x)[:, 1]
    pred = (proba >= 0.5).astype(int)
    return {
        "accuracy": float(accuracy_score(y, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "roc_auc": float(roc_auc_score(y, proba)),
        "average_precision": float(average_precision_score(y, proba)),
        "confusion_matrix": confusion_matrix(y, pred).tolist(),
        "classification_report": classification_report(
            y,
            pred,
            target_names=["normal", "tumor"],
            output_dict=True,
            zero_division=0,
        ),
    }


def main() -> None:
    x_train, y_train = load_split("train")
    x_val, y_val = load_split("val")
    x_test, y_test = load_split("test")

    candidates = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0]
    val_results = []
    best_model = None
    best_result = None
    for c in candidates:
        model = build_model(c)
        model.fit(x_train, y_train)
        result = evaluate(model, x_val, y_val)
        result["C"] = c
        val_results.append(result)
        if best_result is None or (result["roc_auc"], result["accuracy"]) > (
            best_result["roc_auc"],
            best_result["accuracy"],
        ):
            best_result = result
            best_model = model

    assert best_model is not None
    train_result = evaluate(best_model, x_train, y_train)
    test_result = evaluate(best_model, x_test, y_test)
    coefficients = best_model.named_steps["model"].coef_[0]
    feature_importance = (
        pd.DataFrame(
            {
                "gene_name_norm": x_train.columns,
                "coefficient": coefficients,
                "abs_coefficient": np.abs(coefficients),
            }
        )
        .sort_values("abs_coefficient", ascending=False)
        .reset_index(drop=True)
    )
    feature_importance.to_parquet(ML_INPUTS / "baseline_logistic_feature_importance.parquet", index=False)
    joblib.dump(best_model, MODEL_DIR / "baseline_tumor_normal_logistic.joblib")

    metrics = {
        "model": "LogisticRegression L2 class_weight=balanced",
        "selection_protocol": "C selected on validation split only, test evaluated once",
        "class_balance_note": "TCGA-LUAD refined intersection has few Solid Tissue Normal files, so normal-class recall/precision and balanced accuracy matter more than plain accuracy.",
        "train": train_result,
        "best_validation": best_result,
        "validation_grid": val_results,
        "test": test_result,
        "n_features": int(x_train.shape[1]),
        "n_train": int(x_train.shape[0]),
        "n_val": int(x_val.shape[0]),
        "n_test": int(x_test.shape[0]),
    }
    with (ML_INPUTS / "baseline_logistic_metrics.json").open("w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
