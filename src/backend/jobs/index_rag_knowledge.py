from __future__ import annotations

import argparse
import json

from ..rag.knowledge import parse_knowledge_markdown
from ..rag.service import RagConfigurationError, get_rag_service


def main() -> int:
    parser = argparse.ArgumentParser(description="Chunk and index the project knowledge base into ChromaDB.")
    parser.add_argument("--rebuild", action="store_true", help="Delete and rebuild the Chroma collection.")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Parse and validate chunks without calling Google embeddings or writing ChromaDB.",
    )
    args = parser.parse_args()

    service = get_rag_service()
    if args.validate_only:
        chunks = parse_knowledge_markdown(service.knowledge_path)
        print(json.dumps({"valid_chunks": len(chunks), "knowledge_path": str(service.knowledge_path)}, indent=2))
        return 0

    try:
        result = service.index_knowledge(rebuild=args.rebuild)
    except RagConfigurationError as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
