from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "development")
    outputs_dir: Path = Path(os.getenv("OUTPUTS_DIR", PROJECT_ROOT / "outputs"))
    refined_dir: Path = Path(os.getenv("REFINED_DIR", PROJECT_ROOT / "data" / "refined"))
    model_artifact_path: Path | None = Path(os.getenv("MODEL_ARTIFACT_PATH")) if os.getenv("MODEL_ARTIFACT_PATH") else None
    mongodb_enabled: bool = os.getenv("MONGODB_ENABLED", "false").lower() == "true"
    mongodb_uri: str = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongodb_db: str = os.getenv("MONGODB_DB", "drugtarget_luad")
    mongodb_predictions_collection: str = os.getenv("MONGODB_PREDICTIONS_COLLECTION", "predictions")
    mongodb_chat_collection: str = os.getenv("MONGODB_CHAT_COLLECTION", "chat_events")
    mongodb_reports_collection: str = os.getenv("MONGODB_REPORTS_COLLECTION", "protein_target_reports")
    rag_mode: str = os.getenv("RAG_MODE", "local")
    rag_knowledge_base_path: Path = Path(os.getenv("RAG_KNOWLEDGE_BASE_PATH", PROJECT_ROOT / "docs" / "project_knowledge_base.md"))
    rag_index_path: Path = Path(os.getenv("RAG_INDEX_PATH", PROJECT_ROOT / "outputs" / "rag" / "project_knowledge_index.json"))
    rag_chunk_size: int = int(os.getenv("RAG_CHUNK_SIZE", "1200"))
    rag_chunk_overlap: int = int(os.getenv("RAG_CHUNK_OVERLAP", "160"))
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    gemini_embedding_model: str = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
