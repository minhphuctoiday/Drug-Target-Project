from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.backend.settings import get_settings


class MongoLogger:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = None
        self.db = None
        if not self.settings.mongodb_enabled:
            return
        try:
            from pymongo import MongoClient

            self.client = MongoClient(self.settings.mongodb_uri, serverSelectionTimeoutMS=1500)
            self.client.admin.command("ping")
            self.db = self.client[self.settings.mongodb_db]
        except Exception as exc:  # pragma: no cover - optional runtime integration
            print(f"MongoDB logging disabled: {exc}")
            self.client = None
            self.db = None

    @property
    def enabled(self) -> bool:
        return self.db is not None

    def insert(self, collection: str, payload: dict[str, Any]) -> None:
        if not self.enabled:
            return
        doc = {"created_at": datetime.now(timezone.utc), **payload}
        self.db[collection].insert_one(doc)


mongo_logger = MongoLogger()
