from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from src.backend.settings import settings


def load_payload(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict) and isinstance(payload.get("items"), list):
        return payload["items"]
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        return payload
    return [{"value": payload}]


def sync_marts(mart_dir: Path, mongo_uri: str, mongo_db: str) -> None:
    try:
        from pymongo import MongoClient
    except ImportError as exc:
        raise SystemExit("pymongo is required for Mongo sync. Install project requirements first.") from exc

    client = MongoClient(mongo_uri)
    db = client[mongo_db]
    count = 0
    for path in sorted(mart_dir.glob("*.json")):
        docs = load_payload(path)
        collection = db[path.stem]
        collection.delete_many({})
        if docs:
            collection.insert_many(docs)
        count += 1
    print(f"Synced {count} mart collections into MongoDB database `{mongo_db}`")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync local visualization mart JSON snapshots to MongoDB.")
    parser.add_argument("--mart-dir", type=Path, default=settings.mart_dir)
    parser.add_argument("--mongo-uri", default=settings.mongodb_uri)
    parser.add_argument("--mongo-db", default=settings.mongodb_db)
    args = parser.parse_args()
    sync_marts(args.mart_dir, args.mongo_uri, args.mongo_db)


if __name__ == "__main__":
    main()
