# Drug-Target-Project

## LUAD Protein Target Dashboard

This repository includes a dashboard scaffold for visualizing the drug-target prioritization workflow:

- Focused sidebar with Overview, Pipeline Flow, Candidate Ranking, GEO Support and AI Assistant.
- `/pipeline` route with a Vietnamese carousel/stepper explaining ingest, DE, DA and ML workflow details.
- FastAPI backend with `/api/v1` endpoints for all dashboard views.
- Static frontend with chart/table rendering and target detail drawer.
- Visualization mart builder with local JSON fallback and optional HDFS write.
- Optional MongoDB sync for mart snapshots.
- Project-grounded AI assistant using Gemini 2.5 Flash, Google embeddings and persistent ChromaDB retrieval.

### Run locally

Install the backend dependencies:

```bash
python3 -m pip install -r requirements.txt
```

Generate local JSON mart snapshots:

```bash
python3 -m src.distributed.build_visualization_marts
```

Start the dashboard API:

```bash
python3 -m uvicorn src.backend.app:app --host 127.0.0.1 --port 8000 --reload
```

Open:

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/pipeline
```
### Configure and index the RAG knowledge base

Create the local environment file and add a Gemini API key:

```bash
cp .env.example .env
```

Validate that the Markdown knowledge base can be split into `KB-xxx` chunks without calling an external API:

```bash
python3 -m src.backend.jobs.index_rag_knowledge --validate-only
```

Generate Google embeddings and persist the chunks into ChromaDB:

```bash
python3 -m src.backend.jobs.index_rag_knowledge --rebuild
```

The chatbot uses `gemini-2.5-flash` for generation and `gemini-embedding-2` with 768-dimensional vectors by default. Its current configuration and index readiness are exposed at `/api/v1/chat/status`.


The frontend expects real mart snapshots generated from HDFS phase outputs; missing marts are reported explicitly and no mock data fallback is used.

### ML cluster interpretation

Phase 7 uses KMeans on four standardized features: `abs_log2FC`, `log1p(weighted_degree_protein)`, `avg_combined_score`, and `log1p(num_interactions_in_deg_network)`. A candidate is assigned to the nearest centroid; there is no fixed score threshold for entering Cluster 0, 1, or 2.

The dashboard exposes `/api/v1/visualizations/ml/explainability` and shows:

- Unique descriptive labels for each cluster while preserving the original Phase 7 label.
- Candidate counts and empirical min/median/max feature profiles per cluster.
- Distribution of the ranked Top 100 targets across clusters.

Current Top 100 distribution: Cluster 0 = 83, Cluster 1 = 0, Cluster 2 = 17. These counts are computed from the current real mart data rather than hard-coded in the frontend.
