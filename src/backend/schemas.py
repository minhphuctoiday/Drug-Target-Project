from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ExpressionPayload(BaseModel):
    expression: dict[str, float] = Field(
        ...,
        description="Mapping from protein-coding gene symbol to TPM or log2(TPM+1) value. These genes encode candidate protein targets.",
        examples=[{"TP53": 18.2, "SPP1": 120.4, "PLK1": 12.0}],
    )
    input_scale: Literal["tpm", "log2_tpm"] = "tpm"
    top_k: int = Field(12, ge=1, le=50)


class PredictResponse(BaseModel):
    label: Literal["Tumor", "Normal"]
    probability_tumor: float
    threshold: float
    confidence: float
    supplied_features: int
    missing_features: int
    top_contributions: list[dict]


class ChatPayload(BaseModel):
    question: str = Field(..., min_length=2)
    limit: int = Field(5, ge=1, le=10)
