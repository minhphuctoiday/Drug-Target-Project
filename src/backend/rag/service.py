from __future__ import annotations

import json
import importlib.util
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..settings import settings
from .knowledge import document_for_embedding, parse_knowledge_markdown


class RagConfigurationError(RuntimeError):
    """Raised when the RAG service cannot run with the current configuration."""


@dataclass(frozen=True)
class RetrievedChunk:
    document: str
    metadata: dict[str, Any]
    distance: float

    @property
    def similarity(self) -> float:
        return max(0.0, min(1.0, 1.0 - self.distance))


def dependency_available(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except ModuleNotFoundError:
        return False


class RagService:
    def __init__(self) -> None:
        self.knowledge_path: Path = settings.rag_knowledge_path
        self.persist_dir: Path = settings.chroma_persist_dir
        self.collection_name = settings.chroma_collection
        self.vector_export_path: Path = settings.rag_vector_export_path
        self.chat_model = settings.gemini_chat_model
        self.embedding_model = settings.gemini_embedding_model
        self.embedding_dimension = settings.gemini_embedding_dimension
        self.top_k = settings.rag_top_k
        self.max_context_chars = settings.rag_max_context_chars
        self.max_output_tokens = settings.gemini_max_output_tokens
        self.api_key = settings.gemini_api_key
        self._genai_client: Any | None = None
        self._chroma_client: Any | None = None

    def _require_dependencies(self) -> None:
        missing = [
            package
            for package, module in (("chromadb", "chromadb"), ("google-genai", "google.genai"))
            if not dependency_available(module)
        ]
        if missing:
            raise RagConfigurationError(
                f"Missing RAG dependencies: {', '.join(missing)}. Install requirements.txt first."
            )

    def _require_api_key(self) -> None:
        if not self.api_key:
            raise RagConfigurationError(
                "GEMINI_API_KEY is not configured. Copy .env.example to .env and add the key."
            )

    def _google_client(self) -> Any:
        self._require_api_key()
        if self._genai_client is None:
            from google import genai

            self._genai_client = genai.Client(api_key=self.api_key)
        return self._genai_client

    def _persistent_client(self) -> Any:
        self._require_dependencies()
        if self._chroma_client is None:
            import chromadb

            self.persist_dir.mkdir(parents=True, exist_ok=True)
            self._chroma_client = chromadb.PersistentClient(path=str(self.persist_dir))
        return self._chroma_client

    def _collection(self, create: bool = True) -> Any:
        client = self._persistent_client()
        if create:
            return client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )
        return client.get_collection(name=self.collection_name)

    def _embed(self, content: str) -> list[float]:
        from google.genai import types

        last_error: Exception | None = None
        for attempt in range(1, 6):
            try:
                response = self._google_client().models.embed_content(
                    model=self.embedding_model,
                    contents=content,
                    config=types.EmbedContentConfig(output_dimensionality=self.embedding_dimension),
                )
                if not response.embeddings or not response.embeddings[0].values:
                    raise RagConfigurationError("Google embedding API returned no embedding values.")
                return list(response.embeddings[0].values)
            except Exception as exc:
                last_error = exc
                if attempt == 5:
                    break
                time.sleep(min(2 ** attempt, 12))
        raise RagConfigurationError(f"Google embedding API failed after retries: {last_error}")

    def _export_collection(self, collection: Any, source_chunks: int) -> None:
        data = collection.get(include=["documents", "metadatas", "embeddings"])
        raw_embeddings = data.get("embeddings")
        embeddings = raw_embeddings if raw_embeddings is not None else []
        export = {
            "collection": self.collection_name,
            "embedding_model": self.embedding_model,
            "embedding_dimension": self.embedding_dimension,
            "source_chunks": source_chunks,
            "ids": data.get("ids", []),
            "documents": data.get("documents", []),
            "metadatas": data.get("metadatas", []),
            "embeddings": [[float(value) for value in row] for row in embeddings],
        }
        self.vector_export_path.parent.mkdir(parents=True, exist_ok=True)
        self.vector_export_path.write_text(json.dumps(export, ensure_ascii=False), encoding="utf-8")

    def _hydrate_from_export_if_needed(self) -> bool:
        if not self.vector_export_path.exists():
            return False
        payload = json.loads(self.vector_export_path.read_text(encoding="utf-8"))
        ids = payload.get("ids") or []
        if not ids:
            return False

        collection = self._collection(create=True)
        if collection.count() >= len(ids):
            return False

        collection.upsert(
            ids=ids,
            documents=payload.get("documents") or [],
            metadatas=payload.get("metadatas") or [],
            embeddings=payload.get("embeddings") or [],
        )
        return True

    def status(self) -> dict[str, Any]:
        dependencies_ready = dependency_available("chromadb") and dependency_available("google.genai")
        indexed_chunks = 0
        source_chunks = 0
        index_error = ""
        if self.knowledge_path.exists():
            try:
                source_chunks = len(parse_knowledge_markdown(self.knowledge_path))
            except Exception as exc:
                index_error = str(exc)
        if dependency_available("chromadb"):
            try:
                self._hydrate_from_export_if_needed()
                indexed_chunks = self._collection(create=False).count()
            except Exception as exc:
                index_error = str(exc)
        ready = bool(self.api_key and dependencies_ready and source_chunks and indexed_chunks >= source_chunks)

        return {
            "mode": "gemini_rag",
            "ready": ready,
            "api_key_configured": bool(self.api_key),
            "dependencies_ready": dependencies_ready,
            "knowledge_base_exists": self.knowledge_path.exists(),
            "indexed_chunks": indexed_chunks,
            "source_chunks": source_chunks,
            "index_error": index_error,
            "chat_model": self.chat_model,
            "embedding_model": self.embedding_model,
            "embedding_dimension": self.embedding_dimension,
            "collection": self.collection_name,
            "vector_export_exists": self.vector_export_path.exists(),
        }

    def index_knowledge(self, rebuild: bool = False) -> dict[str, Any]:
        self._require_dependencies()
        self._require_api_key()
        chunks = parse_knowledge_markdown(self.knowledge_path)
        client = self._persistent_client()
        if rebuild:
            try:
                client.delete_collection(self.collection_name)
            except Exception:
                pass
        collection = self._collection()

        current_ids = set(collection.get(include=[])["ids"])
        desired_ids = {chunk.id for chunk in chunks}
        stale_ids = sorted(current_ids - desired_ids)
        if stale_ids:
            collection.delete(ids=stale_ids)

        for chunk in chunks:
            collection.upsert(
                ids=[chunk.id],
                documents=[chunk.text],
                metadatas=[chunk.metadata],
                embeddings=[self._embed(document_for_embedding(chunk))],
            )

        self._export_collection(collection, source_chunks=len(chunks))

        return {
            "indexed_chunks": collection.count(),
            "source_chunks": len(chunks),
            "deleted_stale_chunks": len(stale_ids),
            "collection": self.collection_name,
            "persist_dir": str(self.persist_dir),
            "vector_export_path": str(self.vector_export_path),
            "embedding_model": self.embedding_model,
            "embedding_dimension": self.embedding_dimension,
        }

    def retrieve(self, question: str, top_k: int | None = None) -> list[RetrievedChunk]:
        self._require_dependencies()
        self._require_api_key()
        self._hydrate_from_export_if_needed()
        try:
            collection = self._collection(create=False)
        except Exception as exc:
            raise RagConfigurationError("The ChromaDB collection does not exist. Run the RAG index job first.") from exc
        if not collection.count():
            raise RagConfigurationError("The ChromaDB collection is empty. Run the RAG index job first.")

        query = f"task: question answering | query: {question}"
        result = collection.query(
            query_embeddings=[self._embed(query)],
            n_results=min(top_k or self.top_k, collection.count()),
            include=["documents", "metadatas", "distances"],
        )
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]
        return [
            RetrievedChunk(document=document, metadata=metadata or {}, distance=float(distance))
            for document, metadata, distance in zip(documents, metadatas, distances)
        ]

    def answer(self, question: str, target_context: str = "", mart_context: str = "") -> dict[str, Any]:
        chunks = self.retrieve(question)
        context_parts: list[str] = []
        used_chars = 0
        for chunk in chunks:
            kb_id = chunk.metadata.get("kb_id", "KB")
            part = f"[{kb_id}]\n{chunk.document}"
            if context_parts and used_chars + len(part) > self.max_context_chars:
                break
            context_parts.append(part)
            used_chars += len(part)

        context = "\n\n---\n\n".join(context_parts)
        prompt = (
            f"Câu hỏi của người dùng:\n{question}\n\n"
            f"Target đang được chọn trên dashboard:\n{target_context or 'Không có target cụ thể.'}\n\n"
            f"Dữ liệu real mart hiện tại của dashboard:\n{mart_context or 'Không có mart context bổ sung.'}\n\n"
            f"Tri thức truy xuất từ project:\n{context}"
        )
        system_instruction = (
            "Bạn là trợ lý kỹ thuật của DrugTargetProject. Trả lời bằng tiếng Việt, rõ ràng và đúng với "
            "tri thức và real mart data được cung cấp. Với số liệu hiện tại của dashboard, ưu tiên dữ liệu trong "
            "block real mart vì đó là snapshot thật đang được backend đọc. Dùng citation dạng [MART] cho số liệu mart "
            "và [KB-xxx] cho khái niệm/công thức từ knowledge base. Nếu context không đủ, nói rõ phần "
            "nào chưa xác định thay vì suy đoán. Phân biệt candidate ưu tiên với drug target đã được xác thực."
        )

        from google.genai import types

        response = self._google_client().models.generate_content(
            model=self.chat_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                max_output_tokens=self.max_output_tokens,
                temperature=0.2,
            ),
        )
        answer = (response.text or "").strip()
        if not answer:
            raise RagConfigurationError("Gemini returned an empty answer.")

        citations = [
            {
                "chunk_id": chunk.metadata.get("kb_id", ""),
                "title": chunk.metadata.get("title", ""),
                "keywords": chunk.metadata.get("keywords", ""),
                "source_of_truth": chunk.metadata.get("source_of_truth", ""),
                "similarity": round(chunk.similarity, 4),
            }
            for chunk in chunks
        ]
        return {
            "mode": "gemini_rag",
            "answer": answer,
            "citations": citations,
            "model": self.chat_model,
            "retrieved_chunks": len(chunks),
        }


_rag_service: RagService | None = None


def get_rag_service() -> RagService:
    global _rag_service
    if _rag_service is None:
        _rag_service = RagService()
    return _rag_service
