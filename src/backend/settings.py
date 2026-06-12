from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT_DIR / "src" / "frontend"
DEFAULT_MART_DIR = ROOT_DIR / "data" / "mart"
DEFAULT_CHROMA_DIR = Path("/tmp/drugtarget_chroma") if os.getenv("VERCEL") else ROOT_DIR / "data" / "chroma"
load_dotenv(ROOT_DIR / ".env", override=False)


def project_path(value: str) -> Path:
    path = Path(value).expanduser()
    return (ROOT_DIR / path).resolve() if not path.is_absolute() else path.resolve()


def chroma_dir_value() -> str:
    configured = os.getenv("CHROMA_PERSIST_DIR")
    if os.getenv("VERCEL") and configured in {None, "", "data/chroma"}:
        return str(DEFAULT_CHROMA_DIR)
    return configured or str(DEFAULT_CHROMA_DIR)


class Settings:
    app_name = "LUAD Protein Target Dashboard"
    api_prefix = "/api/v1"
    mart_dir = Path(os.getenv("DRUGTARGET_MART_DIR", str(DEFAULT_MART_DIR))).resolve()
    hdfs_mart_path = os.getenv("DRUGTARGET_HDFS_MART_PATH", "/drugtarget/data/mart")
    mongodb_enabled = os.getenv("MONGODB_ENABLED", "false").lower() in {"1", "true", "yes"}
    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongodb_db = os.getenv("MONGODB_DB", "drugtarget_luad")
    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_chat_model = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
    gemini_embedding_model = os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2")
    gemini_embedding_dimension = int(os.getenv("GEMINI_EMBEDDING_DIMENSION", "768"))
    gemini_max_output_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "1400"))
    rag_knowledge_path = project_path(os.getenv("RAG_KNOWLEDGE_PATH", "paper/drug_target_project_rag_knowledge_base.md"))
    chroma_persist_dir = project_path(chroma_dir_value())
    chroma_collection = os.getenv("CHROMA_COLLECTION", "drug_target_project_knowledge")
    rag_vector_export_path = project_path(os.getenv("RAG_VECTOR_EXPORT_PATH", "src/backend/rag/drug_target_project_knowledge_export.json"))
    rag_top_k = int(os.getenv("RAG_TOP_K", "6"))
    rag_max_context_chars = int(os.getenv("RAG_MAX_CONTEXT_CHARS", "24000"))


settings = Settings()
