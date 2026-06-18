# DrugTargetProject

**Nền tảng Big Data ưu tiên hóa protein target cho LUAD**

DrugTargetProject là hệ thống dữ liệu lớn dùng để thu thập, làm sạch, phân tích và trực quan hóa bằng chứng liên quan đến drug-target/protein-target cho ung thư biểu mô tuyến phổi (LUAD). Dự án kết hợp dữ liệu expression từ GDC/TCGA, mạng tương tác protein từ STRING và bằng chứng hỗ trợ từ GEO để tạo danh sách protein candidate được xếp hạng, sau đó hiển thị qua FastAPI dashboard và trợ lý RAG tùy chọn.

---

## Tổng quan dự án

Luồng chính của repo:

1. **Ingest** dữ liệu thô GDC, STRING và GEO vào HDFS.
2. **Cleaning** dữ liệu raw thành các bảng Apache Parquet chuẩn hóa ở HDFS layer `refined`.
3. **Analysis**: QC expression, tìm DEG, map gene sang protein STRING, tính feature mạng PPI, chấm điểm candidate, thêm GEO support và phân cụm ML.
4. **Visualization mart**: tạo snapshot JSON cục bộ trong `data/mart/`.
5. **Dashboard/API**: phục vụ dữ liệu qua FastAPI và frontend HTML/CSS/JavaScript tĩnh.

Số liệu snapshot hiện tại từ `data/mart/overview_summary.json`:

| Metric | Giá trị |
|---|---:|
| GDC samples trước QC | 601 |
| GDC samples sau QC | 590 |
| Differentially expressed genes | 2,598 |
| DEG map được sang protein | 2,579 |
| Protein candidates được chấm điểm | 2,579 |
| Top candidate targets | 100 |
| Candidates có GEO support | 82 |
| ML clusters | 3 |

---

## Kiến trúc / Cấu trúc thư mục

```text
DrugTargetProject/
├── app.py                              # Entrypoint FastAPI ở root: import src.backend.app:app
├── requirements.txt                    # Dependency chạy API, RAG, Mongo sync
├── .env.example                        # Template cấu hình Gemini/RAG/Mongo/mart
├── vercel.json                         # Cấu hình schema tối thiểu cho Vercel
├── .vercelignore                       # Loại trừ notebook/folder lớn khi deploy Vercel
├── README.md                           # Hướng dẫn tổng quan dự án
├── DATA_PIPELINE.md                    # Tài liệu chi tiết pipeline Big Data
├── Cleaning/
│   ├── README.md                       # Quy ước cleaning, schema, data leakage
│   ├── gdc_cleaning.ipynb              # GDC STAR counts + metadata raw -> refined/gdc
│   ├── geo_cleaning.ipynb              # GEO expression + metadata -> refined/geo
│   └── string_cleaning.ipynb           # STRING links/aliases -> refined/STRING graph tables
├── Ingest/
│   ├── README.md                       # Tài liệu template/manifest ingest
│   ├── manifest/
│   │   ├── gdc_manifest.2026-05-13.232526.txt
│   │   └── string_manifest.json
│   └── template/
│       ├── ingest_STRING_raw.json      # NiFi flow export đầy đủ cho STRING
│       ├── ingest_geo_raw.json         # JSON mô tả flow ingest GEO
│       └── ingest_gdc_luad_raw.json    # Placeholder hiện đang rỗng
├── analysis/
│   ├── gdc_phase1_quality_check.ipynb  # Expression pass QC + log2_tpm
│   ├── gdc_phase2_expression_analysis.ipynb
│   ├── gdc_phase3_map_gene_to_protein.ipynb
│   ├── gdc_phase4_ppi_network_analysis.ipynb
│   ├── gdc_phase5_candidate_target_scoring.ipynb
│   └── gdc_phase6_geo_external_validation.ipynb
├── ML/
│   └── gdc_phase7_candidate_clustering.ipynb
├── data/
│   └── mart/                           # JSON mart cục bộ cho API/frontend
├── output/
│   └── figures/                        # Hình GEO report từ Phase 6
├── paper/
│   └── drug_target_project_rag_knowledge_base.md
└── src/
    ├── index.py                        # Entrypoint ASGI thay thế
    ├── distributed/
    │   └── build_visualization_marts.py # PySpark job: HDFS -> data/mart JSON
    ├── backend/
    │   ├── app.py                      # FastAPI routes và API dashboard
    │   ├── repository.py               # Đọc mart từ JSON hoặc MongoDB
    │   ├── settings.py                 # Cấu hình qua environment variables
    │   ├── jobs/
    │   │   ├── index_rag_knowledge.py  # Validate/index Markdown KB vào ChromaDB
    │   │   └── sync_mart_to_mongo.py   # Đồng bộ JSON mart sang MongoDB tùy chọn
    │   └── rag/
    │       ├── knowledge.py            # Parser chunk KB
    │       ├── service.py              # Gemini + ChromaDB RAG service
    │       └── drug_target_project_knowledge_export.json
    └── frontend/
        ├── index.html                  # Shell dashboard tĩnh
        ├── app.js                      # API calls, chart canvas, UI interactions
        ├── styles.css                  # Giao diện dashboard
        └── FRONTEND.md                 # Tài liệu frontend
```

---

## Công nghệ sử dụng

| Nhóm | Công nghệ | Bằng chứng trong repo |
|---|---|---|
| Orchestration ingest | Apache NiFi | `Ingest/template/*.json` |
| Lưu trữ phân tán | HDFS | Các path `hdfs://master11:9000/drugtarget/data` trong notebook và mart builder |
| Xử lý dữ liệu lớn | Apache Spark / PySpark | `SparkSession`, Spark SQL, Spark ML trong notebook |
| Định dạng lưu trữ | Apache Parquet + Snappy | Notebook ghi `.parquet(... option("compression", "snappy"))` |
| Catalog tùy chọn | Hive | Notebook dùng `.enableHiveSupport()` và fallback sang Parquet |
| Machine Learning | Spark ML KMeans, StandardScaler | `ML/gdc_phase7_candidate_clustering.ipynb` |
| Backend API | FastAPI, Uvicorn | `src/backend/app.py`, `requirements.txt` |
| Frontend | HTML/CSS/JavaScript tĩnh, Canvas, Lucide CDN | `src/frontend/` |
| Database tùy chọn | MongoDB | `src/backend/repository.py`, `sync_mart_to_mongo.py` |
| RAG assistant | Gemini, ChromaDB, Google embeddings | `src/backend/rag/`, `.env.example` |

Repo hiện **không có `package.json`**. Frontend được FastAPI serve trực tiếp, không có bước `npm install` hoặc build frontend.

---

## Yêu cầu môi trường & cài đặt

### 1. Môi trường Python cho API

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Linux/macOS:

```bash
source .venv/bin/activate
```

Cài dependency runtime:

```bash
python -m pip install -r requirements.txt
```

### 2. Môi trường Big Data

Notebook và mart builder cần môi trường Spark/HDFS tương thích với path đang được hard-code trong code:

```text
hdfs://master11:9000/drugtarget/data
```

Một số notebook bật Hive support. Nếu Hive table chưa tồn tại, code sẽ fallback sang đọc Parquet trực tiếp trên HDFS.

### 3. Cấu hình RAG tùy chọn

Sao chép template env:

```bash
cp .env.example .env
```

Điền `GEMINI_API_KEY` trong `.env` để bật trợ lý AI. Nếu thiếu key, dashboard vẫn chạy, nhưng `/api/v1/chat` sẽ báo RAG chưa sẵn sàng.

---

## Cách chạy

### Bước 1: Ingest dữ liệu raw vào HDFS

Dùng các artifact trong `Ingest/template/`:

| Nguồn | Artifact | Trạng thái hiện tại |
|---|---|---|
| STRING | `Ingest/template/ingest_STRING_raw.json` | NiFi flow export đầy đủ, có `GenerateFlowFile`, `InvokeHTTP`, `PutHDFS`, file index và nhánh error |
| GEO | `Ingest/template/ingest_geo_raw.json` | JSON mô tả flow parse URL, tải HTTP và ghi HDFS |
| GDC | `Ingest/template/ingest_gdc_luad_raw.json` | Placeholder rỗng; manifest mẫu nằm ở `Ingest/manifest/gdc_manifest.2026-05-13.232526.txt` |

STRING template ghi raw/metadata/error vào các path dạng:

```text
/drugtarget/data/raw/STRING/${hdfs.subdir}/run_date=${now():format("yyyy-MM-dd")}
/drugtarget/data/raw/STRING/metadata/file_index/run_date=${now():format("yyyy-MM-dd")}
/drugtarget/data/raw/STRING/metadata/error/run_date=${now():format("yyyy-MM-dd")}
```

### Bước 2: Cleaning raw data thành refined Parquet

Chạy các notebook cleaning trong môi trường Jupyter có Spark/HDFS:

```text
Cleaning/gdc_cleaning.ipynb
Cleaning/string_cleaning.ipynb
Cleaning/geo_cleaning.ipynb
```

Output chính:

```text
hdfs://master11:9000/drugtarget/data/refined/gdc/gdc_counts_clean
hdfs://master11:9000/drugtarget/data/refined/gdc/gdc_counts_clean_protein_coding
hdfs://master11:9000/drugtarget/data/refined/gdc/quality_check
hdfs://master11:9000/drugtarget/data/refined/STRING/gene_map
hdfs://master11:9000/drugtarget/data/refined/STRING/edges_protein
hdfs://master11:9000/drugtarget/data/refined/STRING/nodes_protein
hdfs://master11:9000/drugtarget/data/refined/geo/expression/version=v1
hdfs://master11:9000/drugtarget/data/refined/geo/metadata/version=v1
```

### Bước 3: Chạy các phase phân tích

Chạy notebook theo thứ tự:

```text
analysis/gdc_phase1_quality_check.ipynb
analysis/gdc_phase2_expression_analysis.ipynb
analysis/gdc_phase3_map_gene_to_protein.ipynb
analysis/gdc_phase4_ppi_network_analysis.ipynb
analysis/gdc_phase5_candidate_target_scoring.ipynb
analysis/gdc_phase6_geo_external_validation.ipynb
ML/gdc_phase7_candidate_clustering.ipynb
```

Chuỗi output HDFS chính:

```text
analysis/gdc_qc_pass_expression
analysis/gdc_deg_result
analysis/deg_mapped_proteins
analysis/protein_network_features
analysis/candidate_target_features
mart/top_candidate_targets
analysis/geo_validation_result
analysis/candidate_clusters
mart/top_candidate_targets_enriched
```

### Bước 4: Tạo local visualization mart

Từ root repo:

```bash
python -m src.distributed.build_visualization_marts --hdfs-base hdfs://master11:9000/drugtarget/data --output-dir data/mart
```

Lệnh này đọc output thật từ HDFS và ghi JSON snapshot vào `data/mart/`. Backend không dùng mock data fallback.

### Bước 5: Khởi chạy dashboard API

```bash
python -m uvicorn src.backend.app:app --host 127.0.0.1 --port 8000 --reload
```

Mở:

```text
http://127.0.0.1:8000/
http://127.0.0.1:8000/pipeline
http://127.0.0.1:8000/api/v1/health
```

### Bước 6: Index RAG tùy chọn

Validate Markdown chunks mà không gọi external API:

```bash
python -m src.backend.jobs.index_rag_knowledge --validate-only
```

Tạo/rebuild ChromaDB index bằng Google embeddings:

```bash
python -m src.backend.jobs.index_rag_knowledge --rebuild
```

Kiểm tra trạng thái:

```text
http://127.0.0.1:8000/api/v1/chat/status
```

### Bước 7: Đồng bộ MongoDB tùy chọn

Nếu bật MongoDB trong `.env`, đồng bộ local JSON mart:

```bash
python -m src.backend.jobs.sync_mart_to_mongo --mart-dir data/mart
```

Cấu hình liên quan:

```text
MONGODB_ENABLED=true
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=drugtarget_luad
```

---

## Bản đồ tài liệu

| File | Nội dung |
|---|---|
| `DATA_PIPELINE.md` | Luồng dữ liệu, HDFS paths, công thức, xử lý null, scoring, KMeans |
| `Ingest/README.md` | Trạng thái NiFi template/manifest và quy ước ingest |
| `Cleaning/README.md` | Quy tắc cleaning, schema, data leakage |
| `src/frontend/FRONTEND.md` | Cấu trúc frontend, API endpoint, deploy |
| `paper/drug_target_project_rag_knowledge_base.md` | Knowledge base được `index_rag_knowledge.py` parse |

---

## Ghi chú kỹ thuật

- Ranking candidate là tín hiệu **ưu tiên hóa**, không phải xác thực sinh học hoặc khuyến nghị lâm sàng.
- GEO support là hỗ trợ expression từ tumor-only cohort, không phải independent Tumor-vs-Normal validation.
- Phase 2 hiện dùng p-value thô theo notebook, chưa có adjusted FDR.
- Code hiện tại không có module Pearson/Spearman gene-gene correlation riêng; top gene được lấy chủ yếu từ DEG effect size và output scoring.
