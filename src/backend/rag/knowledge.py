from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


SECTION_PATTERN = re.compile(r"(?=^## KB-\d{3}:)", re.MULTILINE)
TITLE_PATTERN = re.compile(r"^## (KB-\d{3}):\s*(.+?)\s*$")
CHUNK_ID_PATTERN = re.compile(r"\*\*chunk_id:\*\*\s*`([^`]+)`")
KEYWORDS_PATTERN = re.compile(r"\*\*keywords:\*\*\s*`([^`]+)`")
SOURCE_PATTERN = re.compile(r"\*\*source_of_truth:\*\*\s*`([^`]+)`")


@dataclass(frozen=True)
class KnowledgeChunk:
    id: str
    title: str
    text: str
    metadata: dict[str, str]


def parse_knowledge_markdown(path: Path) -> list[KnowledgeChunk]:
    if not path.exists():
        raise FileNotFoundError(f"Knowledge base not found: {path}")

    content = path.read_text(encoding="utf-8")
    chunks: list[KnowledgeChunk] = []
    seen_ids: set[str] = set()

    for section in SECTION_PATTERN.split(content):
        section = section.strip()
        if not section.startswith("## KB-"):
            continue

        lines = section.splitlines()
        title_match = TITLE_PATTERN.match(lines[0])
        if not title_match:
            continue

        kb_id, title = title_match.groups()
        chunk_id_match = CHUNK_ID_PATTERN.search(section)
        keywords_match = KEYWORDS_PATTERN.search(section)
        source_match = SOURCE_PATTERN.search(section)
        stable_id = chunk_id_match.group(1) if chunk_id_match else kb_id.lower()
        if stable_id in seen_ids:
            raise ValueError(f"Duplicate chunk_id in knowledge base: {stable_id}")
        seen_ids.add(stable_id)

        chunks.append(
            KnowledgeChunk(
                id=stable_id,
                title=f"{kb_id}: {title}",
                text=section,
                metadata={
                    "kb_id": kb_id,
                    "title": title,
                    "keywords": keywords_match.group(1) if keywords_match else "",
                    "source_of_truth": source_match.group(1) if source_match else "",
                    "source_file": str(path),
                },
            )
        )

    if not chunks:
        raise ValueError(f"No KB-xxx sections found in knowledge base: {path}")
    return chunks


def document_for_embedding(chunk: KnowledgeChunk) -> str:
    return f"title: {chunk.title} | text: {chunk.text}"
