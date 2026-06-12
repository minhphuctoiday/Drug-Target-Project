---
title: "DrugTargetProject - RAG Knowledge Base"
project: "Drug-Target-Project"
domain: "LUAD protein target prioritization"
language: "vi"
version: "2026-06-12"
intended_use: "Chunking and indexing into ChromaDB for a Gemini 2.5 Flash RAG chatbot"
---

# DrugTargetProject - RAG Knowledge Base

Tài liệu này là nguồn tri thức tổng hợp cho chatbot RAG của project DrugTargetProject. Nội dung mô tả mục tiêu nghiên cứu, kiến trúc dữ liệu, logic xử lý, công thức, đầu ra, dashboard, giới hạn và các khái niệm thường bị nhầm lẫn.

Mỗi mục `KB-xxx` được viết để có thể tách thành một chunk tương đối độc lập. Khi chunking, nên giữ nguyên tiêu đề, metadata và toàn bộ nội dung của từng mục.

Không đưa thông tin đăng nhập, mật khẩu, access token hoặc secret hệ thống vào ChromaDB.

---

## KB-001: Tổng quan project

**chunk_id:** `project_overview`
**keywords:** `DrugTargetProject, LUAD, drug target, protein target, overview`
**source_of_truth:** `README.md`, `paper/section_3_problem_definition.md`

DrugTargetProject xây dựng pipeline ưu tiên hóa protein mục tiêu tiềm năng cho ung thư biểu mô tuyến phổi, hay Lung Adenocarcinoma (LUAD).

Mục tiêu của project không phải khẳng định một protein là đích điều trị đã được xác thực. Đầu ra là danh sách protein candidate có thứ tự ưu tiên để hỗ trợ các bước xác thực sinh học, dược lý và thực nghiệm tiếp theo.

Pipeline kết hợp ba nhóm bằng chứng:

1. GDC/TCGA-LUAD cung cấp dữ liệu expression để phát hiện gene biểu hiện khác biệt giữa Tumor và Normal.
2. STRING cung cấp ánh xạ gene-protein và mạng tương tác protein-protein.
3. GEO GSE67639 cung cấp bằng chứng expression bổ sung từ một cohort tumor-only bên ngoài.

Đầu ra chính là Top 100 protein candidate, kèm bằng chứng expression, đặc trưng mạng, điểm ưu tiên, GEO support và nhãn K-Means cluster.

---

## KB-002: Câu hỏi nghiên cứu

**chunk_id:** `research_question`
**keywords:** `research question, problem definition, prioritization`

Câu hỏi trung tâm của project là:

> Từ dữ liệu expression của LUAD và mạng tương tác protein, protein nào nên được ưu tiên để nghiên cứu tiếp như một drug target tiềm năng?

Pipeline trả lời câu hỏi này theo thứ tự:

1. Gene nào khác biệt rõ giữa Tumor và Normal?
2. Gene đó có ánh xạ được sang protein STRING không?
3. Protein có vai trò và kết nối như thế nào trong mạng PPI?
4. Khi kết hợp expression, network và confidence, candidate nào có điểm cao nhất?
5. Candidate có expression support trong cohort GEO bên ngoài không?
6. Candidate thuộc kiểu đặc trưng nào theo K-Means?

---

## KB-003: Kiến trúc tổng thể

**chunk_id:** `architecture_overview`
**keywords:** `architecture, NiFi, HDFS, Spark, Hive, mart, FastAPI, dashboard`

Kiến trúc tổng thể:

```text
GDC + STRING + GEO
        |
        v
      NiFi
        |
        v
    HDFS raw
        |
        v
 PySpark Cleaning
        |
        v
  HDFS refined
        |
        v
 Analysis Phase 1-7
        |
        v
 HDFS analysis + mart
        |
        v
 Visualization Mart Builder
        |
        v
 data/mart/*.json
        |
        v
 FastAPI + Dashboard
```

NiFi phụ trách ingest. HDFS lưu dữ liệu lớn. PySpark thực hiện cleaning và analysis. Hive có thể làm catalog cho bảng Parquet. Mart builder tạo JSON snapshot. FastAPI và frontend phục vụ dashboard.

---

## KB-004: Các tầng dữ liệu

**chunk_id:** `data_layers`
**keywords:** `raw, refined, analysis, mart, data layer, HDFS`

Project tổ chức dữ liệu thành bốn tầng:

| Tầng | Mục đích |
|---|---|
| `raw` | Lưu dữ liệu nguồn gần như nguyên bản, phục vụ audit và replay |
| `refined` | Lưu dữ liệu đã parse, làm sạch, chuẩn hóa schema và identifier |
| `analysis` | Lưu kết quả trung gian của các phase phân tích |
| `mart` | Lưu kết quả cuối hoặc dữ liệu tối ưu cho truy vấn/dashboard |

Nguyên tắc:

- Ingest chỉ ghi vào `raw`.
- Cleaning đọc `raw` và ghi `refined`.
- Các phase phân tích đọc `refined` hoặc `analysis`, rồi ghi `analysis` hoặc `mart`.
- Dashboard không đọc trực tiếp raw data.

HDFS base path được dùng trong code:

```text
hdfs://master11:9000/drugtarget/data
```

---

## KB-005: Nguồn dữ liệu GDC/TCGA-LUAD

**chunk_id:** `source_gdc`
**keywords:** `GDC, TCGA-LUAD, RNA-seq, STAR counts, tumor, normal`

GDC/TCGA-LUAD là nguồn discovery chính cho Differential Expression.

Dữ liệu GDC gồm:

- STAR RNA-seq count files.
- Metadata file, case và sample.
- Sample type và tissue type để chuẩn hóa thành nhóm `tumor`, `normal`, hoặc `other`.
- Các cột expression như raw count và TPM.

GDC được dùng để:

- Kiểm tra chất lượng sample.
- Chuyển TPM thành `log2(TPM + 1)`.
- So sánh expression Tumor và Normal.
- Tính `log2FC`, t-statistic và p-value cho từng gene.
- Xác định Differentially Expressed Genes (DEG).

Theo mart snapshot hiện tại:

- 601 sample trước QC.
- 542 Tumor và 59 Normal trước QC.
- 590 sample sau QC.
- 531 Tumor và 59 Normal sau QC.
- 19.944 gene protein-coding được phân tích.

Lưu ý: output cũ lưu trong một số notebook và tài liệu ghi 520 Tumor + 59 Normal sau QC. Khi chatbot trả lời số liệu hiện tại, nên ưu tiên mart snapshot và nói rõ có chênh lệch phiên bản nếu cần.

---

## KB-006: Nguồn dữ liệu STRING

**chunk_id:** `source_string`
**keywords:** `STRING, PPI, protein links, aliases, combined_score, protein network`

STRING v12 cung cấp dữ liệu mạng tương tác protein-protein cho người, taxonomy ID `9606`.

Các file chính:

- `protein.links`: chứa các cặp protein tương tác và `combined_score`.
- `protein.aliases`: chứa alias dùng để ánh xạ gene ID hoặc gene symbol sang STRING protein ID.
- `protein.info`: chứa thông tin mô tả protein; manifest có file này nhưng cleaning hiện tại chủ yếu dùng links và aliases.

STRING được dùng để:

- Map DEG gene sang protein.
- Xây dựng protein-protein interaction network.
- Tính degree và weighted degree.
- Tính số tương tác và độ tin cậy trung bình.
- Bổ sung bằng chứng mạng vào candidate ranking.

`combined_score` của STRING nằm trong khoảng `0-1000`. Pipeline chuẩn hóa thành:

```text
edge_weight_protein = combined_score_protein / 1000.0
```

---

## KB-007: Nguồn dữ liệu GEO GSE67639

**chunk_id:** `source_geo`
**keywords:** `GEO, GSE67639, external support, tumor-only`

GEO GSE67639 là nguồn expression bên ngoài dùng để bổ sung bằng chứng cho Top 100 candidate.

Đặc điểm quan trọng:

- GEO trong project là cohort tumor-only.
- Có 1.106 sample khớp giữa expression và metadata.
- Không có nhóm Normal đối chứng.

Vì không có Normal, GEO không được dùng để:

- Tính lại Tumor-vs-Normal log2FC.
- Xác nhận lại DEG độc lập.
- Thay đổi ranking chính từ GDC + STRING.
- Khẳng định protein abundance.

GEO được dùng để đánh giá:

- Candidate gene có xuất hiện trong cohort hay không.
- Candidate có expression ở bao nhiêu sample.
- Candidate có expression tương đối cao so với các candidate khác hay không.
- Candidate có thường xuyên nằm trong top quartile expression hay không.

---

## KB-008: Ingest bằng NiFi

**chunk_id:** `nifi_ingest`
**keywords:** `NiFi, ingest, manifest, InvokeHTTP, PutHDFS, raw`

NiFi đóng vai trò orchestration và ingest dữ liệu từ nguồn bên ngoài vào HDFS raw.

Luồng STRING là flow ingest rõ nhất trong repository. Flow gồm các ý chính:

1. Tạo download manifest chứa dataset, URL, filename và HDFS subdirectory.
2. Tách manifest thành từng object hoặc từng file cần tải.
3. Trích xuất URL và metadata thành FlowFile attributes.
4. Tải file bằng `InvokeHTTP`.
5. Kiểm tra HTTP status bằng routing processor.
6. Ghi raw file thành công vào HDFS bằng `PutHDFS`.
7. Ghi file index để truy vết file, URL và thời điểm tải.
8. Route lỗi sang nhánh riêng và ghi error metadata vào HDFS.

Nguyên tắc raw layer:

- Không phân tích sinh học tại ingest.
- Không sửa nội dung nguồn.
- Không lọc gene hoặc protein tại ingest.
- Giữ khả năng audit và chạy lại downstream.

Giới hạn repository hiện tại:

- `Ingest/README.md` đang rỗng.
- `ingest_gdc_luad_raw.json` đang rỗng.
- GEO template là mô tả flow, chưa phải full NiFi flow export.
- STRING có flow/template đầy đủ hơn.

---

## KB-009: Raw count là gì?

**chunk_id:** `raw_count_definition`
**keywords:** `raw_count, RNA-seq reads, STAR count, library size`

`raw_count` là số RNA-seq read được gán vào một gene trong một sample.

Trong GDC STAR counts, pipeline sử dụng:

```text
raw_count = unstranded
```

Ví dụ:

| Gene | raw_count |
|---|---:|
| TP53 | 120 |
| EGFR | 450 |
| GAPDH | 20.000 |

Raw count được dùng chủ yếu cho Quality Control:

```text
library_size = tổng raw_count của tất cả gene trong sample
```

```text
num_detected_genes_raw_gt_0 = số gene có raw_count > 0
```

Phân tích DE trong project không dùng raw count trực tiếp; nó dùng TPM đã biến đổi thành `log2(TPM + 1)`.

---

## KB-010: TPM là gì?

**chunk_id:** `tpm_definition`
**keywords:** `TPM, Transcripts Per Million, expression normalization`

TPM là viết tắt của Transcripts Per Million. TPM biểu diễn mức expression đã chuẩn hóa theo độ dài gene và tổng lượng transcript trong sample.

Phạm vi:

```text
TPM >= 0
```

TPM không nằm trong khoảng `0-1` và không có upper bound cố định cho từng gene. Trong một sample, tổng TPM của tất cả gene về lý thuyết xấp xỉ `1.000.000`.

Một gene có thể có TPM:

```text
0, 0.2, 5, 100, 1000, 10000, ...
```

TPM gốc thường lệch mạnh: nhiều gene gần 0 và một số gene rất cao. Vì vậy pipeline biến đổi TPM trước khi phân tích DE.

---

## KB-011: Tại sao dùng log2(TPM + 1)?

**chunk_id:** `log2_tpm`
**keywords:** `log2 TPM plus one, log transformation, expression`

Pipeline biến đổi expression của từng gene trong từng sample:

```text
log2_tpm = log2(TPM + 1)
```

Mục đích:

- Nén các giá trị TPM rất lớn.
- Giảm ảnh hưởng của extreme values.
- Xử lý được `TPM = 0`, vì `log2(0 + 1) = 0`.
- Làm thang expression ổn định và dễ so sánh hơn.

Ví dụ:

| TPM | log2(TPM + 1) |
|---:|---:|
| 0 | 0 |
| 1 | 1 |
| 3 | 2 |
| 15 | 4 |
| 255 | 8 |
| 1023 | 10 |

`log2(TPM + 1)` là giá trị expression của từng gene-sample. Nó không phải `log2FC`.

---

## KB-012: Cleaning dữ liệu GDC

**chunk_id:** `cleaning_gdc`
**keywords:** `GDC cleaning, STAR rows, ENSG, protein coding, PAR_Y`

GDC cleaning đọc raw count và metadata, sau đó tạo các bảng refined.

Các bước chính:

1. Đọc file index và cases-samples metadata.
2. Chuẩn hóa `sample_group` thành `tumor`, `normal`, hoặc `other`.
3. Đọc STAR count TSV.
4. Chỉ giữ dòng gene có ID bắt đầu bằng `ENSG`.
5. Loại version suffix khỏi Ensembl gene ID.
6. Tạo `gene_id_base`.
7. Loại gene `PAR_Y` khỏi bảng protein-coding.
8. Chỉ giữ `gene_type = protein_coding` cho downstream protein target analysis.
9. Tạo các chỉ số QC theo sample.
10. Ghi Parquet Snappy vào refined HDFS.

Output:

- `gdc_file_sample_map`
- `gdc_counts_clean`
- `gdc_counts_clean_protein_coding`
- `quality_check`

Snapshot notebook ghi nhận:

- 36.456.660 dòng `gdc_counts_clean`.
- 11.986.344 dòng `gdc_counts_clean_protein_coding`.
- 601 dòng `quality_check`.

---

## KB-013: Dòng kỹ thuật STAR

**chunk_id:** `star_technical_rows`
**keywords:** `N_unmapped, N_multimapping, N_noFeature, N_ambiguous, STAR`

File STAR counts chứa một số dòng kỹ thuật không đại diện cho gene:

- `N_unmapped`: số read không map được vào genome.
- `N_multimapping`: số read map vào nhiều vị trí.
- `N_noFeature`: số read map được nhưng không thuộc feature đã chú giải.
- `N_ambiguous`: số read không thể gán duy nhất cho một gene.

Các dòng này hữu ích để đánh giá alignment nhưng không thể:

- Tính expression của một gene cụ thể.
- Tính log2FC gene.
- Map sang protein STRING.

Pipeline loại các dòng kỹ thuật bằng cách chỉ giữ dòng có `gene_id` dạng `ENSG...`.

---

## KB-014: Tại sao chỉ giữ protein-coding gene?

**chunk_id:** `protein_coding_filter`
**keywords:** `protein coding, lncRNA, miRNA, pseudogene, target`

Sau khi loại dòng kỹ thuật, GDC vẫn chứa nhiều loại gene như:

- `protein_coding`
- `lncRNA`
- `miRNA`
- `pseudogene`
- `rRNA`

Project tập trung ưu tiên protein target và dùng STRING PPI. Vì vậy bảng phục vụ downstream chỉ giữ:

```text
gene_type == "protein_coding"
```

Điều này không có nghĩa gene không mã hóa protein không quan trọng trong ung thư. Chúng chỉ nằm ngoài phạm vi của pipeline ưu tiên protein target hiện tại.

---

## KB-015: Cleaning dữ liệu STRING

**chunk_id:** `cleaning_string`
**keywords:** `STRING cleaning, gene_map, edges_protein, nodes_protein`

STRING cleaning đọc `links` và `aliases`, sau đó tạo năm bảng refined:

1. `gene_map`: ánh xạ `protein_id` sang `ensp_id`, `gene_id`, `gene_name` và `gene_confidence`.
2. `edges_protein`: các cạnh protein-protein và trọng số.
3. `edges_gene`: các cạnh được roll up ở mức gene.
4. `nodes_gene`: node gene cùng degree và weighted degree.
5. `nodes_protein`: node protein cùng degree và weighted degree.

Gene map chỉ sử dụng alias source liên quan:

- `Ensembl_gene`
- `Ensembl_HGNC_symbol`

Gene confidence:

- `high`: có cả gene ID và gene name.
- `medium`: chỉ có một trong hai.

Cleaning kiểm tra schema, duplicate protein ID, self-loop, score range và degree không âm trước khi ghi.

---

## KB-016: Cleaning dữ liệu GEO

**chunk_id:** `cleaning_geo`
**keywords:** `GEO cleaning, expression, metadata, refined geo`

GEO cleaning chuẩn hóa expression và metadata từ raw HDFS sang refined HDFS.

Input chính:

```text
/drugtarget/data/raw/geo/expression
/drugtarget/data/raw/geo/metadata
```

Output chính:

```text
/drugtarget/data/refined/geo/expression/version=v1
/drugtarget/data/refined/geo/metadata/version=v1
/drugtarget/data/refined/geo/qc/version=v1
```

Phase 6 sẽ khớp sample ID giữa expression và metadata. Snapshot hiện tại có 1.106 matched GEO tumor-cohort samples.

---

## KB-017: IQR là gì?

**chunk_id:** `iqr_definition`
**keywords:** `IQR, Q1, Q3, outlier, quartile`

IQR là Interquartile Range, tức khoảng tứ phân vị:

```text
IQR = Q3 - Q1
```

Trong đó:

- `Q1`: mốc 25% dữ liệu.
- `Q3`: mốc 75% dữ liệu.
- IQR chứa 50% dữ liệu ở giữa.

Ngưỡng phát hiện outlier:

```text
lower = Q1 - 1.5 * IQR
upper = Q3 + 1.5 * IQR
```

Một giá trị nằm ngoài `[lower, upper]` được xem là outlier theo quy tắc IQR.

Trong project, IQR được dùng để phát hiện sample bất thường, không dùng để chọn gene.

---

## KB-018: IQR được dùng ở bước nào?

**chunk_id:** `iqr_in_pipeline`
**keywords:** `IQR pipeline, GDC cleaning, quality_check, sample outlier`

IQR được dùng trong bước GDC Cleaning, khi tạo bảng:

```text
refined/gdc/quality_check
```

Pipeline tính IQR cho hai chỉ số sample:

1. `total_raw_count`, còn gọi là library size.
2. `num_detected_genes_raw_gt_0`, tức số gene có raw count lớn hơn 0.

Sau đó tạo hai cờ:

```text
is_outlier_library_size
is_outlier_detected_genes
```

Phase 1 đọc bảng `quality_check` và loại sample nếu một trong hai cờ là `true`.

Ngưỡng trong output notebook:

```text
IQR library size: -10.777.708 đến 105.165.948
IQR detected genes: 25.140 đến 40.172
```

Snapshot mart hiện tại cho biết 11 sample bị loại do detected-gene outlier; không có sample bị loại chỉ vì library size.

---

## KB-019: Library size là gì?

**chunk_id:** `library_size`
**keywords:** `library size, total_raw_count, QC`

Library size là tổng raw count của tất cả gene trong một sample:

```text
library_size = total_raw_count = sum(raw_count của tất cả gene)
```

Library size phản ánh tổng lượng sequencing signal của sample.

- Quá thấp có thể cho thấy sample ít read hoặc chất lượng yếu.
- Quá cao bất thường có thể liên quan đến khác biệt kỹ thuật hoặc batch.

Pipeline dùng IQR trên library size để tạo cờ `is_outlier_library_size`.

---

## KB-020: Phase 1 - Quality Control

**chunk_id:** `phase_1_qc`
**keywords:** `Phase 1, QC, quality control, sample filtering`

Phase 1 đọc:

- `refined/gdc/quality_check`
- `refined/gdc/gdc_counts_clean_protein_coding`

Phase 1 ưu tiên đọc Hive table nếu tồn tại; nếu không thì fallback sang Parquet HDFS.

Sample được giữ nếu không có outlier:

```text
is_outlier_library_size == false
AND
is_outlier_detected_genes == false
```

Sau khi join expression với danh sách sample pass QC, Phase 1 tạo:

```text
analysis/gdc_qc_pass_expression
```

Expression được bổ sung:

```text
log2_tpm = log2(TPM + 1)
```

Theo mart snapshot hiện tại:

- Trước QC: 601 sample.
- Sau QC: 590 sample.
- Loại 11 Tumor sample do detected-gene outlier.

---

## KB-021: Phase 2 - Differential Expression

**chunk_id:** `phase_2_de`
**keywords:** `Phase 2, Differential Expression, DEG, Tumor Normal`

Phase 2 so sánh expression của từng gene giữa Tumor và Normal.

Input:

```text
analysis/gdc_qc_pass_expression
```

Output:

```text
analysis/gdc_deg_result
```

Với mỗi gene, pipeline tính:

- Mean `log2_tpm` của Tumor.
- Mean `log2_tpm` của Normal.
- Variance và sample count của từng nhóm.
- `log2FC`.
- Welch-style t-statistic.
- p-value hai phía bằng normal approximation.
- `deg_direction`.
- `is_deg`.

Kết quả mart hiện tại:

- 19.944 gene được phân tích.
- 2.598 DEG.
- 906 Upregulated DEG.
- 1.692 Downregulated DEG.
- 17.346 gene không significant.

---

## KB-022: log2FC được tính như thế nào?

**chunk_id:** `log2fc_formula`
**keywords:** `log2FC, fold change, mean Tumor, mean Normal`

Trong project, `log2FC` được tính là hiệu của trung bình log-expression:

```text
log2FC(g) =
mean(log2(TPM + 1) của gene g trong Tumor)
-
mean(log2(TPM + 1) của gene g trong Normal)
```

Diễn giải:

- `log2FC > 0`: gene biểu hiện cao hơn ở Tumor.
- `log2FC < 0`: gene biểu hiện thấp hơn ở Tumor.
- `log2FC = 0`: expression trung bình gần như không khác.
- `|log2FC|` càng lớn thì mức khác biệt càng mạnh.

Nếu dùng cách diễn giải fold-change trên log2 scale:

```text
ratio xấp xỉ = 2 ^ log2FC
```

Ví dụ:

- `log2FC = 1`: Tumor xấp xỉ gấp 2 lần Normal.
- `log2FC = 2`: Tumor xấp xỉ gấp 4 lần Normal.
- `log2FC = -1`: Tumor xấp xỉ bằng một nửa Normal.

Lưu ý kỹ thuật: code tính hiệu trung bình của `log2(TPM + 1)`, không trực tiếp tính `log2(mean TPM Tumor / mean TPM Normal)`.

---

## KB-023: p-value được tính như thế nào?

**chunk_id:** `p_value_formula`
**keywords:** `p-value, Welch, t-statistic, normal approximation`

Với mỗi gene, pipeline tính Welch-style standard error:

```text
SE =
sqrt(
    variance_Tumor / n_Tumor
    +
    variance_Normal / n_Normal
)
```

Sau đó:

```text
t_stat = log2FC / SE
```

P-value hai phía được xấp xỉ bằng:

```text
p_value = erfc(abs(t_stat) / sqrt(2))
```

P-value trả lời:

> Nếu gene thực sự không khác biệt giữa Tumor và Normal, xác suất quan sát được chênh lệch mạnh như hiện tại là bao nhiêu?

- P-value nhỏ: khác biệt khó giải thích bằng ngẫu nhiên.
- P-value lớn: chưa đủ bằng chứng rằng khác biệt là ổn định.

Đây là Welch-style t-statistic với normal approximation, chưa phải Welch t-test đầy đủ với bậc tự do.

---

## KB-024: Tại sao chọn Welch-style t-test?

**chunk_id:** `why_welch_test`
**keywords:** `Welch t-test, two sample, unequal variance`

Pipeline so sánh hai nhóm độc lập:

```text
Tumor vs Normal
```

Welch-style t-test phù hợp vì:

- Tumor và Normal không phải paired samples.
- Số lượng sample của hai nhóm không bằng nhau.
- Phương sai expression của hai nhóm có thể khác nhau.
- Có thể tính phân tán bằng Spark từ mean, variance và sample count.

Không dùng paired t-test vì không có cặp Tumor-Normal tương ứng cho từng bệnh nhân. Không dùng Student t-test equal-variance vì giả định phương sai bằng nhau không đáng tin trong bối cảnh này.

Giới hạn: pipeline hiện tại dùng p-value thô và chưa áp dụng adjusted p-value/FDR. Các phương pháp chuyên biệt như DESeq2, edgeR hoặc limma-voom có thể phù hợp hơn cho phân tích RNA-seq nghiêm ngặt.

---

## KB-025: Điều kiện DEG

**chunk_id:** `deg_condition`
**keywords:** `DEG condition, is_deg, log2FC threshold, p-value threshold`

Một gene được xác định là Differentially Expressed Gene khi thỏa mãn đồng thời:

```text
abs(log2FC) >= 1
AND
p_value < 0.05
```

Hai điều kiện có vai trò khác nhau:

- `abs(log2FC) >= 1`: yêu cầu mức thay đổi expression đủ lớn.
- `p_value < 0.05`: yêu cầu khác biệt có bằng chứng thống kê.

Ví dụ:

| log2FC | p-value | DEG? | Lý do |
|---:|---:|---|---|
| 2.0 | 0.001 | Có | Hiệu ứng lớn và p-value nhỏ |
| 0.4 | 0.001 | Không | Hiệu ứng quá nhỏ |
| 1.5 | 0.20 | Không | Chưa đủ bằng chứng thống kê |
| -1.2 | 0.01 | Có | Downregulated và đạt cả hai ngưỡng |

---

## KB-026: Phase 3 - Gene-to-Protein Mapping

**chunk_id:** `phase_3_mapping`
**keywords:** `Phase 3, gene protein mapping, STRING gene_map`

Phase 3 chuyển DEG gene thành protein candidate để dùng trong PPI analysis.

Input:

```text
analysis/gdc_deg_result
refined/STRING/gene_map
```

Các bước:

1. Chỉ giữ gene có `is_deg = true`.
2. Chuẩn hóa gene name bằng trim và uppercase.
3. Chuẩn hóa gene name trong STRING gene map.
4. Join DEG với STRING gene map bằng gene symbol đã chuẩn hóa.
5. Chỉ giữ mapping có `protein_id`.

Output:

```text
analysis/deg_mapped_proteins
```

Kết quả mart hiện tại:

- 2.598 DEG.
- 2.579 DEG gene map được sang protein.
- 19 DEG không map được.
- Mapping rate khoảng `99,27%`.
- Protein mapping trong mart hiện tại đều có confidence `high`.

---

## KB-027: Phase 4 - PPI Network Analysis

**chunk_id:** `phase_4_ppi`
**keywords:** `Phase 4, PPI, network features, STRING edges`

Phase 4 phân tích bối cảnh mạng của các protein candidate.

Input:

```text
analysis/deg_mapped_proteins
refined/STRING/edges_protein
refined/STRING/nodes_protein
```

Ngưỡng:

```text
EDGE_WEIGHT_THRESHOLD = 0.4
HIGH_CONFIDENCE_THRESHOLD = 0.7
```

Các feature chính:

- `degree_protein`
- `weighted_degree_protein`
- `num_interactions_in_deg_network`
- `avg_combined_score`
- `max_combined_score`
- `num_high_confidence_edges`

Output:

```text
analysis/protein_network_features
```

Snapshot notebook:

- 2.579 protein candidate.
- 3.686.380 cạnh liên quan candidate trước lọc.
- 484.444 cạnh sau lọc `edge_weight >= 0.4`.

---

## KB-028: edge_weight_protein

**chunk_id:** `edge_weight_protein`
**keywords:** `edge_weight_protein, combined_score, STRING threshold`

`edge_weight_protein` là `combined_score` của STRING được scale từ `0-1000` về `0-1`:

```text
edge_weight_protein = combined_score_protein / 1000.0
```

Ví dụ:

| combined_score | edge_weight |
|---:|---:|
| 400 | 0.40 |
| 700 | 0.70 |
| 950 | 0.95 |

Trong Phase 4:

- Cạnh có `edge_weight >= 0.4` được dùng để tính interaction features.
- Cạnh có `edge_weight >= 0.7` được đếm là high-confidence edge.

Ngưỡng `0.4` là ngưỡng lọc cạnh, không phải trọng số trong Final Score.

---

## KB-029: Degree và weighted degree

**chunk_id:** `degree_weighted_degree`
**keywords:** `degree, weighted degree, centrality, PPI`

`degree_protein` là số neighbor protein khác nhau kết nối với protein.

```text
degree(p) = số neighbor khác nhau của protein p
```

`weighted_degree_protein` là tổng trọng số của các cạnh nối với protein:

```text
weighted_degree(p) = sum(edge_weight của các cạnh nối với p)
```

Weighted degree kết hợp hai yếu tố:

- Protein có bao nhiêu kết nối.
- Các kết nối đó mạnh hoặc đáng tin đến mức nào.

Ví dụ:

- Protein A có 100 cạnh, mỗi cạnh khoảng 0,5: weighted degree khoảng 50.
- Protein B có 10 cạnh, mỗi cạnh khoảng 0,9: weighted degree khoảng 9.

Protein A có tổng mức kết nối lớn hơn; protein B có chất lượng trung bình mỗi cạnh cao hơn.

---

## KB-030: Tại sao dashboard chỉ hiển thị 760 edges?

**chunk_id:** `dashboard_760_edges`
**keywords:** `760 edges, dashboard network, Top 100 subgraph`

Con số 760 trên dashboard không phải tổng số cạnh dùng trong Phase 4.

Có ba mức số liệu:

```text
3.686.380 cạnh liên quan candidate trước lọc
484.444 cạnh liên quan candidate sau edge_weight >= 0.4
760 cạnh giữa chính các protein thuộc Top 100
```

Phase 4 giữ cạnh khi ít nhất một đầu là candidate trong toàn bộ 2.579 protein để tính feature mạng.

Dashboard chỉ vẽ induced subgraph của Top 100:

```text
cả protein nguồn và protein đích đều thuộc Top 100
AND edge_weight >= 0.4
```

Vì vậy dashboard chỉ hiển thị 760 cạnh để visualization dễ đọc.

---

## KB-031: Phase 5 - Candidate Target Scoring

**chunk_id:** `phase_5_scoring`
**keywords:** `Phase 5, candidate scoring, Final Score, Top 100`

Phase 5 kết hợp bằng chứng expression và network để xếp hạng protein candidate.

Input:

```text
analysis/deg_mapped_proteins
analysis/protein_network_features
```

Nếu một protein có nhiều evidence, pipeline giữ evidence có `abs(log2FC)` lớn nhất; nếu cần, ưu tiên p-value thấp hơn.

Pipeline chuẩn hóa ba feature:

1. `abs_log2FC` thành `expression_score`.
2. `weighted_degree_protein` thành `protein_network_score`.
3. `avg_combined_score` thành `string_confidence_score`.

Sau đó tính `final_score`, xếp hạng toàn bộ 2.579 candidate và chọn Top 100.

Output:

```text
analysis/candidate_target_features
mart/top_candidate_targets
```

---

## KB-032: Chuẩn hóa Min-Max

**chunk_id:** `minmax_normalization`
**keywords:** `min max normalization, score 0 to 1`

Các feature gốc có đơn vị và phạm vi rất khác nhau:

- `abs(log2FC)` thường ở mức đơn vị nhỏ.
- `weighted_degree` có thể lên đến hàng nghìn.
- `avg_combined_score` nằm trên thang `0-1000`.

Nếu cộng trực tiếp, feature có giá trị số lớn sẽ áp đảo. Pipeline dùng Min-Max để đưa feature về khoảng `0-1`:

```text
Norm(z_p) =
(z_p - min(z trên toàn bộ candidate))
/
(max(z trên toàn bộ candidate) - min(z trên toàn bộ candidate))
```

Trong Phase 5, `min` và `max` được lấy trên toàn bộ 2.579 protein candidate được chấm điểm, không chỉ Top 100.

- Candidate có feature nhỏ nhất nhận score 0.
- Candidate có feature lớn nhất nhận score 1.
- Candidate khác nhận điểm tương đối giữa 0 và 1.

---

## KB-033: Expression Score

**chunk_id:** `expression_score`
**keywords:** `expression_score, abs_log2FC, Phase 5`

Expression Score đại diện cho độ lớn thay đổi expression Tumor-vs-Normal:

```text
abs_log2FC = abs(log2FC)
```

```text
expression_score(p) =
(abs_log2FC(p) - min_abs_log2FC)
/
(max_abs_log2FC - min_abs_log2FC)
```

Pipeline dùng trị tuyệt đối nên cả gene tăng mạnh và giảm mạnh trong Tumor đều có thể nhận Expression Score cao.

P-value không trực tiếp tham gia Expression Score. P-value đã được dùng để xác định DEG và có thể dùng làm tie-break cho evidence.

---

## KB-034: Protein Network Score

**chunk_id:** `protein_network_score`
**keywords:** `protein_network_score, weighted_degree, Phase 5`

Protein Network Score đại diện cho tổng mức kết nối của protein trong mạng STRING:

```text
protein_network_score(p) =
(weighted_degree(p) - min_weighted_degree)
/
(max_weighted_degree - min_weighted_degree)
```

`min_weighted_degree` và `max_weighted_degree` là giá trị nhỏ nhất và lớn nhất trong toàn bộ 2.579 candidate.

Network Score cao cho biết protein có nhiều kết nối, kết nối mạnh, hoặc cả hai. Nó không tự chứng minh protein là drug target tốt.

---

## KB-035: STRING Confidence Score

**chunk_id:** `string_confidence_score`
**keywords:** `STRING confidence, avg_combined_score, Phase 5`

STRING Confidence Score dùng độ tin cậy trung bình của các tương tác liên quan protein:

```text
string_confidence_score(p) =
(avg_combined_score(p) - min_avg_combined_score)
/
(max_avg_combined_score - min_avg_combined_score)
```

`avg_combined_score` được tính từ các cạnh liên quan candidate sau ngưỡng Phase 4.

Confidence Score cao có nghĩa các tương tác quanh protein có điểm STRING trung bình cao. Protein có ít cạnh nhưng các cạnh rất mạnh vẫn có thể có Confidence Score cao.

---

## KB-036: Khác nhau giữa Network Score và STRING Confidence

**chunk_id:** `network_vs_confidence`
**keywords:** `Network Score vs Confidence, double count, STRING`

Network Score và STRING Confidence đều bắt nguồn từ STRING nhưng đo hai khía cạnh khác nhau:

- Network Score dùng `weighted_degree`: đo tổng sức mạnh kết nối; protein nhiều cạnh thường được lợi.
- Confidence Score dùng `avg_combined_score`: đo chất lượng trung bình của mỗi cạnh; ít phụ thuộc số cạnh hơn.

Ví dụ:

| Protein | Số cạnh | Trọng số trung bình | Weighted degree | Avg confidence |
|---|---:|---:|---:|---:|
| A | 100 | 0,45 | 45 | 450 |
| B | 10 | 0,90 | 9 | 900 |

Protein A mạnh về network breadth. Protein B mạnh về average confidence.

Hai feature vẫn có thể tương quan và có nguy cơ double-count bằng chứng STRING. Project hiện chưa có correlation analysis hoặc ablation study để chứng minh hai feature hoàn toàn độc lập.

---

## KB-037: Công thức Final Score

**chunk_id:** `final_score_formula`
**keywords:** `Final Score, 0.5, 0.3, 0.2, ranking`

Final Score được tính:

```text
final_score =
0.5 * expression_score
+ 0.3 * protein_network_score
+ 0.2 * string_confidence_score
```

Ý nghĩa:

- 50% từ độ lớn thay đổi expression LUAD.
- 30% từ tổng mức kết nối protein.
- 20% từ độ tin cậy trung bình của tương tác STRING.

Final Score nằm trong khoảng `0-1`.

Thứ tự tie-break:

1. Final Score giảm dần.
2. `abs(log2FC)` giảm dần.
3. `weighted_degree_protein` giảm dần.
4. Gene name tăng dần.

GEO Support Score và K-Means cluster không tham gia Final Score.

---

## KB-038: Lý do trọng số 0.5, 0.3, 0.2

**chunk_id:** `final_score_weights`
**keywords:** `weight rationale, baseline weights, sensitivity analysis`

Bộ trọng số `0.5-0.3-0.2` là cấu hình baseline do nhóm thiết kế thủ công, chưa được chứng minh là tối ưu.

Giả định thiết kế:

- Expression nhận 0,5 vì đây là bằng chứng trực tiếp và đặc hiệu hơn cho LUAD Tumor-vs-Normal.
- Network nhận 0,3 vì vai trò mạng quan trọng nhưng có thể ưu tiên quá mức các hub protein phổ biến.
- Confidence nhận 0,2 vì nó bổ sung chất lượng bằng chứng mạng và cũng bắt nguồn từ STRING.

Không có bằng chứng hiện tại cho thấy 0,5 chắc chắn tốt hơn 0,4. Để chứng minh trọng số, cần sensitivity analysis hoặc benchmark trên tập target LUAD đã biết.

Các cấu hình nên so sánh:

```text
0.5 - 0.3 - 0.2
0.4 - 0.4 - 0.2
0.4 - 0.3 - 0.3
0.6 - 0.2 - 0.2
0.5 - 0.5 - 0.0
```

Chatbot không được khẳng định bộ trọng số hiện tại là tối ưu.

---

## KB-039: Top candidate hiện tại

**chunk_id:** `top_candidates_snapshot`
**keywords:** `Top candidate, SFTPC, AGER, CLDN18, FABP4, GAPDH`

Top candidate theo mart snapshot hiện tại:

| Rank | Gene | Final Score | log2FC | GEO Support |
|---:|---|---:|---:|---|
| 1 | SFTPC | 0,6574 | -8,1909 | Moderate |
| 2 | AGER | 0,5565 | -6,5670 | Limited |
| 3 | CLDN18 | 0,5229 | -6,3243 | Limited |
| 4 | FABP4 | 0,4931 | -5,6672 | Limited |
| 5 | GAPDH | 0,4632 | 1,4612 | Moderate |

Trong Top 100:

- 69 candidate Downregulated.
- 31 candidate Upregulated.

Các candidate này được ưu tiên theo công thức project; chúng chưa phải drug target đã được xác thực.

---

## KB-040: Phase 6 - GEO Support

**chunk_id:** `phase_6_geo_support`
**keywords:** `Phase 6, GEO Support, external cohort`

Phase 6 đánh giá Top 100 candidate bằng GEO tumor-only cohort.

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
```

GEO Support không thay đổi ranking GDC + STRING. Nó chỉ bổ sung chú giải expression bên ngoài.

Snapshot hiện tại:

- 1.106 matched GEO sample.
- 82/100 candidate tìm thấy trong GEO.
- 47 Moderate GEO support.
- 35 Limited GEO support.
- 18 Not Found.
- Không có Strong GEO support.

---

## KB-041: GEO Mean Percentile

**chunk_id:** `geo_mean_percentile`
**keywords:** `GEO mean percentile, rank-based expression`

`geo_mean_percentile` là điểm xếp hạng expression tương đối, không phải expression raw, không phải Min-Max mean expression và không phải log2FC.

Với mỗi GEO sample:

1. Chỉ xét các Top 100 candidate gene có expression trong sample đó.
2. Xếp hạng gene theo expression.
3. Chuyển thứ hạng thành percentile từ 0 đến 1.
4. Gene cao hơn nhiều candidate khác nhận percentile cao.

Sau đó:

```text
geo_mean_percentile(g) =
trung bình expression percentile của gene g qua các GEO sample
```

Ví dụ gene có percentile `0.60, 0.55, 0.70, 0.65`:

```text
geo_mean_percentile = 0.625
```

Điều này nghĩa là gene thường có expression cao hơn khoảng 62,5% candidate gene khác trong cohort.

Percentile giúp giảm ảnh hưởng của scale khác nhau và extreme values, nhưng chỉ so sánh trong tập candidate được xét.

---

## KB-042: GEO Coverage Rate

**chunk_id:** `geo_coverage_rate`
**keywords:** `GEO coverage, expression availability`

GEO Coverage Rate là tỷ lệ sample GEO có expression hợp lệ của candidate gene:

```text
geo_coverage_rate =
geo_num_samples_available
/
geo_total_samples
```

Ví dụ:

```text
1.000 sample có expression / 1.106 total sample
= 0,904
```

Coverage cao cho biết gene có dữ liệu expression ở nhiều sample. Coverage không trực tiếp chứng minh gene có expression cao.

---

## KB-043: GEO Top-Quartile Rate

**chunk_id:** `geo_top_quartile_rate`
**keywords:** `GEO top quartile, percentile 0.75`

Trong mỗi GEO sample, candidate gene được đánh dấu nằm trong top quartile nếu:

```text
geo_expression_percentile >= 0.75
```

Top-Quartile Rate:

```text
geo_top_quartile_rate =
số sample mà gene nằm trong top quartile
/
tổng số GEO sample
```

Giá trị cao cho biết gene thường xuyên nằm trong nhóm 25% candidate có expression cao nhất.

Đây không phải IQR filtering.

---

## KB-044: Công thức GEO Support Score

**chunk_id:** `geo_support_score`
**keywords:** `GEO Support Score, coverage, percentile, top quartile`

GEO Support Score:

```text
geo_support_score =
0.2 * geo_coverage_rate
+ 0.5 * geo_mean_percentile
+ 0.3 * geo_top_quartile_rate
```

Gán nhãn:

```text
score >= 0.75        -> Strong GEO support
0.50 <= score < 0.75 -> Moderate GEO support
score < 0.50         -> Limited GEO support
không match GEO      -> Not Found
```

Ví dụ:

```text
coverage = 0.90
mean_percentile = 0.70
top_quartile_rate = 0.40

score = 0.2*0.90 + 0.5*0.70 + 0.3*0.40
      = 0.65
```

Candidate nhận nhãn Moderate GEO support.

Trọng số GEO cũng là cấu hình thiết kế thủ công, chưa được chứng minh tối ưu.

---

## KB-045: Ví dụ GEO Support của SFTPC

**chunk_id:** `geo_example_sftpc`
**keywords:** `SFTPC, GEO example`

Theo mart hiện tại:

```text
Gene: SFTPC
GDC + STRING rank: 1
Final Score: 0,6574
GEO Coverage Rate: 0,9955
GEO Mean Percentile: 0,5042
GEO Top-Quartile Rate: 0,2541
GEO Support Score: 0,5274
GEO Support Level: Moderate GEO support
```

Diễn giải:

- SFTPC đứng hạng 1 do Final Score từ GDC + STRING.
- SFTPC xuất hiện ở gần như toàn bộ GEO sample.
- Expression tương đối của SFTPC trong tập candidate ở mức trung bình.
- GEO bổ sung nhãn Moderate, nhưng không làm đổi hạng 1.

---

## KB-046: Phase 7 - K-Means Clustering

**chunk_id:** `phase_7_kmeans`
**keywords:** `Phase 7, KMeans, clustering, Spark ML`

Phase 7 dùng Spark ML K-Means để phân nhóm toàn bộ 2.579 candidate theo profile đặc trưng.

Mục tiêu là khám phá các kiểu candidate, không thay thế ranking Final Score.

Bốn feature:

```text
abs_log2FC
log1p(weighted_degree_protein)
avg_combined_score
log1p(num_interactions_in_deg_network)
```

Các feature được ghép thành vector và chuẩn hóa bằng `StandardScaler`.

Pipeline thử:

```text
k = 2, 3, 4, 5, 6
```

Chọn k có silhouette score cao nhất. Seed là `42`.

Output:

```text
analysis/ml_candidate_features
analysis/ml_k_selection
analysis/candidate_clusters
analysis/ml_cluster_summary
mart/top_candidate_targets_enriched
```

---

## KB-047: K-Means và silhouette score

**chunk_id:** `kmeans_silhouette`
**keywords:** `silhouette score, selected k, cluster assignment`

Silhouette score đo mức độ tách biệt giữa các cluster:

- Gần 1: cluster tách biệt rõ.
- Gần 0: cluster chồng lấp nhiều.
- Âm: nhiều điểm có thể gần cluster khác hơn cluster được gán.

Snapshot hiện tại:

| k | Silhouette Score |
|---:|---:|
| 2 | 0,4954 |
| 3 | 0,5049 |
| 4 | 0,3961 |
| 5 | 0,3987 |
| 6 | 0,3473 |

Best k là `3`.

K-Means không dùng một ngưỡng điểm cố định để gán cluster. Mỗi candidate được gán vào centroid gần nhất trong không gian bốn feature đã chuẩn hóa.

---

## KB-048: Kết quả cluster hiện tại

**chunk_id:** `cluster_results`
**keywords:** `cluster 0, cluster 1, cluster 2, candidate group`

Phân bố toàn bộ 2.579 candidate:

| Cluster | Candidate | Avg abs log2FC | Avg weighted degree | Avg interactions | Avg Final Score |
|---:|---:|---:|---:|---:|---:|
| 0 | 315 | 3,0003 | 415,9203 | 98,9397 | 0,2963 |
| 1 | 1.078 | 1,4795 | 198,9997 | 27,8878 | 0,1672 |
| 2 | 1.186 | 1,4734 | 638,8713 | 182,6610 | 0,2091 |

Top 100 phân bố:

- Cluster 0: 83 candidate.
- Cluster 1: 0 candidate.
- Cluster 2: 17 candidate.

Cluster ID là nhãn kỹ thuật, không phải thứ tự tốt-xấu.

---

## KB-049: Mart được tạo ở bước nào?

**chunk_id:** `mart_creation`
**keywords:** `mart, Phase 5, Phase 7, visualization mart`

HDFS mart được ghi tại hai bước chính:

Phase 5:

```text
mart/top_candidate_targets
```

Nội dung là Top 100 candidate sau Final Score.

Phase 7:

```text
mart/top_candidate_targets_enriched
```

Nội dung kết hợp:

- Ranking Phase 5.
- GEO Support từ Phase 6.
- K-Means cluster từ Phase 7.

Sau đó script:

```text
src/distributed/build_visualization_marts.py
```

đọc dữ liệu từ HDFS `refined`, `analysis` và `mart`, rồi tạo local JSON:

```text
data/mart/*.json
```

Các JSON này được FastAPI và dashboard sử dụng.

---

## KB-050: Visualization Mart Builder

**chunk_id:** `visualization_mart_builder`
**keywords:** `build_visualization_marts, JSON mart, dashboard`

Visualization Mart Builder là PySpark job:

```text
python3 -m src.distributed.build_visualization_marts
```

Job chỉ đọc HDFS phase outputs và ghi local JSON snapshots. Nó không tạo mock data.

Các mart gồm:

- Overview metrics.
- QC sample counts và exclusion summary.
- Volcano plot và DEG summary.
- Mapping summary và unmapped genes.
- PPI nodes, edges và score distribution.
- Top candidate enriched.
- GEO support views.
- ML k-selection, cluster points và cluster summary.

Nếu một mart thiếu, backend trả thông báo unavailable thay vì dùng dữ liệu giả.

---

## KB-051: FastAPI backend

**chunk_id:** `fastapi_backend`
**keywords:** `FastAPI, API, MartRepository, backend`

FastAPI backend nằm tại:

```text
src/backend/app.py
```

Backend đọc mart thông qua `MartRepository`:

- Ưu tiên MongoDB nếu được bật và kết nối thành công.
- Nếu không, đọc local JSON trong `data/mart`.
- Nếu thiếu mart, trả trạng thái unavailable.

Nhóm API chính:

- `/api/v1/overview`
- `/api/v1/visualizations/qc/...`
- `/api/v1/visualizations/deg/...`
- `/api/v1/visualizations/mapping/...`
- `/api/v1/visualizations/network`
- Candidate ranking và target detail.
- `/api/v1/visualizations/geo/...`
- `/api/v1/visualizations/ml/...`

AI Assistant hiện chỉ là UI placeholder; chưa kết nối model API, RAG hoặc finetune.

---

## KB-052: Vai trò của Hive

**chunk_id:** `hive_role`
**keywords:** `Hive, catalog, Spark table, HDFS Parquet`

Trong project, Hive không phải nơi lưu dữ liệu chính. Dữ liệu thật nằm trong HDFS dưới dạng Parquet.

Vai trò:

```text
HDFS = lưu file dữ liệu thật
Hive = catalog đặt tên bảng và quản lý schema
```

Ví dụ:

```text
HDFS path:
hdfs://master11:9000/drugtarget/data/refined/gdc/quality_check

Hive table:
gdc.quality_check
```

Notebook thường:

1. Thử đọc Hive table.
2. Nếu table chưa tồn tại, fallback sang Parquet HDFS.

Các table dự kiến:

- `gdc.quality_check`
- `gdc.gdc_counts_clean_protein_coding`
- `STRING.gene_map`
- `geo.expression`
- `geo.metadata`

Hive là tiện ích, không bắt buộc để pipeline chạy.

---

## KB-053: Số liệu snapshot tổng quan

**chunk_id:** `current_snapshot_metrics`
**keywords:** `current metrics, pipeline counts, snapshot`

Số liệu từ `data/mart/overview_summary.json`:

| Metric | Giá trị |
|---|---:|
| GDC samples before QC | 601 |
| GDC samples after QC | 590 |
| Tumor samples after QC | 531 |
| Normal samples after QC | 59 |
| Differentially expressed genes | 2.598 |
| DEG mapped to proteins | 2.579 |
| Protein candidates scored | 2.579 |
| PPI edges in Top-100 graph | 760 |
| Top candidate targets | 100 |
| Candidates with GEO support | 82 |
| ML clusters | 3 |

Đây là số liệu snapshot của mart hiện tại, không nhất thiết phản ánh một lần chạy HDFS mới hơn nếu pipeline chưa rebuild mart.

---

## KB-054: Chênh lệch số sample

**chunk_id:** `sample_count_discrepancy`
**keywords:** `579, 590, 520, 531, discrepancy`

Repository hiện có chênh lệch số sample giữa tài liệu/notebook output cũ và mart snapshot:

```text
Tài liệu hoặc output cũ:
579 sample = 520 Tumor + 59 Normal

Mart snapshot hiện tại:
590 sample = 531 Tumor + 59 Normal
```

Nguyên nhân hợp lý nhất là các artifact được tạo từ các lần chạy hoặc phiên bản dữ liệu khác nhau.

Quy tắc trả lời:

- Nếu hỏi dashboard hoặc mart hiện tại: dùng 590, gồm 531 Tumor và 59 Normal.
- Nếu giải thích notebook output cụ thể: có thể nhắc 579 và nói đó là output của lần chạy cũ.
- Không trộn hai số liệu mà không giải thích.

---

## KB-055: Giới hạn khoa học và kỹ thuật

**chunk_id:** `limitations`
**keywords:** `limitations, FDR, GEO tumor-only, weights, hub bias`

Các giới hạn chính:

1. Phase 2 dùng p-value thô, chưa có adjusted p-value/FDR.
2. P-value dùng normal approximation thay vì Welch t-distribution đầy đủ.
3. Phân tích RNA-seq chưa dùng DESeq2, edgeR hoặc limma-voom.
4. GEO là tumor-only, không phải independent Tumor-vs-Normal validation.
5. GEO percentile chỉ so sánh trong tập Top 100 candidate.
6. Final Score weights `0.5-0.3-0.2` là baseline thủ công.
7. GEO weights `0.2-0.5-0.3` cũng là baseline thủ công.
8. Network Score và STRING Confidence có thể tương quan và double-count bằng chứng STRING.
9. Hub protein phổ biến như GAPDH có thể nhận Network Score cao.
10. Một số expected counts trong Phase 7 được hard-code.
11. Artifact giữa notebook, HDFS và local mart có thể không cùng version.
12. Kết quả là candidate prioritization, không phải clinical recommendation.

---

## KB-056: Hướng phát triển tiếp theo

**chunk_id:** `future_work`
**keywords:** `future work, RAG, validation, sensitivity analysis`

Các hướng phát triển phù hợp:

- Hoàn thiện và version hóa ingest GDC/GEO/STRING.
- Đăng ký Hive tables rõ ràng và tự động.
- Bổ sung adjusted p-value/FDR.
- So sánh với DESeq2, edgeR hoặc limma-voom.
- Thực hiện sensitivity analysis cho trọng số Final Score và GEO Support.
- Kiểm tra correlation và ablation giữa Network Score và Confidence Score.
- Bổ sung pathway enrichment, druggability, literature và known-target evidence.
- Dùng cohort bên ngoài có cả Tumor và Normal.
- Bổ sung protein abundance hoặc proteomics.
- Tự động version hóa run, HDFS output và mart snapshot.
- Xây dựng RAG chatbot với Gemini 2.5 Flash và ChromaDB.

---

## KB-057: Quy tắc trả lời của chatbot RAG

**chunk_id:** `rag_answering_rules`
**keywords:** `RAG rules, chatbot behavior, grounding`

Chatbot phục vụ project nên tuân thủ:

1. Phân biệt rõ dữ liệu, công thức code hiện tại và đề xuất cải tiến.
2. Không khẳng định candidate là drug target đã được xác thực.
3. Không nói GEO là Tumor-vs-Normal validation.
4. Không nói trọng số hiện tại là tối ưu.
5. Không nói K-Means cluster là nhãn tốt-xấu.
6. Không nói p-value hiện tại là adjusted p-value.
7. Khi gặp số sample 579 và 590, giải thích chênh lệch artifact.
8. Phân biệt 484.444 Phase-4 edges với 760 dashboard Top-100 edges.
9. Phân biệt `edge_weight >= 0.4` với trọng số Final Score.
10. Không trả lời hoặc lưu trữ password, token hay secret.
11. Nếu thiếu bằng chứng trong knowledge base, nói rõ chưa có dữ liệu thay vì suy đoán.

---

## KB-058: FAQ - DE và DA là gì trong project?

**chunk_id:** `faq_de_da`
**keywords:** `DE, DA, Differential Expression, downstream analysis`

Khối Differential Expression gồm:

```text
Thu thập GDC
-> Cleaning và chuẩn hóa
-> Quality Control
-> Phase 2 Differential Expression
```

DE tạo danh sách DEG bằng `abs(log2FC) >= 1` và `p_value < 0.05`.

Khối downstream Data Analytics gồm:

```text
Phase 3 Gene-to-Protein Mapping
-> Phase 4 PPI Network Analysis
-> Phase 5 Candidate Scoring
-> Phase 6 GEO Support
-> Phase 7 K-Means Clustering
-> Mart và Dashboard
```

DA sử dụng kết quả DEG để ưu tiên và diễn giải protein candidate.

---

## KB-059: FAQ - log2(TPM+1), log2FC và p-value khác nhau thế nào?

**chunk_id:** `faq_log_expression_statistics`
**keywords:** `log2 TPM, log2FC, p-value differences`

`log2(TPM + 1)`:

- Là expression đã biến đổi của một gene trong một sample.
- Dùng để nén TPM và ổn định thang đo.

`log2FC`:

- Là chênh lệch trung bình `log2(TPM + 1)` giữa Tumor và Normal.
- Đo mức khác biệt và chiều tăng/giảm.

`p-value`:

- Được suy ra từ chênh lệch trung bình, variance và số sample.
- Đo mức bằng chứng thống kê rằng khác biệt không chỉ do ngẫu nhiên.

Một gene có thể:

- Log2FC lớn nhưng p-value lớn nếu expression dao động mạnh.
- P-value nhỏ nhưng log2FC nhỏ nếu chênh lệch nhỏ nhưng rất ổn định.

Vì vậy DEG cần cả effect size và statistical significance.

---

## KB-060: FAQ - GEO Score có dùng để xếp hạng không?

**chunk_id:** `faq_geo_ranking`
**keywords:** `GEO ranking, Final Score, rerank`

Không. GEO Support Score không tham gia Final Score và không thay đổi ranking chính.

Ranking chính:

```text
GDC expression + STRING network + STRING confidence
```

GEO chỉ bổ sung:

- Match status.
- Coverage.
- Mean percentile.
- Top-quartile rate.
- Support Score.
- Support Level.

Candidate có GEO support thấp vẫn có thể đứng hạng cao nếu Final Score chính cao.

---

## KB-061: FAQ - Candidate ranking có ý nghĩa gì?

**chunk_id:** `faq_ranking_meaning`
**keywords:** `ranking meaning, drug target validation`

Candidate ranking cho biết protein nào được ưu tiên cao hơn theo công thức và dữ liệu hiện tại của project.

Ranking không chứng minh:

- Protein có thể được druggable.
- Protein an toàn khi can thiệp.
- Protein là nguyên nhân gây LUAD.
- Protein đã được xác thực lâm sàng.
- Protein chắc chắn phù hợp làm drug target.

Ranking là công cụ sàng lọc để giảm không gian tìm kiếm trước các bước validation tiếp theo.

---

## KB-062: Bản đồ file quan trọng

**chunk_id:** `important_files`
**keywords:** `repository files, notebooks, source map`

Các file quan trọng:

```text
README.md
Cleaning/gdc_cleaning.ipynb
Cleaning/geo_cleaning.ipynb
Cleaning/string_cleaning.ipynb
analysis/gdc_phase1_quality_check.ipynb
analysis/gdc_phase2_expression_analysis.ipynb
analysis/gdc_phase3_map_gene_to_protein.ipynb
analysis/gdc_phase4_ppi_network_analysis.ipynb
analysis/gdc_phase5_candidate_target_scoring.ipynb
analysis/gdc_phase6_geo_external_validation.ipynb
ML/gdc_phase7_candidate_clustering.ipynb
src/distributed/build_visualization_marts.py
src/backend/app.py
src/backend/repository.py
src/backend/settings.py
src/frontend/index.html
src/frontend/app.js
data/mart/*.json
paper/section_3_problem_definition.md
```

Notebook là nguồn logic phase. `data/mart/*.json` là nguồn số liệu dashboard snapshot. `src/backend/app.py` là nguồn API và logic diễn giải dashboard.

---

## KB-063: Chuỗi output HDFS theo phase

**chunk_id:** `hdfs_outputs_by_phase`
**keywords:** `HDFS output, phase paths`

Chuỗi output chính:

```text
refined/gdc/quality_check
refined/gdc/gdc_counts_clean_protein_coding
    |
    v
analysis/gdc_qc_pass_expression
    |
    v
analysis/gdc_deg_result
    |
    v
analysis/deg_mapped_proteins
    |
    v
analysis/protein_network_features
    |
    v
analysis/candidate_target_features
    |
    v
mart/top_candidate_targets
    |
    +--> analysis/geo_validation_result
    |
    +--> analysis/candidate_clusters
    |
    v
mart/top_candidate_targets_enriched
```

Top enriched mart là kết quả cuối kết hợp ranking, GEO support và ML cluster.

---

## KB-064: Thuật ngữ quan trọng

**chunk_id:** `glossary`
**keywords:** `glossary, terminology`

| Thuật ngữ | Định nghĩa trong project |
|---|---|
| LUAD | Lung Adenocarcinoma |
| Sample | Một mẫu RNA-seq Tumor hoặc Normal |
| Gene | Đơn vị expression, thường nhận dạng bằng ENSG và gene symbol |
| Protein candidate | Protein STRING map được từ DEG |
| Raw count | Số read được gán vào gene trong sample |
| TPM | Expression đã chuẩn hóa theo gene length và library |
| log2_tpm | `log2(TPM + 1)` |
| log2FC | Hiệu trung bình log2_tpm Tumor và Normal |
| DEG | Gene đạt `abs(log2FC) >= 1` và `p_value < 0.05` |
| PPI | Protein-Protein Interaction |
| combined_score | Điểm tin cậy STRING trên thang 0-1000 |
| edge_weight | combined_score chia 1000 |
| degree | Số neighbor khác nhau |
| weighted degree | Tổng edge weight |
| Final Score | Điểm ranking chính từ expression, network và confidence |
| GEO Support | Chú giải expression từ tumor-only external cohort |
| Mart | Dữ liệu cuối tối ưu cho truy vấn và dashboard |
| Cluster | Nhóm K-Means theo profile feature, không phải hạng |

---

## KB-065: Tóm tắt pipeline trong một câu

**chunk_id:** `pipeline_one_sentence`
**keywords:** `pipeline summary`

DrugTargetProject thu thập và làm sạch GDC, STRING và GEO; dùng GDC để tìm DEG Tumor-vs-Normal; map DEG sang protein STRING; tính đặc trưng PPI; xếp hạng protein bằng Final Score; bổ sung GEO tumor-only support; phân nhóm candidate bằng K-Means; rồi đưa Top 100 enriched candidate vào mart, FastAPI và dashboard.
