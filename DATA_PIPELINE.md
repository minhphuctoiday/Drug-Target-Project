# Pipeline dữ liệu

Tài liệu này mô tả luồng dữ liệu Big Data thật đang được triển khai trong notebook và source code của repo.

---

## Luồng tổng thể

```text
GDC / STRING / GEO
        |
        v
NiFi ingest templates
        |
        v
HDFS raw
        |
        v
PySpark cleaning notebooks
        |
        v
HDFS refined Parquet
        |
        v
Analysis Phase 1-7 notebooks
        |
        v
HDFS analysis + mart Parquet
        |
        v
src/distributed/build_visualization_marts.py
        |
        v
data/mart/*.json
        |
        v
FastAPI + static dashboard
```

HDFS base path trong notebook:

```text
hdfs://master11:9000/drugtarget/data
```

---

## Các tầng dữ liệu

| Layer | Path pattern | Ghi bởi | Vai trò |
|---|---|---|---|
| Raw | `/drugtarget/data/raw/...` | NiFi ingest flow | Dữ liệu nguồn gần nguyên bản, phục vụ audit/replay |
| Refined | `/drugtarget/data/refined/...` | `Cleaning/*.ipynb` | Dữ liệu đã parse, chuẩn hóa, lưu Parquet/Snappy |
| Analysis | `/drugtarget/data/analysis/...` | `analysis/*.ipynb`, `ML/*.ipynb` | Kết quả trung gian của các phase phân tích |
| Mart | `/drugtarget/data/mart/...` | Phase 5 và Phase 7 | Bảng kết quả cuối/ranking |
| Local JSON mart | `data/mart/*.json` | `src.distributed.build_visualization_marts` | Snapshot cho dashboard/API |

---

## Ingest Layer

### STRING

NiFi flow export đầy đủ:

```text
Ingest/template/ingest_STRING_raw.json
```

Flow tạo manifest cho STRING v12 Homo sapiens (`tax_id=9606`) và tải:

| Dataset | Nhóm URL | HDFS subdir |
|---|---|---|
| `links` | `protein.links.v12.0` | `links` |
| `aliases` | `protein.aliases.v12.0` | `aliases` |
| `details` | `protein.info.v12.0` | `details` |

Flow dùng `InvokeHTTP` để tải file, `PutHDFS` để ghi raw file, và ghi riêng file index/error:

```text
/drugtarget/data/raw/STRING/${hdfs.subdir}/run_date=YYYY-MM-DD
/drugtarget/data/raw/STRING/metadata/file_index/run_date=YYYY-MM-DD
/drugtarget/data/raw/STRING/metadata/error/run_date=YYYY-MM-DD
```

### GEO và GDC

`Ingest/template/ingest_geo_raw.json` là JSON mô tả flow parse URL, tải HTTP và ghi HDFS. `Ingest/template/ingest_gdc_luad_raw.json` hiện là file rỗng; repo chỉ có manifest/API response mẫu tại:

```text
Ingest/manifest/gdc_manifest.2026-05-13.232526.txt
```

---

## Cleaning Layer

### GDC Cleaning

Notebook:

```text
Cleaning/gdc_cleaning.ipynb
```

Input:

```text
hdfs://master11:9000/drugtarget/data/raw/gdc/counts/file_id=*/*.tsv
hdfs://master11:9000/drugtarget/data/raw/gdc/metadata/files_index/run_date=*/files_index_from_*.json
hdfs://master11:9000/drugtarget/data/raw/gdc/metadata/cases_samples/run_date=*/cases_samples.tsv
```

Output:

```text
hdfs://master11:9000/drugtarget/data/refined/gdc/gdc_file_sample_map
hdfs://master11:9000/drugtarget/data/refined/gdc/gdc_counts_clean
hdfs://master11:9000/drugtarget/data/refined/gdc/gdc_counts_clean_protein_coding
hdfs://master11:9000/drugtarget/data/refined/gdc/quality_check
```

Quy tắc chính trong code:

| Quy tắc | Cách triển khai |
|---|---|
| Chỉ giữ dòng gene thật | `gene_id` phải match `^ENSG` |
| Raw count | `raw_count = unstranded` |
| Bảng downstream protein-coding | Giữ `gene_type == "protein_coding"` và loại PAR_Y |
| QC sample | Tính `total_raw_count`, `num_detected_genes_raw_gt_0`, zero-gene rate |
| Outlier sample | IQR bounds trên library size và detected genes |
| Output | Parquet với Snappy compression |

Xử lý null/chất lượng:

- Loại dòng thiếu `file_id` hoặc `sample_id` không hợp lệ.
- QC sum dùng `coalesce(raw_count, 0)`.
- Có assert cho duplicate file mapping và dòng protein-coding không hợp lệ trước khi ghi.

### STRING Cleaning

Notebook:

```text
Cleaning/string_cleaning.ipynb
```

Input:

```text
hdfs://master11:9000/drugtarget/data/raw/STRING/links/run_date=*/*
hdfs://master11:9000/drugtarget/data/raw/STRING/allias/run_date=*/*
hdfs://master11:9000/drugtarget/data/raw/STRING/aliases/run_date=*/*
```

Output:

```text
hdfs://master11:9000/drugtarget/data/refined/STRING/gene_map
hdfs://master11:9000/drugtarget/data/refined/STRING/edges_protein
hdfs://master11:9000/drugtarget/data/refined/STRING/edges_gene
hdfs://master11:9000/drugtarget/data/refined/STRING/nodes_gene
hdfs://master11:9000/drugtarget/data/refined/STRING/nodes_protein
```

| Bảng | Vai trò |
|---|---|
| `gene_map` | Map STRING `protein_id` sang `ensp_id`, `gene_id`, `gene_name`, `gene_confidence` |
| `edges_protein` | Cạnh protein-protein với `combined_score_protein` và `edge_weight_protein` |
| `edges_gene` | Cạnh đã roll up ở mức gene |
| `nodes_gene` | Gene node với degree và weighted degree |
| `nodes_protein` | Protein node với degree và weighted degree |

Chuẩn hóa score:

```text
edge_weight_protein = combined_score_protein / 1000.0
```

Xử lý null/chất lượng:

- Loại dòng blank/comment/header.
- Loại dòng thiếu protein ID, alias value, source hoặc score.
- Degree của node không có incident edge được fill `0`.
- Assert duplicate protein ID, self-loop, score range và degree/weighted degree không âm.

### GEO Cleaning

Notebook:

```text
Cleaning/geo_cleaning.ipynb
```

Input:

```text
hdfs://master11:9000/drugtarget/data/raw/geo/expression/geo_ex.txt
hdfs://master11:9000/drugtarget/data/raw/geo/metadata/<metadata file resolved by notebook>
```

Output:

```text
hdfs://master11:9000/drugtarget/data/refined/geo/expression/version=v1
hdfs://master11:9000/drugtarget/data/refined/geo/metadata/version=v1
hdfs://master11:9000/drugtarget/data/refined/geo/qc/version=v1
```

Quy tắc chính:

- Expression được parse từ dòng header bắt đầu bằng `ID_REF\tDescription\t`.
- Metadata được parse giữa `!series_table_begin = Clinical_annotations_curated` và `!series_table_end`.
- Notebook hiện drop hai cột metadata `Original Study` và `Cohort`.
- QC ghi số dòng, số cột, Spark mode và các cột đã drop.

---

## Các phase phân tích

### Phase 1: GDC Quality Check

Notebook:

```text
analysis/gdc_phase1_quality_check.ipynb
```

Input:

```text
refined/gdc/quality_check
refined/gdc/gdc_counts_clean_protein_coding
```

Output:

```text
analysis/gdc_qc_pass_expression
```

Logic:

```text
sample pass QC khi:
is_outlier_library_size == false
AND
is_outlier_detected_genes == false
```

Biến đổi expression:

```text
log2_tpm = log2(TPM + 1)
```

### Phase 2: Differential Expression

Notebook:

```text
analysis/gdc_phase2_expression_analysis.ipynb
```

Input:

```text
analysis/gdc_qc_pass_expression
```

Output:

```text
analysis/gdc_deg_result
```

Với mỗi gene:

```text
log2FC = mean_log2_tpm_tumor - mean_log2_tpm_normal
```

Quy tắc DEG:

```text
is_deg = abs(log2FC) >= 1.0 AND p_value < 0.05
```

`p_value` được tính từ Welch-style t-statistic bằng normal approximation trong notebook.

### Phase 3: Gene-To-Protein Mapping

Notebook:

```text
analysis/gdc_phase3_map_gene_to_protein.ipynb
```

Input:

```text
analysis/gdc_deg_result
refined/STRING/gene_map
```

Output:

```text
analysis/deg_mapped_proteins
```

Logic:

- Chỉ giữ `is_deg == true`.
- Chuẩn hóa gene name GDC bằng `upper(trim(gene_name))`.
- Chuẩn hóa key STRING từ `gene_name_norm` hoặc `gene_name`.
- Inner join DEG genes với STRING `gene_map`.

### Phase 4: PPI Network Features

Notebook:

```text
analysis/gdc_phase4_ppi_network_analysis.ipynb
```

Input:

```text
analysis/deg_mapped_proteins
refined/STRING/edges_protein
refined/STRING/nodes_protein
```

Output:

```text
analysis/protein_network_features
```

Ngưỡng:

```text
EDGE_WEIGHT_THRESHOLD = 0.4
HIGH_CONFIDENCE_THRESHOLD = 0.7
```

Feature được tính:

| Feature | Ý nghĩa |
|---|---|
| `degree_protein` | Degree từ STRING protein node table |
| `weighted_degree_protein` | Weighted degree từ STRING protein node table |
| `num_interactions_in_deg_network` | Số tương tác candidate-neighbor sau lọc edge |
| `avg_combined_score` | Trung bình STRING combined score của tương tác đã lọc |
| `max_combined_score` | STRING combined score lớn nhất của tương tác đã lọc |
| `num_high_confidence_edges` | Số neighbor có `edge_weight_protein >= 0.7` |

Network feature thiếu được fill bằng `0`.

### Phase 5: Candidate Target Scoring

Notebook:

```text
analysis/gdc_phase5_candidate_target_scoring.ipynb
```

Input:

```text
analysis/deg_mapped_proteins
analysis/protein_network_features
```

Output:

```text
analysis/candidate_target_features
mart/top_candidate_targets
```

Nếu một protein có nhiều evidence gene, notebook giữ dòng có `abs_log2FC` lớn nhất, sau đó `p_value` thấp nhất, rồi `gene_name` theo alphabet.

Các score thành phần được min-max normalize về `[0, 1]`:

| Score | Feature nguồn |
|---|---|
| `expression_score` | `abs_log2FC` |
| `protein_network_score` | `weighted_degree_protein` |
| `string_confidence_score` | `avg_combined_score` |

Final score:

```text
final_score =
  0.5 * expression_score
+ 0.3 * protein_network_score
+ 0.2 * string_confidence_score
```

Thứ tự ranking:

```text
final_score desc,
abs_log2FC desc,
weighted_degree_protein desc,
gene_name asc
```

Top output giới hạn:

```text
TOP_N = 100
```

### Phase 6: GEO Tumor-Cohort Support

Notebook:

```text
analysis/gdc_phase6_geo_external_validation.ipynb
```

Input:

```text
mart/top_candidate_targets
refined/geo/expression/version=v1
refined/geo/metadata/version=v1
```

Output:

```text
analysis/geo_validation_result
analysis/geo_validation_summary
analysis/geo_supported_top_candidates
output/figures/geo_support_summary.png
output/figures/geo_top_supported_candidates.png
output/figures/gdc_vs_geo_support_scatter.png
```

Cấu hình quan trọng:

```text
GEO_VALIDATION_MODE = "tumor_cohort_expression_support"
GEO_ALREADY_LOG_TRANSFORMED = True
```

GEO được dùng như tumor-cohort expression support, không phải independent Tumor-vs-Normal validation.

Support metrics:

| Metric | Công thức / ý nghĩa |
|---|---|
| `geo_coverage_rate` | `geo_num_samples_available / geo_total_samples` |
| `geo_mean_percentile` | Trung bình percentile expression trong từng sample, xét trên tập candidate genes |
| `geo_top_quartile_rate` | Tỷ lệ GEO sample có candidate percentile `>= 0.75` |

GEO support score:

```text
geo_support_score =
  0.2 * geo_coverage_rate
+ 0.5 * geo_mean_percentile
+ 0.3 * geo_top_quartile_rate
```

Nhãn support:

| Rule | Label |
|---|---|
| Không match GEO gene | `Not Found` |
| `geo_support_score >= 0.75` | `Strong GEO support` |
| `geo_support_score >= 0.50` | `Moderate GEO support` |
| Còn lại | `Limited GEO support` |

Summary mart hiện tại:

| GEO Support Level | Count |
|---|---:|
| Moderate GEO support | 47 |
| Limited GEO support | 35 |
| Not Found | 18 |

### Phase 7: KMeans Candidate Clustering

Notebook:

```text
ML/gdc_phase7_candidate_clustering.ipynb
```

Input:

```text
analysis/candidate_target_features
analysis/geo_validation_result
mart/top_candidate_targets
```

Output:

```text
analysis/ml_candidate_features
analysis/ml_k_selection
analysis/candidate_clusters
analysis/ml_cluster_summary
mart/top_candidate_targets_enriched
```

Cấu hình KMeans:

```text
K_MIN = 2
K_MAX = 6
SEED = 42
EXPECTED_CANDIDATE_COUNT = 2579
EXPECTED_TOP_COUNT = 100
```

ML feature columns:

```text
abs_log2FC
log_weighted_degree = log1p(weighted_degree_protein)
avg_combined_score
log_num_interactions = log1p(num_interactions_in_deg_network)
```

Pipeline ML:

```text
VectorAssembler -> StandardScaler(withMean=True, withStd=True) -> KMeans
```

`ml_k_selection.json` hiện tại:

| k | Silhouette Score |
|---:|---:|
| 2 | 0.495447590208862 |
| 3 | 0.5048944122268278 |
| 4 | 0.396131544800113 |
| 5 | 0.3986930383078672 |
| 6 | 0.34725488497701457 |

Best `k` của snapshot hiện tại là `3`.

---

## Visualization Mart Builder

Script:

```text
src/distributed/build_visualization_marts.py
```

Lệnh chạy:

```bash
python -m src.distributed.build_visualization_marts --hdfs-base hdfs://master11:9000/drugtarget/data --output-dir data/mart
```

Script đọc output thật từ HDFS `refined`, `analysis`, `mart` và ghi JSON cho FastAPI.

Một số mart chính:

| JSON mart | Vai trò |
|---|---|
| `overview_summary.json` | KPI tổng quan và pipeline summary |
| `qc_sample_counts.json` | Sample counts trước/sau QC |
| `volcano_points.json` | Điểm cho volcano plot DEG |
| `top_deg_genes.json` | Top DEG theo absolute log2FC |
| `gene_protein_mapping_summary.json` | Trạng thái map DEG sang protein |
| `ppi_visualization_nodes.json` | Node PPI của top target |
| `ppi_visualization_edges.json` | Edge PPI giữa top target |
| `top_candidate_targets_enriched.json` | Top 100 cuối cùng kèm GEO + cluster |
| `ml_cluster_points.json` | Điểm scatter clustering cấp candidate |

Xử lý null trong builder:

```text
None -> null
NaN / Infinity -> null
```

Nếu thiếu mart, backend trả payload unavailable rõ ràng và không tự thay bằng mock data.

---

## Trạng thái gene correlation

Context dự án có nhắc phân tích tương quan gene, nhưng code hiện tại **không có module Pearson/Spearman gene-gene correlation** hoặc output correlation matrix riêng. Phân tích đang triển khai gồm:

- Differential expression (`log2FC`, `p_value`, `is_deg`)
- DEG-to-protein mapping
- STRING PPI network features
- Candidate scoring
- GEO tumor-cohort support
- KMeans candidate clustering

Top genes trong dashboard hiện được lấy từ DEG output và `abs_log2FC`, không phải từ thuật toán gene correlation.

---

## Snapshot top candidate hiện tại

Từ `data/mart/top_candidate_targets_enriched.json`:

| Rank | Gene | Protein ID | GEO Support | Cluster |
|---:|---|---|---|---:|
| 1 | SFTPC | `9606.ENSP00000316152` | Moderate GEO support | 0 |
| 2 | AGER | `9606.ENSP00000364210` | Limited GEO support | 0 |
| 3 | CLDN18 | `9606.ENSP00000340939` | Limited GEO support | 0 |
| 4 | FABP4 | `9606.ENSP00000256104` | Limited GEO support | 0 |
| 5 | GAPDH | `9606.ENSP00000380070` | Moderate GEO support | 2 |

Các giá trị trên phản ánh local JSON mart snapshot đang có trong repo.
