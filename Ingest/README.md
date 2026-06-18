# Module ingest

`Ingest/` chứa các artifact định hướng NiFi để đưa dữ liệu raw từ GDC, STRING và GEO vào HDFS.

Layer ingest chỉ nên tải và lưu dữ liệu nguồn. Cleaning, filtering, diễn giải sinh học và phân tích nằm ở `Cleaning/`, `analysis/` và `ML/`.

---

## Nội dung hiện tại

```text
Ingest/
├── README.md
├── manifest/
│   ├── gdc_manifest.2026-05-13.232526.txt
│   └── string_manifest.json
└── template/
    ├── ingest_STRING_raw.json
    ├── ingest_geo_raw.json
    └── ingest_gdc_luad_raw.json
```

| File | Trạng thái | Vai trò |
|---|---|---|
| `template/ingest_STRING_raw.json` | NiFi flow export đầy đủ | Tải STRING Homo sapiens files, ghi raw files, file index và error metadata vào HDFS |
| `template/ingest_geo_raw.json` | JSON mô tả flow | Mô tả luồng parse URL GEO -> HTTP download -> HDFS write |
| `template/ingest_gdc_luad_raw.json` | Placeholder rỗng | GDC ingest flow chưa được biểu diễn thành template đầy đủ trong repo |
| `manifest/string_manifest.json` | Manifest sẵn sàng | Liệt kê STRING `links`, `aliases`, `details` downloads |
| `manifest/gdc_manifest.2026-05-13.232526.txt` | Mẫu response GDC API | Chứa metadata file GDC mẫu, không phải NiFi template |

---

## STRING Ingest Flow

Tên NiFi flow trong `ingest_STRING_raw.json`:

```text
STRING_HomoSapien_Ingest
```

Processor chính:

| Processor | Vai trò |
|---|---|
| `Generate STRING Download Manifest` | Tạo manifest file cần tải |
| `Split STRING Manifest Rows` | Tách manifest thành mỗi FlowFile một dataset |
| `Extract STRING File Attributes` | Extract dataset, URL, filename, tax ID, STRING version |
| `Set STRING HDFS Paths` | Tạo raw, metadata và error HDFS directories |
| `Download STRING File` | Tải file bằng `InvokeHTTP` |
| `Check HTTP Status` | Route HTTP 200 và failure |
| `Put STRING Raw File To HDFS` | Ghi source file đã tải vào HDFS |
| `Build STRING File Index JSON.` | Tạo metadata JSON cho file tải thành công |
| `Put STRING File Index To HDFS` | Ghi file index metadata |
| `Build STRING Error JSON` | Tạo metadata JSON cho lỗi |
| `Put STRING Error To HDFS` | Ghi error records |

Schedule trong template:

```text
0 0 2 ? * SUN *
```

Raw paths:

```text
/drugtarget/data/raw/STRING/${hdfs.subdir}/run_date=${now():format("yyyy-MM-dd")}
/drugtarget/data/raw/STRING/metadata/file_index/run_date=${now():format("yyyy-MM-dd")}
/drugtarget/data/raw/STRING/metadata/error/run_date=${now():format("yyyy-MM-dd")}
```

Manifest datasets:

| Dataset | File |
|---|---|
| `links` | `9606.protein.links.v12.0.txt.gz` |
| `aliases` | `9606.protein.aliases.v12.0.txt.gz` |
| `details` | `9606.protein.info.v12.0.txt.gz` |

---

## GEO Ingest Specification

`template/ingest_geo_raw.json` mô tả flow một nhánh:

```text
GenerateFlowFile -> SplitText -> ExtractText -> InvokeHTTP -> UpdateAttribute -> PutHDFS
```

Flow extract URL vào:

```text
${my_url:trim()}
```

và dùng làm `InvokeHTTP` remote URL. Hadoop configuration resources trong specification:

```text
/etc/hadoop/conf/core-site.xml, /etc/hadoop/conf/hdfs-site.xml
```

---

## Trạng thái GDC

`template/ingest_gdc_luad_raw.json` hiện là file 0 byte. Không dùng file này như NiFi flow có thể chạy.

Repo có GDC manifest/API response sample:

```text
manifest/gdc_manifest.2026-05-13.232526.txt
```

GDC cleaning downstream kỳ vọng raw files ở:

```text
hdfs://master11:9000/drugtarget/data/raw/gdc/counts/file_id=*/*.tsv
hdfs://master11:9000/drugtarget/data/raw/gdc/metadata/files_index/run_date=*/files_index_from_*.json
hdfs://master11:9000/drugtarget/data/raw/gdc/metadata/cases_samples/run_date=*/cases_samples.tsv
```

---

## Nguyên tắc ingest

- Giữ raw data bất biến.
- Có run date hoặc version trong HDFS path.
- Ghi file index metadata cho file đã tải.
- Route lỗi tải file sang error path riêng.
- Không lọc/diễn giải sinh học trong NiFi.
- Không commit raw data lớn vào Git.
