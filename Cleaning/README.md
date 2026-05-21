# Cleaning Module

## 1. Purpose

Thư mục `Cleaning/` chịu trách nhiệm làm sạch dữ liệu đầu vào của project **Drug Target Identification for LUAD** và chuyển dữ liệu sang định dạng chuẩn để lưu ở tầng `refined` trên HDFS.

Module này nằm giữa `Ingest` và các bước phân tích downstream:

```text
Ingest -> raw HDFS -> Cleaning -> refined HDFS -> Analytics/Dashboard
```

`Cleaning/` không dùng để phân tích kết quả cuối cùng như DEG, survival model, clustering, network ranking hay drug target ranking. Những kết quả đó phải được lưu ở layer `analytics` hoặc `gold`, không lưu trong `refined`.

---

## 2. Folder Scope

Thư mục hiện tại:

```text
Cleaning/
├── geo_cleaning.ipynb
└── README.md
```

Ý nghĩa:

| File | Vai trò |
|---|---|
| `geo_cleaning.ipynb` | Notebook làm sạch dữ liệu GEO, chuẩn hóa metadata/expression và xuất sang Parquet |
| `README.md` | Quy định input, output, schema, ràng buộc và nguyên tắc làm sạch dữ liệu |

Nếu sau này có thêm script/notebook, cần đặt tên theo `snake_case`, ví dụ:

```text
Cleaning/
├── geo_cleaning.ipynb
├── gdc_cleaning.ipynb
├── string_cleaning.ipynb
├── utils/
│   ├── schema_utils.py
│   ├── id_mapping_utils.py
│   └── qc_utils.py
└── README.md
```

---

## 3. Responsibilities

`Cleaning/` có các nhiệm vụ chính sau:

1. Đọc dữ liệu từ HDFS layer `raw`.
2. Chuẩn hóa tên cột về `snake_case`.
3. Chuẩn hóa `sample_id`, `patient_id`, `gene_id`, `gene_symbol`.
4. Chuẩn hóa metadata lâm sàng giữa GEO và GDC.
5. Chuẩn hóa survival endpoint như OS, DSS, OSDSS.
6. Chuẩn hóa expression matrix sang dạng Parquet.
7. Tạo bảng QC cho sample, gene, missing value và batch.
8. Ghi dữ liệu đã làm sạch vào HDFS layer `refined`.

`Cleaning/` không được:

- Tải raw data trực tiếp từ internet nếu logic này thuộc `Ingest/`.
- Ghi đè raw data.
- Ghi kết quả phân tích cuối cùng vào `refined`.
- Dùng biến outcome-derived làm input model.
- Hard-code path cục bộ trong notebook/script.
- Commit file dữ liệu lớn vào Git.

---

## 4. Input Rules

Input của module `Cleaning/` phải đến từ HDFS layer `raw`.

Đường dẫn input chuẩn:

```text
hdfs:///Drug-Target-Project/raw/
```

Ví dụ input GEO:

```text
hdfs:///Drug-Target-Project/raw/geo/GSE67639/version=2026-05-21/
```

Ví dụ input GDC:

```text
hdfs:///Drug-Target-Project/raw/gdc/TCGA-LUAD/version=2026-05-21/
```

Ví dụ input STRING:

```text
hdfs:///Drug-Target-Project/raw/string/version=12.0/
```

Raw data là dữ liệu bất biến. Không chỉnh sửa, rename, filter hoặc overwrite file ở `raw`.

---

## 5. Output Rules

Output của module `Cleaning/` phải ghi vào HDFS layer `refined`.

Đường dẫn output chuẩn:

```text
hdfs:///Drug-Target-Project/refined/
```

Output chính phải dùng định dạng:

```text
.parquet
```

CSV chỉ dùng cho debug nhỏ hoặc export tạm thời. CSV không được dùng làm định dạng chính của pipeline.

---

## 6. Recommended Refined Output Structure

Sau cleaning, dữ liệu nên được ghi theo cấu trúc sau:

```text
refined/
├── metadata/
│   ├── sample_master/
│   ├── clinical_harmonized/
│   ├── survival_labels/
│   └── cohort_batch_info/
│
├── expression/
│   ├── geo/
│   ├── gdc_tcga/
│   └── harmonized/
│       ├── common_genes/
│       ├── geo_gdc_combined/
│       └── batch_corrected/
│
├── gene_reference/
│   ├── gene_id_mapping/
│   └── protein_coding_genes/
│
├── ppi/
│   ├── string_edges/
│   ├── gene_symbol_edges/
│   └── filtered_luad_network/
│
├── phenotype_groups/
│   ├── tumor_vs_normal/
│   ├── stage_groups/
│   ├── survival_groups/
│   └── risk_groups/
│
└── qc/
    ├── sample_qc/
    ├── gene_qc/
    ├── missingness_report/
    └── batch_effect_report/
```

---

## 7. Path Convention

Tất cả output cần có partition hoặc version rõ ràng.

Ví dụ:

```text
hdfs:///Drug-Target-Project/refined/metadata/clinical_harmonized/source=GEO/dataset_id=GSE67639/version=v1/
```

```text
hdfs:///Drug-Target-Project/refined/expression/geo/sample_gene_long/source=GEO/dataset_id=GSE67639/version=v1/
```

```text
hdfs:///Drug-Target-Project/refined/metadata/survival_labels/endpoint=OS/source=GEO/dataset_id=GSE67639/version=v1/
```

Không overwrite version cũ nếu logic cleaning thay đổi. Khi thay đổi logic, tạo version mới:

```text
version=v1
version=v2
version=2026-05-21
```

---

## 8. Naming Convention

### 8.1 Folder and File Names

Dùng `snake_case`.

Đúng:

```text
clinical_harmonized
survival_labels
gene_id_mapping
sample_gene_long
```

Không dùng:

```text
ClinicalData
clinical-data
clinical data
```

### 8.2 Column Names

Tất cả cột trong `refined` phải dùng `snake_case`.

Ví dụ đổi tên cột GEO:

| Raw column | Refined column |
|---|---|
| `Age` | `age` |
| `Gender` | `gender` |
| `Original Study` | `original_study` |
| `MergeGroup` | `merge_group` |
| `Cohort` | `cohort` |
| `DSS_Status` | `dss_status` |
| `DSS_Time` | `dss_time` |
| `OS_Status` | `os_status` |
| `OS_Time` | `os_time` |
| `Stage_consensus_MD` | `stage_consensus_md` |
| `Differentiation_MD` | `differentiation_md` |
| `Histology_MD` | `histology_md` |
| `EXCLUDEFLAG` | `exclude_flag` |
| `GenderCode` | `gender_code` |
| `StageNumeric` | `stage_numeric` |
| `DifferentiationNumeric` | `differentiation_numeric` |
| `AgeGT70` | `age_gt_70` |
| `DEATH_before_5yrs` | `death_before_5yrs` |
| `DEATH_after_5yrs` | `death_after_5yrs` |

---

## 9. Required Core Columns

### 9.1 `sample_master`

Bảng `sample_master` nên có tối thiểu:

```text
sample_id
patient_id
source
dataset_id
cohort
original_study
disease
cancer_type
sample_type
platform
has_expression
has_clinical
has_survival
exclude_flag
```

Ý nghĩa:

| Column | Meaning |
|---|---|
| `sample_id` | ID duy nhất của sample trong toàn project |
| `patient_id` | ID bệnh nhân nếu có |
| `source` | Nguồn dữ liệu, ví dụ `GEO`, `GDC`, `STRING` |
| `dataset_id` | Dataset cụ thể, ví dụ `GSE67639`, `TCGA-LUAD` |
| `cohort` | Cohort hoặc nhóm nghiên cứu |
| `disease` | Bệnh nghiên cứu, ví dụ `LUAD` |
| `sample_type` | Tumor, Normal, Primary Tumor, Solid Tissue Normal, v.v. |
| `exclude_flag` | Cờ loại mẫu khỏi phân tích chính |

---

### 9.2 `clinical_harmonized`

Bảng `clinical_harmonized` nên có tối thiểu:

```text
sample_id
patient_id
source
dataset_id
age
age_gt_70
gender
gender_code
female
histology_original
histology_harmonized
stage_original
stage_harmonized
stage_numeric
stage_group
grade_original
grade_harmonized
grade_numeric
cohort
merge_group
original_study
exclude_flag
```

Các biến clinical này được phép dùng làm covariate trong phân tích, với điều kiện không dùng các biến survival/outcome làm input.

---

### 9.3 `survival_labels`

Survival nên tách thành bảng riêng để tránh data leakage.

Schema chung:

```text
sample_id
patient_id
source
dataset_id
endpoint
time
time_unit
time_days
event
status
```

Trong đó:

| Column | Meaning |
|---|---|
| `endpoint` | Loại endpoint: `OS`, `DSS`, `OSDSS`, `OSDSS_60M` |
| `time` | Thời gian sống còn gốc |
| `time_unit` | Đơn vị gốc, ví dụ `months`, `days` |
| `time_days` | Thời gian đã chuẩn hóa sang ngày |
| `event` | `1` nếu có biến cố, `0` nếu censored |
| `status` | Trạng thái gốc sau khi chuẩn hóa |

Nếu GEO dùng đơn vị tháng, quy đổi:

```text
time_days = time_months * 30.4375
```

---

### 9.4 `expression` Long Format

Expression sau cleaning nên ưu tiên lưu dạng long format để thuận lợi cho Spark:

```text
sample_id
patient_id
source
dataset_id
gene_id
gene_symbol
expression_value
expression_unit
platform
```

Ví dụ:

```text
sample_id | gene_id | gene_symbol | expression_value | source | dataset_id
```

Nếu cần matrix format cho ML, có thể tạo thêm bảng riêng, nhưng không thay thế long format.

---

### 9.5 `gene_id_mapping`

Gene mapping nên có:

```text
gene_symbol
ensembl_gene_id
entrez_gene_id
uniprot_id
string_protein_id
synonyms
```

Không nên dùng `gene_symbol` làm khóa duy nhất nếu có thể dùng `ensembl_gene_id` hoặc mapping table.

---

## 10. GEO Metadata Feature Rules

Các feature GEO nên được giữ lại tối đa trong metadata, nhưng chia mục đích sử dụng rõ ràng.

### 10.1 Clinical Covariates

Các biến sau có thể dùng làm clinical covariates hoặc để đối chứng với GDC:

```text
age
gender
female
gender_code
stage_consensus_md
stage_numeric
stage_i_md
stage_i_adeno
stage_ib
stage_iia
stage_iib
stage_iiia
stage_iiib
stage_iv
differentiation_md
differentiation_numeric
grade_moderate
grade_poor
histology_md
histology_progno
cohort
merge_group
original_study
age_gt_70
```

### 10.2 Survival Labels

Các biến sau chỉ được dùng làm label/outcome, không dùng làm input model:

```text
os_status
os_time
dss_status
dss_time
osdss_status
osdss_time
osdss60_status
osdss60_time
death_before_5yrs
death_after_5yrs
```

### 10.3 Benchmark or Risk Score Variables

Các biến sau được giữ lại để benchmark hoặc đối chứng phụ, nhưng không dùng làm input chính khi tìm drug target:

```text
scmodc20_sim
seer_agects
seer_agegt70
compos_agect
compos_agects
```

Lý do:

- Có thể là score đã được dựng từ mô hình trước đó.
- Có thể liên quan trực tiếp hoặc gián tiếp đến survival outcome.
- Có nguy cơ gây data leakage nếu dùng làm input model.

---

## 11. Data Leakage Rules

Tuyệt đối không dùng outcome hoặc biến suy ra từ outcome làm input model.

Không dùng làm input:

```text
os_status
os_time
dss_status
dss_time
osdss_status
osdss_time
osdss60_status
osdss60_time
death_before_5yrs
death_after_5yrs
compos_agect
compos_agects
scmodc20_sim
```

Các biến này chỉ được dùng cho:

- Label
- Stratification
- Benchmark
- Evaluation
- Risk group annotation

Nếu cần tạo nhóm survival, output phải lưu vào:

```text
refined/phenotype_groups/survival_groups/
```

Không được trộn survival label vào bảng input feature chính.

---

## 12. GEO - GDC Harmonization Rules

Khi làm sạch metadata để đối chứng GEO với GDC, cần chuẩn hóa các trường sau:

| GEO field | Refined field | GDC equivalent |
|---|---|---|
| `Age` | `age` | `age_at_index` / `age_at_diagnosis` |
| `Gender` | `gender` | `gender` |
| `Histology_MD` | `histology_harmonized` | `primary_diagnosis` / `morphology` |
| `Stage_consensus_MD` | `stage_harmonized` | `ajcc_pathologic_stage` |
| `Differentiation_MD` | `grade_harmonized` | `tumor_grade` |
| `OS_Status` | `os_event` | `vital_status` |
| `OS_Time` | `os_time_days` | `days_to_death` / `days_to_last_follow_up` |

Không union hoặc join GEO với GDC nếu chưa chuẩn hóa:

- `sample_id`
- `patient_id`
- `gene_id`
- `gene_symbol`
- `stage_harmonized`
- `grade_harmonized`
- `time_days`
- `expression_unit`

---

## 13. Cleaning Rules for Clinical Metadata

### 13.1 Missing Values

Missing value phải được chuẩn hóa về dạng thống nhất.

Các giá trị sau nên được coi là missing:

```text
NA
N/A
na
null
NULL
None
Unknown
unknown
Not Available
not available
--

```

Trong Parquet, missing nên được lưu là `null`, không lưu chuỗi biểu diễn missing như `"NA"`, `"null"` hoặc `"Unknown"`.

### 13.2 Gender

Chuẩn hóa:

```text
Male -> male
Female -> female
M -> male
F -> female
```

Có thể tạo thêm:

```text
gender_code: male=1, female=0
female: female=1, otherwise=0
```

### 13.3 Stage

Chuẩn hóa stage về dạng thống nhất:

```text
IA
IB
IIA
IIB
IIIA
IIIB
IV
```

Có thể tạo thêm:

```text
stage_numeric
stage_group
early_vs_late
```

Gợi ý mapping:

```text
IA -> 0
IB -> 1
IIA -> 2
IIB -> 3
IIIA -> 4
IIIB -> 5
IV -> 6
```

### 13.4 Grade / Differentiation

Chuẩn hóa differentiation:

```text
Well -> well
Mod / Moderate -> moderate
Poor -> poor
```

Có thể tạo thêm:

```text
grade_numeric: well=0, moderate=1, poor=2
grade_moderate
grade_poor
```

---

## 14. Cleaning Rules for Expression Data

Expression data cần được chuẩn hóa ở mức gene-level.

Yêu cầu:

- Mỗi dòng trong long format là một cặp `sample_id - gene_id` hoặc `sample_id - gene_symbol`.
- Không để trùng cặp `sample_id + gene_id` trong cùng một dataset/version.
- Nếu một gene có nhiều probe, phải có rule aggregate rõ ràng.
- Không mix nhiều expression unit trong cùng một bảng nếu chưa có cột `expression_unit`.

Nếu dữ liệu GEO là microarray probe-level, cần xử lý:

```text
probe_id -> gene_symbol / gene_id -> aggregate to gene-level
```

Rule aggregate cần ghi rõ trong notebook hoặc config, ví dụ:

```text
mean expression across probes
max variance probe
median expression across probes
```

Không được âm thầm loại probe/gene mà không ghi vào QC.

---

## 15. QC Output Requirements

Mỗi notebook/script cleaning phải tạo QC output.

QC output nên lưu ở:

```text
hdfs:///Drug-Target-Project/refined/qc/
```

Các QC bắt buộc:

### 15.1 `sample_qc`

```text
sample_id
source
dataset_id
n_genes_detected
missing_clinical_rate
has_expression
has_clinical
has_survival
exclude_flag
qc_pass
qc_reason
```

### 15.2 `gene_qc`

```text
gene_id
gene_symbol
missing_rate
zero_rate
mean_expression
variance_expression
qc_pass
qc_reason
```

### 15.3 `missingness_report`

```text
source
dataset_id
table_name
column_name
missing_count
total_count
missing_rate
```

### 15.4 `batch_effect_report`

```text
sample_id
source
dataset_id
cohort
merge_group
pc1
pc2
batch_label
```

---

## 16. Logging Requirements

Mỗi lần chạy cleaning nên ghi log.

Log nên có:

```text
job_name
run_id
run_time
input_path
output_path
source
dataset_id
version
number_of_rows_input
number_of_rows_output
number_of_columns
number_of_samples
number_of_genes
status
error_message
```

Log có thể lưu tại:

```text
hdfs:///Drug-Target-Project/logs/cleaning/
```

hoặc local trong quá trình development:

```text
logs/cleaning/
```

Không commit log lớn vào Git.

---

## 17. Notebook Rules

Notebook trong `Cleaning/` phải tuân thủ:

1. Chạy được từ đầu đến cuối.
2. Có markdown mô tả purpose, input, output.
3. Không hard-code absolute local path.
4. Không chứa token, credential hoặc secret.
5. Không commit cell output quá lớn.
6. Có bước validate schema trước khi ghi Parquet.
7. Có bước kiểm tra số dòng/số sample trước và sau cleaning.
8. Có ghi rõ version output.

Mỗi notebook nên có header:

```text
Purpose:
Input:
Output:
Owner:
Last updated:
Version:
```

Ví dụ:

```text
Purpose: Clean GEO GSE67639 metadata and expression matrix
Input: hdfs:///Drug-Target-Project/raw/geo/GSE67639/version=2026-05-21/
Output: hdfs:///Drug-Target-Project/refined/expression/geo/source=GEO/dataset_id=GSE67639/version=v1/
Owner: team_member_name
Last updated: 2026-05-21
Version: v1
```

---

## 18. Validation Checklist Before Writing Output

Trước khi ghi dữ liệu vào `refined`, phải kiểm tra:

- [ ] Tên cột đã là `snake_case`.
- [ ] Có `sample_id`.
- [ ] Có `source`.
- [ ] Có `dataset_id`.
- [ ] Không có duplicate key ngoài ý muốn.
- [ ] Missing values đã chuẩn hóa về `null`.
- [ ] Survival time đã có `time_days` nếu dùng survival.
- [ ] Expression đã có `expression_unit`.
- [ ] Gene ID đã được mapping nếu có thể.
- [ ] Output format là `.parquet`.
- [ ] Có QC report.
- [ ] Có log job.
- [ ] Không dùng outcome-derived variables làm input.

---

## 19. Definition of Done

Một task cleaning được xem là hoàn thành khi có đủ:

- Dữ liệu output ở `.parquet`.
- Schema rõ ràng.
- Không còn tên cột có dấu cách.
- Có `sample_id`, `source`, `dataset_id`.
- Có version output.
- Có QC report.
- Có log job.
- Có mô tả input/output trong notebook hoặc README.
- Không vi phạm data leakage rules.

---

## 20. Important Principle

Raw data phải được bảo toàn.

Refined data phải sạch, chuẩn hóa, có schema, có version và có thể join giữa GEO, GDC và STRING.

Survival/outcome variables không được dùng làm input model khi mục tiêu là tìm drug target.

Các biến score như `scmodc20_sim`, `seer_agects`, `seer_agegt70`, `compos_agect`, `compos_agects` chỉ dùng để benchmark hoặc đối chứng phụ, không dùng làm input chính.
