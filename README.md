# Drug-Target-Project

## LUAD Protein Target Dashboard

This repository includes a dashboard scaffold for visualizing the drug-target prioritization workflow:

- Focused sidebar with Overview, Pipeline Flow, Candidate Ranking, GEO Support and AI Assistant.
- `/pipeline` route with a Vietnamese carousel/stepper explaining ingest, DE, DA and ML workflow details.
- FastAPI backend with `/api/v1` endpoints for all dashboard views.
- Static frontend with chart/table rendering and target detail drawer.
- Visualization mart builder with local JSON fallback and optional HDFS write.
- Optional MongoDB sync for mart snapshots.
- AI Assistant UI only. Model API, RAG and finetune are intentionally not connected.

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

The frontend expects real mart snapshots generated from HDFS phase outputs; missing marts are reported explicitly and no mock data fallback is used.
