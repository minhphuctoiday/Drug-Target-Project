from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class MartRepository:
    def __init__(self, mart_dir: Path, mongodb_enabled: bool = False, mongodb_uri: str = "", mongodb_db: str = ""):
        self.mart_dir = mart_dir
        self.mongodb_enabled = mongodb_enabled
        self.mongodb_uri = mongodb_uri
        self.mongodb_db = mongodb_db
        self._mongo_db = None
        if mongodb_enabled:
            self._mongo_db = self._connect_mongo()

    @property
    def source_label(self) -> str:
        if self._mongo_db is not None:
            return "mongo"
        if self.mart_dir.exists():
            return "json"
        return "missing_real_mart"

    def _connect_mongo(self) -> Any | None:
        try:
            from pymongo import MongoClient

            client = MongoClient(self.mongodb_uri, serverSelectionTimeoutMS=800)
            client.admin.command("ping")
            return client[self.mongodb_db]
        except Exception:
            return None

    def read(self, mart_name: str) -> Any | None:
        if self._mongo_db is not None:
            data = self._read_mongo(mart_name)
            if data is not None:
                return data
        return self._read_json(mart_name)

    def _read_mongo(self, mart_name: str) -> Any | None:
        docs = list(self._mongo_db[mart_name].find({}, {"_id": 0}))
        if not docs:
            return None
        if len(docs) == 1 and set(docs[0]).issubset({"items", "metrics", "pipeline", "summary", "mode", "description", "selected_k", "genes", "samples", "sample_groups", "matrix", "value_label"}):
            return docs[0]
        return {"items": docs}

    def _read_json(self, mart_name: str) -> Any | None:
        candidates = [
            self.mart_dir / f"{mart_name}.json",
            self.mart_dir / mart_name / "data.json",
            self.mart_dir / mart_name / "part-00000.json",
        ]
        for path in candidates:
            if path.exists():
                with path.open("r", encoding="utf-8") as handle:
                    return json.load(handle)
        directory = self.mart_dir / mart_name
        if directory.exists():
            items: list[Any] = []
            for path in sorted(directory.glob("*.json")):
                with path.open("r", encoding="utf-8") as handle:
                    loaded = json.load(handle)
                if isinstance(loaded, list):
                    items.extend(loaded)
                elif isinstance(loaded, dict) and "items" in loaded:
                    items.extend(loaded["items"])
                else:
                    items.append(loaded)
            if items:
                return {"items": items}
        return None
