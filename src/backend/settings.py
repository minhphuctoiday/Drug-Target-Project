from __future__ import annotations

import os
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT_DIR / "src" / "frontend"
DEFAULT_MART_DIR = ROOT_DIR / "data" / "mart"


class Settings:
    app_name = "LUAD Protein Target Dashboard"
    api_prefix = "/api/v1"
    mart_dir = Path(os.getenv("DRUGTARGET_MART_DIR", str(DEFAULT_MART_DIR))).resolve()
    hdfs_mart_path = os.getenv("DRUGTARGET_HDFS_MART_PATH", "/drugtarget/data/mart")
    mongodb_enabled = os.getenv("MONGODB_ENABLED", "false").lower() in {"1", "true", "yes"}
    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongodb_db = os.getenv("MONGODB_DB", "drugtarget_luad")


settings = Settings()
