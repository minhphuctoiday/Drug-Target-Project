# Hướng dẫn frontend

Frontend dashboard là ứng dụng HTML/CSS/JavaScript tĩnh được FastAPI serve trực tiếp. Repo hiện không có bước build bằng npm.

---

## File chính

| File | Vai trò |
|---|---|
| `src/frontend/index.html` | Shell dashboard, sidebar, panel, drawer, modal, include script/style |
| `src/frontend/app.js` | API calls, state management, canvas charts, bảng, filter, chat UI |
| `src/frontend/styles.css` | Layout dashboard, visual system, responsive behavior |
| `src/backend/app.py` | Serve `/`, `/pipeline`, `app.js`, `styles.css` và toàn bộ `/api/v1` endpoints |

Dependency phía browser được load trong `index.html`:

| Dependency | Mục đích |
|---|---|
| Google Fonts Inter | Typography dashboard |
| Lucide UMD CDN | Icon cho sidebar/control |

---

## Chạy local

Cài dependency backend từ root repo:

```bash
python -m pip install -r requirements.txt
```

Start FastAPI:

```bash
python -m uvicorn src.backend.app:app --host 127.0.0.1 --port 8000 --reload
```

Mở:

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/pipeline
```

Frontend gọi API bằng relative path `/api/v1/...`, nên không cần chạy frontend server riêng.

---

## Kết nối API

`app.js` lấy dữ liệu dashboard từ FastAPI:

| Khu vực dashboard | Endpoint chính |
|---|---|
| Health/status | `/api/v1/health`, `/api/v1/chat/status` |
| Overview | `/api/v1/overview` |
| QC | `/api/v1/visualizations/qc/sample-counts`, `/api/v1/visualizations/qc/exclusions`, `/api/v1/visualizations/qc/library-size`, `/api/v1/visualizations/qc/zero-gene-rate` |
| DEG | `/api/v1/visualizations/deg/volcano`, `/api/v1/visualizations/deg/summary`, `/api/v1/visualizations/deg/top-genes`, `/api/v1/visualizations/deg/heatmap` |
| Mapping | `/api/v1/visualizations/mapping/summary`, `/api/v1/visualizations/mapping/confidence`, `/api/v1/mapping/unmapped` |
| Network | `/api/v1/visualizations/network`, `/api/v1/visualizations/network/top-proteins`, `/api/v1/visualizations/network/score-distribution` |
| Ranking | `/api/v1/targets`, `/api/v1/targets/{protein_id}`, `/api/v1/targets/{protein_id}/score-breakdown` |
| GEO | `/api/v1/visualizations/geo/summary`, `/api/v1/visualizations/geo/top-supported`, `/api/v1/visualizations/geo/gdc-vs-support`, `/api/v1/visualizations/geo/top-candidate-overlap`, `/api/v1/geo/unmatched-candidates` |
| ML | `/api/v1/visualizations/ml/k-selection`, `/api/v1/visualizations/ml/scatter`, `/api/v1/visualizations/ml/cluster-summary`, `/api/v1/ml/clusters`, `/api/v1/visualizations/ml/explainability` |
| AI Assistant | `POST /api/v1/chat` |

Dữ liệu chart đến từ local mart repository (`data/mart/*.json`) hoặc MongoDB nếu được bật và kết nối thành công.

---

## Data contract giữa API và frontend

Dashboard đầy đủ cần các mart tiêu biểu sau:

```text
data/mart/overview_summary.json
data/mart/top_candidate_targets_enriched.json
data/mart/volcano_points.json
data/mart/ppi_visualization_nodes.json
data/mart/ppi_visualization_edges.json
data/mart/ml_cluster_points.json
```

Nếu thiếu mart, backend trả payload unavailable. Frontend không dùng mock data fallback.

---

## RAG Assistant

Panel trợ lý AI dùng backend:

```text
src/backend/rag/service.py
src/backend/jobs/index_rag_knowledge.py
paper/drug_target_project_rag_knowledge_base.md
```

Thiết lập:

```bash
cp .env.example .env
python -m src.backend.jobs.index_rag_knowledge --validate-only
python -m src.backend.jobs.index_rag_knowledge --rebuild
```

Cần đặt `GEMINI_API_KEY` trong `.env` trước khi chạy `--rebuild` hoặc dùng `/api/v1/chat`.

---

## Ghi chú deploy

- `app.py` ở root export FastAPI app cho các nền tảng tìm entrypoint Python ở root.
- `src/index.py` cũng export cùng app cho cơ chế ASGI discovery khác.
- `.vercelignore` loại notebook và folder pipeline lớn khỏi Vercel deployment.
- Không có frontend build artifact directory. App serve trực tiếp `src/frontend/index.html`, `app.js`, `styles.css`.
