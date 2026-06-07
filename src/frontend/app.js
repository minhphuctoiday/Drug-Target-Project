const state = {
  currentTarget: null,
  pipelineIndex: 0,
  pipelineDirection: "next",
  networkHit: [],
  hits: {},
  data: {},
  tableSort: { candidate: { key: "rank", dir: "asc" } },
  volcanoView: { centerX: 0, minY: 0 },
  networkView: { panX: 0, panY: 0 },
  mlView: { centerX: 0, centerY: 0 },
  drag: null,
  suppressNetworkClick: false
};

const colors = {
  green: "#00d4b4",
  cyan: "#38bdf8",
  amber: "#f6b94b",
  red: "#ff6174",
  blue: "#5b91ff",
  purple: "#b58cff",
  gray: "#7f958d",
  ink: "#dcece6",
  line: "rgba(224, 255, 244, 0.09)"
};
const clusterColors = ["#00d4b4", "#38bdf8", "#f6b94b", "#ff6174", "#b58cff", "#8da39b"];
let hoveredNetworkProteinId = null;
let overviewHasAnimated = false;
const geoSupportColors = {
  "Strong GEO support": colors.green,
  "Moderate GEO support": colors.amber,
  "Limited GEO support": colors.red,
  "Not Found": colors.gray
};

function geoSupportColor(level) {
  return geoSupportColors[level] || colors.gray;
}

const detailTabs = new Set(["qc", "deg", "mapping", "network", "ml"]);
const navigableTabs = new Set(["overview", "pipeline", "ranking", "geo", "ai"]);
detailTabs.forEach((tab) => navigableTabs.add(tab));
const overviewCards = [
  { label: "Samples after QC", match: "GDC samples after QC", unit: "samples", icon: "scan-search", note: "Sample GDC/TCGA-LUAD còn lại sau quality control." },
  { label: "DEGs", match: "Differentially expressed genes", unit: "genes", icon: "chart-scatter", note: "Gene khác biệt expression giữa Tumor và Normal." },
  { label: "Mapped proteins", match: "DEG mapped to proteins", unit: "genes", icon: "git-compare-arrows", note: "DEG map được sang STRING protein_id." },
  { label: "STRING edges", match: "PPI edges in top-target graph", unit: "edges", icon: "share-2", note: "Cạnh PPI trong top-target graph với edge_weight >= 0.4." },
  { label: "Top candidates", match: "Top candidate targets", unit: "targets", icon: "trophy", note: "Candidate target cuối cùng từ mart enriched." },
  { label: "GEO-supported targets", match: "Candidates with GEO support", unit: "targets", icon: "database-zap", note: "Target có support trong GEO tumor-only cohort." }
];
const targetFeatureDefinitions = [
  { display: "Số kết nối", raw: "degree", meaning: "Biến degree: số protein mà protein trung tâm tương tác trực tiếp." },
  { display: "Tổng trọng số kết nối", raw: "weighted_degree", meaning: "Biến weighted_degree: tổng độ tin cậy của tất cả cạnh STRING nối tới protein." },
  { display: "Độ tin cậy trung bình", raw: "avg_combined_score", meaning: "Biến avg_combined_score: trung bình điểm STRING combined_score của các cạnh liên quan protein." },
  { display: "Độ tin cậy cao nhất", raw: "max_combined_score", meaning: "Biến max_combined_score: điểm STRING combined_score cao nhất trong các cạnh của protein." },
  { display: "Số kết nối tin cậy cao", raw: "num_high_confidence_edges", meaning: "Biến num_high_confidence_edges: số cạnh có combined_score >= 0.7, tức nhóm tương tác tin cậy cao." }
];
const pipelineSlides = [
  {
    step: "Bước 1",
    title: "NiFi Ingestion",
    subtitle: "Đưa GDC, GEO và STRING vào raw HDFS",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><path d="M12 18h14v14H12zM38 10h14v14H38zM38 40h14v14H38z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M26 25h8c4 0 4-8 8-8M26 25h8c4 0 4 22 8 22" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
    technologies: ["Apache NiFi", "GDC Portal", "NCBI GEO", "STRING", "HDFS"],
    description: "NiFi chịu trách nhiệm tải dữ liệu raw và ghi vào HDFS trước khi bất kỳ bước phân tích nào chạy.",
    details: [
      { title: "Nguồn GDC", text: "Dữ liệu TCGA-LUAD từ GDC là nguồn chính cho biểu hiện gene và nhãn Tumor/Normal. NiFi đọc manifest, tải file và giữ metadata ingest để biết file nào đến từ đâu." },
      { title: "Nguồn GEO và STRING", text: "GEO bổ sung cohort hỗ trợ bên ngoài; STRING cung cấp aliases, protein nodes và cạnh PPI. Các nguồn này đi cùng pipeline để downstream có thể mapping và kiểm chứng candidate." },
      { title: "Kiểm soát luồng tải", text: "InvokeHTTP tải file, RouteOnAttribute kiểm tra HTTP status, UpdateAttribute gắn metadata ingest, PutHDFS ghi xuống HDFS. File lỗi đi theo nhánh lỗi riêng để audit." },
      { title: "Raw HDFS", text: "Raw layer được xem là bất biến: không rename, không lọc, không sửa nội dung. Mọi cleaning và analysis đọc từ raw/refined để pipeline có thể replay." }
    ],
    metrics: [
      { label: "GDC trước xử lý", match: "GDC samples before QC" },
      { label: "Nguồn ingest", fallback: "GDC, GEO, STRING" },
      { label: "Định dạng downstream", fallback: "Parquet" }
    ],
    why: "NiFi phù hợp cho ingest vì bước này cần retry, route lỗi và audit trạng thái tải file. Tách ingest khỏi analysis giúp dữ liệu gốc không bị thay đổi khi logic phân tích được cải tiến."
  },
  {
    step: "Bước 2",
    title: "Cleaning & Refined Data",
    subtitle: "Chuẩn hóa dữ liệu trước khi phân tích",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><path d="M14 14h34v38H14z" fill="none" stroke="currentColor" stroke-width="4"/><path d="M22 24h18M22 34h18M22 44h12M46 16l8 8" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`,
    technologies: ["PySpark", "HDFS", "Parquet", "Hive", "QC reports"],
    description: "Cleaning chuyển raw data thành refined Parquet có schema rõ ràng, ID thống nhất và có thể join giữa GDC, GEO, STRING.",
    details: [
      { title: "Chuẩn hóa schema", text: "Tên cột được đưa về snake_case; sample_id, case_id, gene_id, gene_name và source được chuẩn hóa để các notebook downstream không phải đoán tên trường." },
      { title: "Chuẩn hóa missing/null", text: "Các giá trị như NA, Unknown, not available được quy về null trong Parquet. Điều này giúp Spark SQL xử lý missing nhất quán thay vì coi chuỗi rác là dữ liệu thật." },
      { title: "Expression gene-level", text: "Expression được đưa về dạng gene-level, tránh duplicate key ngoài ý muốn và không trộn đơn vị expression nếu chưa có cột expression_unit." },
      { title: "QC output", text: "Cleaning tạo QC report cho sample, gene, missingness và batch. Các report này là bằng chứng vì sao một dòng dữ liệu được giữ hoặc loại." }
    ],
    metrics: [
      { label: "GDC trước QC", match: "GDC samples before QC" },
      { label: "GDC sau QC", match: "GDC samples after QC" },
      { label: "Refined format", fallback: "Parquet" }
    ],
    why: "Cleaning được đặt trước DE/DA để mọi bước sau đọc cùng một schema ổn định. Nếu không làm sạch ở tầng refined, lỗi nhỏ như khác tên gene hoặc missing value dạng chuỗi có thể lan sang mapping, scoring và ML."
  },
  {
    step: "Bước 3",
    title: "GDC QC",
    subtitle: "Giữ sample đủ chất lượng trước Tumor vs Normal",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><path d="M12 50h44" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M18 42V28M32 42V16M46 42V24" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M20 18l8 8 16-16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    technologies: ["Hive", "PySpark", "Spark SQL", "HDFS", "Parquet"],
    description: "Phase QC đọc refined GDC, loại sample outlier và tạo expression protein-coding đã sẵn sàng cho DE.",
    details: [
      { title: "Đọc dữ liệu QC", text: "Notebook ưu tiên Hive table gdc.quality_check và gdc.gdc_counts_clean_protein_coding; nếu Hive table chưa có thì fallback sang Parquet refined trên HDFS." },
      { title: "Loại sample outlier", text: "Sample bị loại nếu có outlier về library size hoặc số gene phát hiện được. Đây là hai tín hiệu thường phản ánh sample quá ít dữ liệu hoặc profile expression bất thường." },
      { title: "Giữ protein-coding", text: "Pipeline chỉ giữ protein-coding expression vì downstream cần map gene sang protein target và STRING PPI." },
      { title: "Chuẩn hóa thang expression", text: "TPM được chuyển sang log2 TPM để giảm ảnh hưởng của giá trị expression quá lớn và làm so sánh Tumor/Normal ổn định hơn.", code: "log2_tpm = log2(tpm + 1)" }
    ],
    metrics: [
      { label: "Tumor sau QC", match: "Tumor samples" },
      { label: "Normal sau QC", match: "Normal samples" },
      { label: "GDC sau QC", match: "GDC samples after QC" }
    ],
    why: "QC là lớp bảo vệ cho thống kê DE: nếu sample lỗi đi vào so sánh Tumor/Normal, log2FC và p-value có thể phản ánh lỗi kỹ thuật thay vì khác biệt sinh học."
  },
  {
    step: "Bước 4",
    title: "Differential Expression",
    subtitle: "Tìm gene khác biệt giữa Tumor và Normal",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><path d="M10 50h44" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M18 46V30M32 46V14M46 46V24" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><circle cx="18" cy="24" r="5" fill="currentColor"/><circle cx="32" cy="10" r="5" fill="currentColor"/><circle cx="46" cy="18" r="5" fill="currentColor"/></svg>`,
    technologies: ["PySpark", "Spark SQL", "HDFS", "Parquet", "Welch-style statistics"],
    description: "DE tính mức độ khác biệt expression theo từng gene sau khi sample đã pass QC.",
    details: [
      { title: "Tách nhóm Tumor/Normal", text: "sample_group được normalize thành Tumor hoặc Normal. Gene chỉ được so sánh khi có dữ liệu ở cả hai nhóm." },
      { title: "Tính trung bình và phương sai", text: "PySpark groupBy gene để tính mean_log2_tpm và variance theo từng nhóm, sau đó pivot về cùng một dòng Tumor/Normal." },
      { title: "Tính log2FC và p-value", text: "log2FC là chênh lệch mean_log2_tpm giữa Tumor và Normal. p-value được tính bằng Welch-style t-stat để xử lý hai nhóm có phương sai/kích thước khác nhau." },
      { title: "Ngưỡng significant", text: "Một gene được xem là DEG khi vừa đủ lớn về hiệu ứng expression vừa đủ mạnh về thống kê.", code: "|log2FC| >= 1 và p < 0.05" }
    ],
    metrics: [
      { label: "Tumor", match: "Tumor samples" },
      { label: "Normal", match: "Normal samples" },
      { label: "Gene DEG", match: "Differentially expressed genes" }
    ],
    why: "DE là cầu nối từ dữ liệu expression sang danh sách gene ưu tiên. Dùng cả effect size và p-value giúp tránh chọn gene chỉ khác biệt rất nhỏ nhưng có p-value thấp do số mẫu lớn."
  },
  {
    step: "Bước 5",
    title: "DA - Gene to Protein Mapping",
    subtitle: "Chuyển gene significant sang protein ứng viên",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><path d="M14 18h18M14 32h18M14 46h18M42 18h10M42 32h10M42 46h10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M32 18h10M32 32h10M32 46h10" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/></svg>`,
    technologies: ["PySpark", "Hive", "STRING.gene_map", "HDFS", "Parquet"],
    description: "DA chỉ giữ gene significant từ DE, chuẩn hóa tên gene và map sang STRING protein để chuẩn bị phân tích PPI.",
    details: [
      { title: "Chuẩn hóa tên gene", text: "Tên gene được trim và uppercase trước khi join. Bước này giảm lỗi do khoảng trắng, chữ hoa/thường hoặc alias không đồng nhất giữa GDC và STRING." },
      { title: "Đọc STRING gene_map", text: "Pipeline ưu tiên Hive table STRING.gene_map; nếu Hive table chưa đăng ký thì fallback sang Parquet refined trên HDFS." },
      { title: "Giữ mapping có protein_id", text: "Mapping hợp lệ cần protein_id, ensp_id và gene_confidence. protein_id là khóa chính để nối sang STRING edges/nodes." },
      { title: "Audit gene không map", text: "Gene không nối được sang STRING protein vẫn được ghi audit, giúp biết expression hit nào bị loại trước PPI và scoring." }
    ],
    metrics: [
      { label: "Gene DEG", match: "Differentially expressed genes" },
      { label: "DEG map protein", match: "DEG mapped to proteins" },
      { label: "Protein candidates", match: "Protein candidates" }
    ],
    why: "Drug target thực tế là protein hoặc sản phẩm protein. Mapping làm rõ gene nào có protein tương ứng trong STRING, đồng thời giữ audit để không biến mất dữ liệu một cách im lặng."
  },
  {
    step: "Bước 6",
    title: "DA - PPI Network & Target Score",
    subtitle: "Tính bối cảnh mạng và điểm mục tiêu",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><circle cx="16" cy="18" r="7" fill="currentColor"/><circle cx="48" cy="16" r="7" fill="currentColor"/><circle cx="22" cy="48" r="7" fill="currentColor"/><circle cx="48" cy="44" r="7" fill="currentColor"/><path d="M22 20l20-3M18 25l4 23M27 45l15-3M47 23v14M22 23l22 20" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.55"/></svg>`,
    technologies: ["PySpark", "STRING edges/nodes", "Network features", "Min-max normalization", "Target scoring"],
    description: "Protein ứng viên được đặt vào mạng PPI để tính feature mạng, sau đó kết hợp với tín hiệu DE và độ tin cậy STRING thành Target Score.",
    details: [
      { title: "Lọc cạnh PPI", text: "PySpark lọc STRING edges liên quan protein ứng viên. Cạnh được giữ khi edge_weight_protein >= 0.4; cạnh tin cậy cao dùng ngưỡng 0.7." },
      { title: "Tính feature mạng", text: "Các feature mạng được tính theo từng protein trung tâm, rồi nối với nodes_protein để bổ sung degree và weighted degree đã có trong refined STRING." },
      { title: "Biến mạng dễ đọc", text: "Tên hiển thị bên dưới thay cho biến thô, tooltip vẫn giữ tên biến gốc để dễ trace về notebook.", variables: targetFeatureDefinitions },
      { title: "Chuẩn bị scoring", text: "Các feature expression, centrality và confidence được chuẩn hóa trước khi cộng trọng số để không biến nào áp đảo chỉ vì khác đơn vị đo." }
    ],
    metrics: [
      { label: "Protein candidates", match: "Protein candidates" },
      { label: "PPI edges", match: "PPI edges in top-target graph" },
      { label: "DEG map protein", match: "DEG mapped to proteins" }
    ],
    score: {
      formula: "TargetScore = w1 * DE_norm + w2 * Centrality_norm + w3 * Confidence_norm",
      components: [
        { term: "DE_norm", source: "|log2FC| chuẩn hóa về 0-1", definition: "DE_norm là chỉ số biểu hiện sai khác: lấy độ lớn tuyệt đối của log2FC giữa Tumor và Normal rồi chuẩn hóa về thang 0-1.", reason: "Biến này giúp ưu tiên gene có mức thay đổi expression mạnh, tức tín hiệu sinh học rõ hơn để cân nhắc làm target.", normalize: "Chuẩn hóa riêng DE_norm để biên độ log2FC lớn không tự động lấn át bằng chứng mạng và độ tin cậy STRING." },
        { term: "Centrality_norm", source: "weighted_degree chuẩn hóa về 0-1", definition: "Centrality_norm là chỉ số trung tâm mạng: dùng weighted_degree, tức tổng trọng số các cạnh PPI nối tới protein, rồi chuẩn hóa về 0-1.", reason: "Biến này phản ánh protein có nằm ở vị trí ảnh hưởng rộng trong mạng PPI hay không.", normalize: "Chuẩn hóa riêng Centrality_norm vì weighted_degree khác đơn vị hoàn toàn với expression." },
        { term: "Confidence_norm", source: "avg_combined_score chuẩn hóa về 0-1", definition: "Confidence_norm là chỉ số độ tin cậy STRING: dùng avg_combined_score, tức điểm tin cậy trung bình của các tương tác STRING quanh protein, rồi chuẩn hóa về 0-1.", reason: "Biến này giúp ưu tiên target có bằng chứng tương tác đáng tin, thay vì chỉ có nhiều cạnh yếu.", normalize: "Chuẩn hóa riêng Confidence_norm để điểm STRING 0-1000 có thể cộng công bằng với DE và centrality." }
      ]
    },
    why: "Slide này tách rõ hai việc: PPI network cho biết protein nằm ở đâu trong mạng, còn Target Score gom nhiều bằng chứng đã chuẩn hóa. Cách này tránh xếp hạng chỉ dựa vào expression hoặc chỉ dựa vào độ trung tâm mạng."
  },
  {
    step: "Bước 7",
    title: "Candidate Ranking & GEO Support",
    subtitle: "Xếp hạng candidate và đối chiếu cohort ngoài",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><path d="M14 48h36M20 42V22M32 42V14M44 42V30" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M14 16h8M14 24h8M42 12h10M42 20h10" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity="0.65"/></svg>`,
    technologies: ["PySpark", "HDFS", "Parquet", "GEO support metrics", "Dashboard mart"],
    description: "Ranking tạo danh sách target ưu tiên, còn GEO support cung cấp bằng chứng bổ sung từ cohort tumor-only bên ngoài.",
    details: [
      { title: "Weighted candidate ranking", text: "Final score kết hợp expression_score, protein_network_score và string_confidence_score theo trọng số Phase 5 đã chốt.", code: "0.5 expression + 0.3 network + 0.2 STRING confidence" },
      { title: "Top candidate mart", text: "Các candidate được sắp theo final_score giảm dần và ghi vào mart để dashboard đọc nhanh thay vì tính lại toàn bộ pipeline." },
      { title: "GEO support", text: "GEO hiện là tumor-only cohort, nên support được hiểu là coverage và percentile expression trong cohort, không phải validation Tumor vs Normal." },
      { title: "Không đổi ranking bằng GEO", text: "GEO support được trình bày như bằng chứng phụ. Ranking chính vẫn đến từ GDC + STRING để tránh trộn mục tiêu scoring với cohort hỗ trợ." }
    ],
    metrics: [
      { label: "Top candidate", match: "Top candidate targets" },
      { label: "Có GEO support", match: "Candidates with GEO support" },
      { label: "Protein candidates", match: "Protein candidates" }
    ],
    why: "Ranking cần ổn định và trace được về dữ liệu GDC + STRING. GEO được giữ riêng để người dùng thấy candidate nào có hỗ trợ ngoài, nhưng không làm thay đổi thứ hạng gốc."
  },
  {
    step: "Bước 8",
    title: "Machine Learning",
    subtitle: "KMeans phân nhóm candidate, không tạo ranking",
    icon: `<svg viewBox="0 0 64 64" focusable="false"><circle cx="18" cy="18" r="6" fill="currentColor"/><circle cx="30" cy="22" r="6" fill="currentColor"/><circle cx="22" cy="34" r="6" fill="currentColor"/><circle cx="46" cy="18" r="6" fill="currentColor" opacity="0.65"/><circle cx="48" cy="36" r="6" fill="currentColor" opacity="0.65"/><circle cx="36" cy="46" r="6" fill="currentColor" opacity="0.65"/><path d="M18 18l12 4M30 22l-8 12M46 18l2 18M48 36L36 46" stroke="currentColor" stroke-width="3" opacity="0.45"/></svg>`,
    technologies: ["Spark ML", "KMeans", "VectorAssembler", "StandardScaler", "Silhouette score"],
    description: "ML dùng các feature expression/network/STRING để phân cụm candidate thành nhóm có pattern giống nhau.",
    details: [
      { title: "Feature dùng cho ML", text: "ML dùng abs_log2FC, log_weighted_degree, avg_combined_score và log_num_interactions. final_score không được đưa vào feature ML vì nó đã là kết quả scoring." },
      { title: "Scale feature", text: "StandardScaler đưa các feature về thang tương đương trước KMeans, tránh feature có đơn vị lớn quyết định toàn bộ cluster." },
      { title: "Chọn k", text: "Pipeline thử nhiều giá trị k và dùng silhouette score để chọn cấu hình có mức tách nhóm tốt hơn." },
      { title: "Diễn giải cluster", text: "Mỗi candidate nhận cluster_id và candidate_group để dashboard giải thích nhóm như high expression + high network, thay vì thay thế ranking." }
    ],
    metrics: [
      { label: "ML clusters", match: "ML clusters" },
      { label: "Top candidate", match: "Top candidate targets" },
      { label: "Protein candidates", match: "Protein candidates" }
    ],
    why: "ML ở đây phục vụ diễn giải pattern downstream: các cluster giúp nhìn nhóm candidate giống nhau, còn quyết định ưu tiên vẫn dựa trên ranking có trọng số và có thể trace."
  }
];
const help = {
  rank: "Rank from Phase 5 candidate scoring. Lower rank means higher priority in this pipeline.",
  gene_name: "Gene symbol associated with the candidate protein.",
  protein_id: "STRING protein identifier used by Phase 3-5 mapping and PPI joins.",
  ensp_id: "Ensembl protein ID extracted from STRING protein_id.",
  log2FC: "log2 fold change from Phase 2. Positive means higher mean expression in tumor; negative means lower in tumor.",
  p_value: "Phase 2 p-value from the project output. The current Phase 2 mart does not contain adjusted_p_value, so this dashboard does not relabel it as adjusted.",
  deg_direction: "Direction assigned by Phase 2 from log2FC sign.",
  gene_confidence: "Mapping confidence from refined STRING gene_map used in Phase 3.",
  weighted_degree_protein: "STRING network weighted degree for this protein from Phase 4.",
  avg_combined_score: "Average STRING combined_score_protein over candidate interactions. STRING combined_score uses a 0-1000 scale.",
  edge_weight_protein: "STRING combined_score_protein divided by 1000. 0.4 is medium confidence; 0.7 is high confidence.",
  final_score: "Phase 5 weighted candidate score combining expression, protein-network score and STRING confidence score.",
  geo_match_status: "Whether the candidate gene matched an expression row in the tumor-only GEO cohort.",
  geo_coverage_rate: "Fraction of GEO tumor-cohort samples with usable expression for this candidate gene.",
  geo_mean_expression: "Mean GEO expression across matched tumor-cohort samples.",
  geo_median_expression: "Median GEO expression across matched tumor-cohort samples.",
  geo_mean_percentile: "Average within-sample expression percentile among top candidate genes in GEO.",
  geo_top_quartile_rate: "Fraction of GEO tumor-cohort samples where the candidate is in the top expression quartile among candidates.",
  geo_support_score: "Phase 6 tumor-only GEO support score: 0.2 coverage + 0.5 mean percentile + 0.3 top-quartile rate.",
  geo_support_level: "Support bucket derived from geo_support_score; Not Found has no score.",
  match_status: "Whether the candidate gene matched an expression row in the tumor-only GEO cohort.",
  coverage_rate: "Fraction of GEO tumor-cohort samples with usable expression for this candidate gene.",
  mean_expression: "Mean GEO expression across matched tumor-cohort samples.",
  median_expression: "Median GEO expression across matched tumor-cohort samples.",
  mean_percentile: "Average within-sample expression percentile among top candidate genes in GEO.",
  top_quartile_rate: "Fraction of GEO tumor-cohort samples where the candidate is in the top expression quartile among candidates.",
  support_score: "Phase 6 tumor-only GEO support score: 0.2 coverage + 0.5 mean percentile + 0.3 top-quartile rate.",
  support_level: "Support bucket derived from the GEO support score; Not Found has no score.",
  cluster_id: "KMeans cluster ID from Phase 7.",
  candidate_group: "Cluster interpretation label from Phase 7.",
  mapping_status: "Whether this DEG gene was mapped to a STRING protein_id in Phase 3.",
  mapping_reason: "Why the gene is present in the unmapped audit. In this mart, rows have no matching STRING protein_id in refined STRING gene_map.",
  geo_match_reason: "Reason a candidate is absent from the GEO tumor-cohort support result."
};

function $(selector) { return document.querySelector(selector); }

const tabLabels = {
  overview: "Tổng quan",
  pipeline: "Pipeline Flow",
  qc: "Phase 1 / Quality Control",
  deg: "Phase 2 / Differential Expression",
  mapping: "Phase 3 / Gene-Protein Mapping",
  network: "Phase 4 / PPI Network",
  ranking: "Xếp hạng candidate",
  geo: "Hỗ trợ GEO",
  ml: "Phase 7 / ML Clustering",
  ai: "AI Assistant"
};

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}
function setDrawerOpen(open) {
  $("#target-drawer")?.classList.toggle("open", open);
  $("#drawer-backdrop")?.classList.toggle("open", open);
  document.body.classList.toggle("drawer-open", open);
}
function setPipelineSubnavCollapsed(collapsed) {
  document.body.classList.toggle("pipeline-subnav-collapsed", collapsed);
  const pipelineButton = $('.nav-btn[data-tab="pipeline"]');
  if (pipelineButton?.classList.contains("active")) {
    pipelineButton.setAttribute("aria-expanded", String(!collapsed));
  }
}
function syncNavigationUi(tab) {
  document.body.dataset.activeTab = tab;
  const breadcrumb = $("#active-breadcrumb");
  if (breadcrumb) breadcrumb.textContent = tabLabels[tab] || tab;
  const pipelineActive = tab === "pipeline" || detailTabs.has(tab);
  if (!pipelineActive) setPipelineSubnavCollapsed(false);
  const pipelineButton = $('.nav-btn[data-tab="pipeline"]');
  pipelineButton?.setAttribute("aria-expanded", String(pipelineActive && !document.body.classList.contains("pipeline-subnav-collapsed")));
  document.querySelectorAll(".pipeline-subnav [data-analysis-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.analysisTab === tab);
  });
}
function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const toggle = $("#sidebar-toggle");
  if (!toggle) return;
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute("aria-label", collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar");
  const icon = toggle.querySelector("[data-lucide]");
  if (icon) icon.setAttribute("data-lucide", collapsed ? "panel-left-open" : "panel-left-close");
  refreshIcons();
}
function animateStatCounts() {
  const counters = document.querySelectorAll(".overview-stat-card strong[data-count-value]");
  counters.forEach((counter) => {
    const value = Number(counter.dataset.countValue);
    if (!Number.isFinite(value)) return;
    if (overviewHasAnimated || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      counter.textContent = fmt(value);
      return;
    }
    const start = performance.now();
    const duration = 900;
    const frame = (now) => {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      counter.textContent = fmt(value * eased);
      if (progress < 1) requestAnimationFrame(frame);
      else counter.textContent = fmt(value);
    };
    requestAnimationFrame(frame);
  });
  overviewHasAnimated = true;
}
function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function exportCurrentCandidates() {
  const rows = state.data.targets?.items || [];
  if (!rows.length) return;
  const currentSort = state.tableSort.candidate;
  const exportRows = currentSort ? sortRows(rows, currentSort.key, currentSort.dir) : rows;
  const columns = Object.keys(exportRows[0]);
  const csv = [columns.map(csvCell).join(","), ...exportRows.map((row) => columns.map((key) => csvCell(row[key])).join(","))].join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `luad-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function fmt(value) {
  if (value === null || value === undefined) return "NA";
  if (typeof value === "number") {
    if (Math.abs(value) < 0.001 && value !== 0) return value.toExponential(2);
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  }
  return String(value);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
function resetVolcanoView() {
  state.volcanoView = { centerX: 0, minY: 0 };
}
function resetNetworkView() {
  state.networkView = { panX: 0, panY: 0 };
}
function resetMlView() {
  state.mlView = { centerX: 0, centerY: 0 };
}
function checkedValues(selector) {
  return new Set([...document.querySelectorAll(selector)].filter((input) => input.checked).map((input) => input.value));
}
function volcanoGroup(row) {
  if (row.is_top_candidate) return "top";
  if (!row.is_deg) return "not";
  return row.deg_direction === "Upregulated" ? "up" : "down";
}
function filteredVolcanoRows(rows) {
  const selected = checkedValues(".volcano-color-filter");
  const topOnly = $("#volcano-top-only")?.checked;
  return (rows || []).filter((row) => {
    const group = volcanoGroup(row);
    if (!selected.has(group)) return false;
    return !topOnly || group === "top";
  });
}
function drawableVolcanoRows(rows) {
  return (rows || []).filter((row) => (
    row.p_value !== null
    && row.p_value !== undefined
    && Number.isFinite(Number(row.p_value))
    && Number.isFinite(Number(row.log2FC))
    && Number.isFinite(Number(row.plot_minus_log10_p_value))
  ));
}
function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

function ensureTooltip() {
  let tip = $("#chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "chart-tooltip";
    tip.className = "tooltip";
    document.body.appendChild(tip);
  }
  return tip;
}
let tooltipTimer = null;
function showTooltip(html, x, y, delay = 650) {
  clearTimeout(tooltipTimer);
  const tip = ensureTooltip();
  tooltipTimer = setTimeout(() => {
    tip.innerHTML = html;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.classList.add("visible");
  }, delay);
}
function hideTooltip() {
  clearTimeout(tooltipTimer);
  const tip = ensureTooltip();
  tip.classList.remove("visible");
}
function registerHits(canvas, hits) {
  state.hits[canvas.id] = hits;
}
function bindCanvasTooltip(canvas) {
  canvas.addEventListener("mousemove", (event) => {
    if (state.drag) {
      hideTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (canvas.id === "network-chart") {
      const node = state.networkHit.find((item) => Math.hypot(item.x - x, item.y - y) <= item.hitRadius + 4);
      const nextHoveredId = node?.protein_id || null;
      if (nextHoveredId !== hoveredNetworkProteinId) {
        hoveredNetworkProteinId = nextHoveredId;
        if (state.data.network) drawNetwork(canvas, state.data.network);
      }
    }
    const hit = (state.hits[canvas.id] || []).find((item) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
    if (hit) showTooltip(hit.html, event.clientX, event.clientY);
    else hideTooltip();
  });
  canvas.addEventListener("mouseleave", () => {
    hideTooltip();
    if (canvas.id === "network-chart" && hoveredNetworkProteinId) {
      hoveredNetworkProteinId = null;
      if (state.data.network) drawNetwork(canvas, state.data.network);
    }
  });
}

function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(260, Math.floor(rect.width * scale));
  canvas.height = Math.max(220, Math.floor(rect.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = colors.ink;
  return { ctx, width: rect.width, height: rect.height };
}
function setMeta(canvas, html) {
  const block = canvas.closest(".panel-block");
  if (!block) return;
  let meta = block.querySelector(".auto-meta");
  if (!meta) {
    meta = document.createElement("div");
    meta.className = "chart-meta auto-meta";
    block.appendChild(meta);
  }
  meta.innerHTML = html;
}
function legend(items) {
  return `<div class="chart-legend">${items.map((item) => `<span class="legend-item"><span class="legend-swatch" style="background:${item.color}"></span>${item.label}</span>`).join("")}</div>`;
}
function colorScaleLegend(min, max, label) {
  return `<div class="color-scale-wrap"><div class="color-scale-label">${esc(label)}</div><div class="color-scale"><span>${fmt(min)}</span><i></i><span>${fmt(max)}</span></div></div>`;
}
function overlaps(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}
function drawAdaptiveLabels(ctx, points, options = {}) {
  const maxLabels = options.maxLabels ?? 24;
  const candidates = points
    .filter((point) => !options.labelEligible || options.labelEligible(point.row, point))
    .sort((a, b) => {
      const ar = Number(a.row.rank || 999999);
      const br = Number(b.row.rank || 999999);
      if (ar !== br) return ar - br;
      return Math.abs(Number(b.row.log2FC || b.row.abs_log2FC || 0)) - Math.abs(Number(a.row.log2FC || a.row.abs_log2FC || 0));
    });
  const boxes = [];
  ctx.save();
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.fillStyle = colors.ink;
  for (const point of candidates) {
    if (boxes.length >= maxLabels) break;
    const label = options.labelText ? options.labelText(point.row) : (point.row.gene_name || point.row.protein_id || "");
    if (!label) continue;
    const textW = ctx.measureText(label).width;
    const box = { x: point.x + point.radius + 5, y: point.y - 13, w: textW + 4, h: 14 };
    if (box.x + box.w > point.bounds.right) box.x = point.x - point.radius - textW - 7;
    if (box.y < point.bounds.top) box.y = point.y + point.radius + 4;
    if (box.x < point.bounds.left || box.y + box.h > point.bounds.bottom) continue;
    if (boxes.some((existing) => overlaps(box, existing))) continue;
    ctx.fillText(label, box.x + 2, box.y + 11);
    boxes.push(box);
  }
  ctx.restore();
}
function drawAxes(ctx, pad, width, height, xTicks = [], yTicks = []) {
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + height);
  ctx.lineTo(pad.left + width, pad.top + height);
  ctx.stroke();
  ctx.fillStyle = "#7f958d";
  ctx.textAlign = "center";
  xTicks.forEach((tick) => {
    ctx.beginPath();
    ctx.moveTo(tick.x, pad.top + height);
    ctx.lineTo(tick.x, pad.top + height + 4);
    ctx.stroke();
    ctx.fillText(tick.label, tick.x, pad.top + height + 18);
  });
  ctx.textAlign = "right";
  yTicks.forEach((tick) => {
    ctx.beginPath();
    ctx.moveTo(pad.left - 4, tick.y);
    ctx.lineTo(pad.left, tick.y);
    ctx.stroke();
    ctx.fillText(tick.label, pad.left - 7, tick.y + 4);
  });
  ctx.textAlign = "left";
}
function niceTicks(min, max, count = 5) {
  const ticks = [];
  const span = max - min || 1;
  for (let i = 0; i <= count; i += 1) ticks.push(min + (span * i) / count);
  return ticks;
}

function drawGroupedBars(canvas, rows, labelKey, series, meta) {
  const { ctx, width, height } = canvasContext(canvas);
  const hits = [];
  const pad = { left: 58, right: 18, top: 24, bottom: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...rows.flatMap((row) => series.map((item) => Number(row[item.key]) || 0)), 1);
  drawAxes(ctx, pad, plotW, plotH, [], niceTicks(0, max, 4).map((v) => ({ y: pad.top + plotH - (v / max) * plotH, label: fmt(v) })));
  const groupW = plotW / Math.max(rows.length, 1);
  const barW = Math.min(34, groupW / (series.length + 1));
  rows.forEach((row, groupIndex) => {
    series.forEach((item, index) => {
      const value = Number(row[item.key]) || 0;
      const x = pad.left + groupIndex * groupW + groupW / 2 - (barW * series.length) / 2 + index * barW;
      const h = (value / max) * (plotH - 14);
      const y = pad.top + plotH - h;
      ctx.fillStyle = item.color;
      ctx.fillRect(x, y, barW - 4, h);
      hits.push({ x, y, w: barW, h: Math.max(h, 8), html: `<strong>${esc(row[labelKey])}</strong><small>${item.label}</small><br>${fmt(value)} samples` });
    });
    ctx.fillStyle = colors.ink;
    ctx.textAlign = "center";
    ctx.fillText(row[labelKey], pad.left + groupIndex * groupW + groupW / 2, pad.top + plotH + 34);
  });
  ctx.textAlign = "left";
  registerHits(canvas, hits);
  setMeta(canvas, `${legend(series)}<div class="axis-note">X: ${meta.x}. Y: ${meta.y}.</div>${meta.text || ""}`);
}

function drawVerticalBars(canvas, rows, labelKey, valueKey, options = {}) {
  const { ctx, width, height } = canvasContext(canvas);
  const hits = [];
  const pad = { left: 52, right: 20, top: 20, bottom: options.rotate ? 72 : 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 1);
  drawAxes(ctx, pad, plotW, plotH, [], niceTicks(0, max, 4).map((v) => ({ y: pad.top + plotH - (v / max) * plotH, label: fmt(v) })));
  const barW = plotW / Math.max(rows.length, 1);
  rows.forEach((row, index) => {
    const value = Number(row[valueKey]) || 0;
    const h = (value / max) * (plotH - 12);
    const x = pad.left + index * barW + barW * 0.18;
    const y = pad.top + plotH - h;
    const w = Math.max(8, barW * 0.58);
    ctx.fillStyle = options.color ? options.color(row, index) : clusterColors[index % clusterColors.length];
    ctx.fillRect(x, y, w, h);
    hits.push({ x, y, w, h: Math.max(h, 8), html: `<strong>${esc(row[labelKey])}</strong>${fmt(value)}` });
    ctx.fillStyle = colors.ink;
    if (options.rotate) {
      ctx.save();
      ctx.translate(x + 8, pad.top + plotH + 58);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(String(row[labelKey]).slice(0, 18), 0, 0);
      ctx.restore();
    } else {
      ctx.textAlign = "center";
      ctx.fillText(String(row[labelKey]).slice(0, 16), x + w / 2, pad.top + plotH + 22);
      ctx.textAlign = "left";
    }
  });
  registerHits(canvas, hits);
  if (options.meta) setMeta(canvas, options.meta);
}

function drawBar(canvas, rows, labelKey, valueKey, options = {}) {
  const { ctx, width, height } = canvasContext(canvas);
  const hits = [];
  const pad = { left: options.left || 132, right: 44, top: 22, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(...rows.map((row) => Math.abs(Number(row[valueKey]) || 0)), 1);
  drawAxes(ctx, pad, plotW, plotH, niceTicks(0, max, 4).map((v) => ({ x: pad.left + (v / max) * plotW, label: fmt(v) })), []);
  const rowH = plotH / Math.max(rows.length, 1);
  rows.forEach((row, index) => {
    const raw = Number(row[valueKey]) || 0;
    const y = pad.top + index * rowH + rowH * 0.2;
    const h = Math.max(6, rowH * 0.55);
    const w = (Math.abs(raw) / max) * (plotW - 10);
    ctx.fillStyle = options.color ? options.color(row, index) : clusterColors[index % clusterColors.length];
    ctx.fillRect(pad.left, y, w, h);
    hits.push({ x: pad.left, y, w: Math.max(w, 8), h, html: options.tooltip ? options.tooltip(row) : `<strong>${esc(row[labelKey])}</strong>${esc(valueKey)}: ${fmt(raw)}` });
    ctx.fillStyle = colors.ink;
    ctx.textAlign = "right";
    ctx.fillText(String(row[labelKey]).slice(0, 18), pad.left - 8, y + h * 0.72);
    ctx.textAlign = "left";
    ctx.fillText(fmt(raw), pad.left + w + 6, y + h * 0.72);
  });
  ctx.textAlign = "left";
  registerHits(canvas, hits);
  if (options.meta) setMeta(canvas, options.meta);
}

function drawDonut(canvas, rows, labelKey, valueKey, palette, meta) {
  const { ctx, width, height } = canvasContext(canvas);
  const total = rows.reduce((sum, row) => sum + Number(row[valueKey] || 0), 0) || 1;
  const cx = width * 0.34;
  const cy = height * 0.48;
  const radius = Math.min(width, height) * 0.27;
  let start = -Math.PI / 2;
  rows.forEach((row, index) => {
    const angle = (Number(row[valueKey]) / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = palette[index % palette.length];
    ctx.fill();
    start += angle;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = "#13221c";
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = colors.ink;
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(total, cx, cy + 7);
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  rows.forEach((row, index) => {
    const y = 44 + index * 28;
    ctx.fillStyle = palette[index % palette.length];
    ctx.fillRect(width * 0.60, y - 10, 10, 10);
    ctx.fillStyle = colors.ink;
    ctx.fillText(`${row[labelKey]}: ${fmt(row[valueKey])}`, width * 0.60 + 16, y);
  });
  registerHits(canvas, []);
  if (meta) setMeta(canvas, meta);
}

function drawScatter(canvas, rows, xKey, yKey, options = {}) {
  const { ctx, width, height } = canvasContext(canvas);
  const hits = [];
  const pad = options.pad || { left: 64, right: 24, top: 24, bottom: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xs = rows.map((row) => Number(row[xKey])).filter(Number.isFinite);
  const ys = rows.map((row) => Number(row[yKey])).filter(Number.isFinite);
  const minX = options.minX ?? Math.min(...xs, 0);
  const maxX = options.maxX ?? Math.max(...xs, 1);
  const minY = options.minY ?? Math.min(...ys, 0);
  const maxY = options.maxY ?? Math.max(...ys, 1);
  const sx = (value) => pad.left + ((value - minX) / Math.max(0.0001, maxX - minX)) * plotW;
  const sy = (value) => pad.top + plotH - ((value - minY) / Math.max(0.0001, maxY - minY)) * plotH;
  drawAxes(
    ctx,
    pad,
    plotW,
    plotH,
    niceTicks(minX, maxX, 6).map((v) => ({ x: sx(v), label: fmt(v) })),
    niceTicks(minY, maxY, 5).map((v) => ({ y: sy(v), label: fmt(v) }))
  );
  const visiblePoints = [];
  rows.forEach((row, index) => {
    const xv = Number(row[xKey]);
    const yv = Number(row[yKey]);
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || xv < minX || xv > maxX || yv < minY || yv > maxY) return;
    const x = sx(xv);
    const y = sy(yv);
    const radius = options.radius ? options.radius(row) : 4;
    const color = options.color ? options.color(row, index) : clusterColors[Math.abs(Number(row.cluster_id || 0)) % clusterColors.length];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = options.alpha || 0.78;
    ctx.fill();
    ctx.globalAlpha = 1;
    visiblePoints.push({ row, x, y, radius, bounds: { left: pad.left, right: pad.left + plotW, top: pad.top, bottom: pad.top + plotH } });
    hits.push({ x: x - radius - 3, y: y - radius - 3, w: radius * 2 + 6, h: radius * 2 + 6, html: options.tooltip ? options.tooltip(row) : `<strong>${esc(row.gene_name || row.protein_id)}</strong>${xKey}: ${fmt(row[xKey])}<br>${yKey}: ${fmt(row[yKey])}` });
  });
  if (options.adaptiveLabels && visiblePoints.length <= (options.labelDensityLimit || 70)) {
    const maxLabels = options.maxLabels ?? Math.max(8, Math.floor((plotW * plotH) / 9500));
    drawAdaptiveLabels(ctx, visiblePoints, { maxLabels, labelEligible: options.labelEligible, labelText: options.labelText });
  }
  ctx.fillStyle = "#7f958d";
  ctx.textAlign = "center";
  ctx.fillText(options.xLabel || xKey, pad.left + plotW / 2, height - 12);
  ctx.save();
  ctx.translate(14, pad.top + plotH / 2 + 42);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(options.yLabel || yKey, 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
  registerHits(canvas, hits);
  if (options.meta) setMeta(canvas, options.meta);
}

function volcanoViewport(rows) {
  const zoom = Number($("#volcano-zoom").value || 1);
  const xs = rows.map((row) => Math.abs(Number(row.log2FC))).filter(Number.isFinite);
  const ys = rows.map((row) => Number(row.plot_minus_log10_p_value)).filter(Number.isFinite);
  const maxAbsX = Math.max(...xs, 1) * 1.05;
  const maxY = Math.max(4, Math.min(60, Math.max(...ys, 4))) * 1.04;
  const halfX = Math.max(0.08, maxAbsX / zoom);
  const spanY = Math.max(0.5, maxY / zoom);
  const maxCenterShift = Math.max(0, maxAbsX - halfX);
  state.volcanoView.centerX = clamp(state.volcanoView.centerX, -maxCenterShift, maxCenterShift);
  state.volcanoView.minY = clamp(state.volcanoView.minY, 0, Math.max(0, maxY - spanY));
  return {
    zoom,
    minX: state.volcanoView.centerX - halfX,
    maxX: state.volcanoView.centerX + halfX,
    minY: state.volcanoView.minY,
    maxY: state.volcanoView.minY + spanY,
    spanX: halfX * 2,
    spanY,
    total: maxY,
  };
}
function drawVolcano(canvas, rows) {
  const drawable = drawableVolcanoRows(rows);
  const filtered = filteredVolcanoRows(drawable);
  const view = volcanoViewport(drawable);
  const visibleEstimate = filtered.filter((row) => {
    const x = Number(row.log2FC);
    const y = Number(row.plot_minus_log10_p_value);
    return Number.isFinite(x) && Number.isFinite(y) && x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;
  }).length;
  $("#volcano-zoom-value").textContent = `${view.zoom.toFixed(1).replace(".0", "")}x`;
  drawScatter(canvas, filtered, "log2FC", "plot_minus_log10_p_value", {
    xLabel: "log2FC (tumor vs normal)",
    yLabel: "-log10(p_value), capped",
    radius: (row) => row.is_top_candidate ? 4.5 : 2.4,
    alpha: 0.66,
    adaptiveLabels: true,
    labelDensityLimit: 55,
    maxLabels: $("#volcano-top-only")?.checked ? 28 : 18,
    labelEligible: (row) => $("#volcano-top-only")?.checked || row.is_top_candidate || visibleEstimate <= 30,
    minX: view.minX,
    maxX: view.maxX,
    minY: view.minY,
    maxY: view.maxY,
    color: (row) => {
      const group = volcanoGroup(row);
      if (group === "top") return colors.amber;
      if (group === "not") return colors.gray;
      return group === "up" ? colors.red : colors.blue;
    },
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.gene_id_base)}</small><br>log2FC: ${fmt(row.log2FC)}<br>p_value: ${fmt(row.p_value)}<br>-log10(p): ${fmt(row.minus_log10_p_value)}<br>Rank: ${fmt(row.rank)}<br>Status: ${row.is_deg ? esc(row.deg_direction) : "Not significant"}`,
    meta: `${legend([{ label: "Top candidate", color: colors.amber }, { label: "Upregulated DEG", color: colors.red }, { label: "Downregulated DEG", color: colors.blue }, { label: "Not significant", color: colors.gray }])}<div class="axis-note">Showing ${fmt(filtered.length)} genes; ${fmt(visibleEstimate)} are inside the current view. Top N only narrows the plot to candidate genes ranked within Top N. Larger amber points are highlighted top candidates; other points use a fixed smaller radius, so size is not another expression metric. Wheel or pinch to zoom; drag to pan.</div>`
  });
}
function redrawVolcano() {
  if (state.data.volcano?.items) drawVolcano($("#volcano-chart"), state.data.volcano.items);
}

function drawHistogram(canvas, rows, valueKey, meta) {
  const mapped = rows.map((row) => ({ label: `${fmt(row.bin_start)}-${fmt(row.bin_end)}`, value: row[valueKey], sample_group: row.sample_group }));
  drawVerticalBars(canvas, mapped, "label", "value", { rotate: true, color: (row) => row.sample_group === "tumor" ? colors.red : colors.blue, meta });
}

function drawLine(canvas, rows, xKey, yKey, meta) {
  const { ctx, width, height } = canvasContext(canvas);
  const hits = [];
  const pad = { left: 56, right: 24, top: 22, bottom: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xs = rows.map((row) => Number(row[xKey]));
  const ys = rows.map((row) => Number(row[yKey]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys) * 0.9;
  const maxY = Math.max(...ys) * 1.05;
  const sx = (value) => pad.left + ((value - minX) / (maxX - minX || 1)) * plotW;
  const sy = (value) => pad.top + plotH - ((value - minY) / (maxY - minY || 1)) * plotH;
  drawAxes(ctx, pad, plotW, plotH, xs.map((v) => ({ x: sx(v), label: `k=${v}` })), niceTicks(minY, maxY, 4).map((v) => ({ y: sy(v), label: fmt(v) })));
  ctx.strokeStyle = colors.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = sx(Number(row[xKey]));
    const y = sy(Number(row[yKey]));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  rows.forEach((row) => {
    const x = sx(Number(row[xKey]));
    const y = sy(Number(row[yKey]));
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = colors.green;
    ctx.fill();
    hits.push({ x: x - 8, y: y - 8, w: 16, h: 16, html: `<strong>k=${row[xKey]}</strong>Silhouette score: ${fmt(row[yKey])}` });
  });
  registerHits(canvas, hits);
  if (meta) setMeta(canvas, meta);
}

function heatColor(value, min, max) {
  const ratio = value === null || value === undefined ? 0.5 : (Number(value) - min) / Math.max(0.0001, max - min);
  const red = Math.round(220 * ratio + 35 * (1 - ratio));
  const blue = Math.round(210 * (1 - ratio) + 70 * ratio);
  const green = Math.round(94 + 80 * (1 - Math.abs(ratio - 0.5)));
  return `rgb(${red},${green},${blue})`;
}
function drawHeatmap(canvas, data) {
  const { ctx, width, height } = canvasContext(canvas);
  const genes = data.genes || [];
  const samples = data.samples || [];
  const matrix = data.matrix || [];
  const hits = [];
  const pad = { left: 92, right: 18, top: 24, bottom: 76 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const cellW = plotW / Math.max(samples.length, 1);
  const cellH = plotH / Math.max(genes.length, 1);
  const values = matrix.flat().filter((v) => typeof v === "number");
  const min = Math.min(...values);
  const max = Math.max(...values);
  matrix.forEach((row, i) => {
    row.forEach((value, j) => {
      const x = pad.left + j * cellW;
      const y = pad.top + i * cellH;
      ctx.fillStyle = heatColor(value, min, max);
      ctx.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH));
      hits.push({ x, y, w: cellW, h: cellH, html: `<strong>${esc(genes[i])}</strong><small>${esc(samples[j])} (${esc(data.sample_groups?.[j])})</small><br>${esc(data.value_label)}: ${fmt(value)}` });
    });
  });
  ctx.fillStyle = colors.ink;
  genes.forEach((gene, i) => ctx.fillText(gene, 8, pad.top + i * cellH + cellH * 0.72));
  const labelEvery = Math.max(1, Math.ceil(samples.length / 12));
  samples.forEach((sample, j) => {
    if (j % labelEvery === 0) {
      ctx.save();
      ctx.translate(pad.left + j * cellW + 4, pad.top + plotH + 58);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(`${sample.slice(0, 10)} ${data.sample_groups?.[j] || ""}`, 0, 0);
      ctx.restore();
    }
  });
  registerHits(canvas, hits);
  setMeta(canvas, `${colorScaleLegend(min, max, data.value_label || "log2 TPM")}<div class="axis-note">Rows: top DEG genes. Columns: selected QC-passed tumor and normal cases. Blue = lower ${esc(data.value_label || "value")}; red = higher ${esc(data.value_label || "value")}.</div>`);
}

function drawNetwork(canvas, payload) {
  const { ctx, width, height } = canvasContext(canvas);
  const nodes = payload.nodes || [];
  const edges = payload.edges || [];
  const zoom = Number($("#network-zoom").value || 1);
  const hits = [];
  const cx = width / 2 + state.networkView.panX;
  const cy = height / 2 + state.networkView.panY;
  const radiusBase = Math.min(width, height) * (0.26 + Math.min(zoom, 30) * 0.045);
  const byCluster = new Map();
  nodes.forEach((node) => {
    const key = Number(node.cluster_id || 0);
    if (!byCluster.has(key)) byCluster.set(key, []);
    byCluster.get(key).push(node);
  });
  const clusters = [...byCluster.keys()].sort((a, b) => a - b);
  const positioned = [];
  clusters.forEach((cluster, clusterIndex) => {
    const members = byCluster.get(cluster);
    const centerAngle = (clusterIndex / Math.max(clusters.length, 1)) * Math.PI * 2;
    members.forEach((node, index) => {
      const offset = (index - (members.length - 1) / 2) * 0.18;
      const r = radiusBase * (0.56 + (index % 5) * 0.085);
      positioned.push({ ...node, x: cx + Math.cos(centerAngle + offset) * r, y: cy + Math.sin(centerAngle + offset) * r, hitRadius: Math.max(7, node.node_size || 10) });
    });
  });
  const byId = Object.fromEntries(positioned.map((node) => [node.protein_id, node]));
  edges.forEach((edge) => {
    const src = byId[edge.protein_id_src];
    const dst = byId[edge.protein_id_dst];
    if (!src || !dst) return;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    const isConnected = hoveredNetworkProteinId && (src.protein_id === hoveredNetworkProteinId || dst.protein_id === hoveredNetworkProteinId);
    const edgeAlpha = hoveredNetworkProteinId
      ? (isConnected ? Math.max(0.62, (edge.edge_weight_protein || 0.4) * 0.9) : 0.07)
      : Math.max(0.18, (edge.edge_weight_protein || 0.4) * 0.64);
    ctx.strokeStyle = `rgba(56,189,248,${edgeAlpha})`;
    ctx.lineWidth = Math.max(isConnected ? 1.8 : 1, (edge.edge_weight_protein || 0.4) * (isConnected ? 5 : 3.4));
    ctx.stroke();
  });
  const labelPoints = [];
  positioned.forEach((node) => {
    const cluster = Number(node.cluster_id || 0);
    const clusterColor = clusterColors[Math.abs(cluster) % clusterColors.length];
    const isHovered = node.protein_id === hoveredNetworkProteinId;
    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = clusterColor;
    ctx.shadowColor = clusterColor;
    ctx.shadowBlur = isHovered ? 22 : 7;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = geoSupportColor(node.geo_support_level);
    ctx.lineWidth = isHovered ? 3.5 : 2.5;
    ctx.stroke();
    ctx.restore();
    labelPoints.push({ row: node, x: node.x, y: node.y, radius: node.hitRadius, bounds: { left: 8, right: width - 8, top: 8, bottom: height - 8 } });
    hits.push({ x: node.x - node.hitRadius, y: node.y - node.hitRadius, w: node.hitRadius * 2, h: node.hitRadius * 2, html: `<strong>${esc(node.gene_name)}</strong><small>${esc(node.protein_id)}</small><br>ENSP: ${esc(node.ensp_id)}<br>Rank: ${fmt(node.rank)}<br>log2FC: ${fmt(node.log2FC)}<br>Weighted degree: ${fmt(node.weighted_degree_protein)}<br>Avg STRING combined score: ${fmt(node.avg_combined_score)}<br>Final score: ${fmt(node.final_score)}<br>GEO support: ${esc(node.geo_support_level)}<br>Support score: ${fmt(node.geo_support_score)}<br>Coverage: ${fmt(node.geo_coverage_rate)}<br>Mean percentile: ${fmt(node.geo_mean_percentile)}<br>Cluster: ${fmt(node.cluster_id)}<br>Group: ${esc(node.candidate_group)}` });
  });
  if (zoom >= 2 || nodes.length <= 25) {
    drawAdaptiveLabels(ctx, labelPoints, {
      maxLabels: zoom < 4 ? 10 : zoom < 8 ? 18 : 32,
      labelEligible: (node) => zoom >= 4 || nodes.length <= 25 || Number(node.rank || 999) <= 12,
      labelText: (node) => node.gene_name || node.ensp_id || node.protein_id,
    });
  }
  state.networkHit = positioned;
  registerHits(canvas, hits);
  const explain = payload.edge_explanation || "Edges are real STRING interactions among selected candidate proteins.";
  $("#network-zoom-value").textContent = `${zoom.toFixed(1).replace(".0", "")}x`;
  $("#network-explain").innerHTML = `<strong>How to read this graph:</strong> ${esc(explain)} Wheel or pinch zoom spreads node positions; drag to pan. Labels are placed only when they do not collide. Node size follows weighted_degree_protein. Node color follows ML cluster. Node outline follows GEO support level.`;
  setMeta(canvas, `${legend(clusters.map((cluster) => ({ label: `Cluster ${cluster}`, color: clusterColors[Math.abs(cluster) % clusterColors.length] })))}${legend(Object.entries(geoSupportColors).map(([label, color]) => ({ label, color })))}<div class="axis-note">Labels use gene_name from real phase outputs; hover shows STRING protein_id and support metrics. Zoom spreads node positions; drag the plot to pan.</div>`);
}

function drawScoreBreakdown(canvas, breakdown) {
  const rows = breakdown.components || [];
  const { ctx, width, height } = canvasContext(canvas);
  const hits = [];
  const pad = { left: 168, right: 78, top: 24, bottom: 38 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  drawAxes(ctx, pad, plotW, plotH, niceTicks(0, 1, 4).map((v) => ({ x: pad.left + v * plotW, label: fmt(v) })), []);
  const rowH = plotH / Math.max(rows.length, 1);
  rows.forEach((row, index) => {
    const raw = Number(row.raw_score) || 0;
    const weighted = Number(row.weighted_score) || 0;
    const weight = Number(row.weight) || 0;
    const y = pad.top + index * rowH + rowH * 0.22;
    const h = Math.max(10, rowH * 0.5);
    const rawW = clamp(raw, 0, 1) * plotW;
    const weightedW = clamp(weighted, 0, 1) * plotW;
    ctx.fillStyle = "rgba(224, 255, 244, 0.12)";
    ctx.fillRect(pad.left, y, rawW, h);
    ctx.fillStyle = [colors.green, colors.cyan, colors.amber][index % 3];
    ctx.fillRect(pad.left, y, weightedW, h);
    ctx.fillStyle = colors.ink;
    ctx.textAlign = "right";
    ctx.fillText(row.name, pad.left - 8, y + h * 0.72);
    ctx.textAlign = "left";
    ctx.fillText(fmt(weighted), pad.left + Math.max(weightedW, 2) + 6, y + h * 0.72);
    hits.push({ x: pad.left, y, w: Math.max(rawW, 8), h, html: `<strong>${esc(row.name)}</strong><br>Raw score: ${fmt(raw)}<br>Weight: ${fmt(weight)}<br>Weighted score: ${fmt(weighted)}` });
  });
  ctx.textAlign = "left";
  registerHits(canvas, hits);
  setMeta(canvas, `${legend([{ label: "Raw component score", color: "rgba(224, 255, 244, 0.18)" }, { label: "Weighted contribution", color: colors.green }])}<div class="axis-note">Weighted contribution = raw component score x configured Phase 5 weight. Final score is the sum of weighted contributions.</div>`);
}
function sortRows(rows, key, dir) {
  const direction = dir === "desc" ? -1 : 1;
  const normalize = (value) => {
    if (value === null || value === undefined || value === "") return { missing: true, value: "" };
    const numeric = Number(value);
    if (Number.isFinite(numeric) && String(value).trim() !== "") return { missing: false, value: numeric };
    return { missing: false, value: String(value).toLowerCase() };
  };
  return [...rows].sort((a, b) => {
    const av = normalize(a[key]);
    const bv = normalize(b[key]);
    if (av.missing && bv.missing) return 0;
    if (av.missing) return 1;
    if (bv.missing) return -1;
    if (av.value === bv.value) return 0;
    return av.value > bv.value ? direction : -direction;
  });
}
function renderTable(container, rows, columns, options = false) {
  const settings = typeof options === "boolean" ? { clickable: options } : (options || {});
  const clickable = Boolean(settings.clickable);
  const sortId = settings.sortId;
  const sort = sortId ? state.tableSort[sortId] : null;
  const displayRows = sort ? sortRows(rows || [], sort.key, sort.dir) : [...(rows || [])];
  if (!displayRows.length) {
    container.innerHTML = '<p class="hint">Không có dòng nào khớp với filter hiện tại.</p>';
    return;
  }
  const headers = columns.map((column) => {
    const sorted = sort && sort.key === column.key;
    const marker = sorted ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
    const sortAttrs = sortId ? ` data-sort-key="${esc(column.key)}" tabindex="0"${sorted ? ` aria-sort="${sort.dir === "asc" ? "ascending" : "descending"}"` : ""}` : "";
    return `<th data-help="${esc(column.help || help[column.key] || column.label)}"${sortAttrs}>${esc(column.label)}${marker}</th>`;
  }).join("");
  const body = displayRows.map((row) => {
    const cells = columns.map((column) => `<td>${esc(fmt(row[column.key]))}</td>`).join("");
    const attrs = clickable && row.protein_id ? ` class="clickable" data-protein="${esc(row.protein_id)}"` : "";
    return `<tr${attrs}>${cells}</tr>`;
  }).join("");
  container.innerHTML = `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
  container.querySelectorAll("th[data-help]").forEach((th) => {
    th.addEventListener("mousemove", (event) => showTooltip(`<strong>${esc(th.textContent)}</strong>${esc(th.dataset.help)}`, event.clientX, event.clientY, 1200));
    th.addEventListener("mouseleave", hideTooltip);
  });
  if (sortId) {
    container.querySelectorAll("th[data-sort-key]").forEach((th) => {
      const updateSort = () => {
        const key = th.dataset.sortKey;
        const current = state.tableSort[sortId] || { key, dir: "asc" };
        state.tableSort[sortId] = { key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" };
        renderTable(container, rows, columns, settings);
      };
      th.addEventListener("click", updateSort);
      th.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          updateSort();
        }
      });
    });
  }
  if (clickable) container.querySelectorAll("tr[data-protein]").forEach((row) => row.addEventListener("click", () => openTarget(row.dataset.protein)));
}


function populateClusterControls() {
  const clusters = [...new Set((state.data.mlSummary.items || []).map((row) => row.cluster_id))].sort((a, b) => Number(a) - Number(b));
  ["network-cluster", "candidate-cluster", "ml-cluster"].forEach((id) => {
    const select = $(`#${id}`);
    const first = select.querySelector("option");
    select.innerHTML = "";
    select.appendChild(first.cloneNode(true));
    clusters.forEach((cluster) => {
      const option = document.createElement("option");
      option.value = String(cluster);
      option.textContent = `Cluster ${cluster}`;
      select.appendChild(option);
    });
  });
}

function metricByName(metrics, name) {
  return (metrics || []).find((metric) => metric.metric_name === name) || null;
}
function renderOverview(data) {
  const container = $("#overview-stat-groups");
  if (!container) return;
  const metrics = data?.metrics || [];
  const cards = overviewCards.map((card) => {
    const metric = metricByName(metrics, card.match);
    const value = metric ? fmt(metric.metric_value) : "Không có dữ liệu";
    const rawValue = metric ? Number(metric.metric_value) : NaN;
    const countAttr = Number.isFinite(rawValue) ? ` data-count-value="${esc(rawValue)}"` : "";
    const unit = metric ? (card.unit || metric.metric_unit || "") : "";
    return `
      <article class="overview-stat-card${metric ? "" : " missing"}">
        <span class="stat-icon" aria-hidden="true"><i data-lucide="${esc(card.icon)}"></i></span>
        <span>${esc(card.label)}</span>
        <strong${countAttr}>${esc(value)}</strong>
        ${unit ? `<small>${esc(unit)}</small>` : ""}
        <p>${esc(card.note)}</p>
      </article>
    `;
  }).join("");
  const summary = "Dữ liệu hiển thị được build từ phase outputs thật và JSON mart local. Overview không phải một phase phân tích riêng; nó giúp đọc nhanh quy mô sample sau QC, số DEG, mapping protein, PPI edges, top candidate và GEO support.";
  container.innerHTML = `
    <article class="overview-summary-card">
      <strong>Project snapshot</strong>
      <p>${esc(summary)}</p>
    </article>
    <div class="overview-stat-grid">${cards}</div>
  `;
  refreshIcons();
  animateStatCounts();
}

function overviewMetric(match) {
  if (!match) return null;
  return metricByName(state.data.overview?.metrics || [], match);
}
function mathText(value) {
  const replacements = [
    ["TargetScore", "Target Score"],
    ["log2FoldChange", "log<sub>2</sub>FC"],
    ["log2FC", "log<sub>2</sub>FC"],
    ["DE_norm", "DE<sub>norm</sub>"],
    ["Centrality_norm", "Centrality<sub>norm</sub>"],
    ["Confidence_norm", "Confidence<sub>norm</sub>"],
    ["w1", "w<sub>1</sub>"],
    ["w2", "w<sub>2</sub>"],
    ["w3", "w<sub>3</sub>"],
    ["*", "×"]
  ];
  return replacements.reduce((html, [from, to]) => html.replaceAll(from, to), esc(value));
}
function renderVariableTable(items = []) {
  if (!items.length) return "";
  return `
    <div class="pipeline-variable-table" aria-label="Biến mạng">
      ${items.map((item) => `
        <div class="pipeline-variable-row" title="${esc(item.raw)}">
          <div>
            <strong>${esc(item.display)}</strong>
            <code>${esc(item.raw)}</code>
          </div>
          <p>${esc(item.meaning)}</p>
        </div>
      `).join("")}
    </div>
  `;
}
function renderChipList(items = []) {
  if (!items.length) return "";
  return `<div class="pipeline-chip-list">${items.map((item) => `<span class="pipeline-chip" title="${esc(item.raw || item)}">${esc(item.display || item)}</span>`).join("")}</div>`;
}
function renderScoreBlock(score) {
  if (!score) return "";
  return `
    <div class="pipeline-score-block">
      <h3>Cách tính điểm mục tiêu (Target Score)</h3>
      <div class="pipeline-formula">${mathText(score.formula)}</div>
      <div class="pipeline-score-components">
        ${score.components.map((component) => `
          <article class="pipeline-score-component">
            <strong>${mathText(component.term)}</strong>
            <span>${mathText(component.source)}</span>
            <p>${mathText(component.definition || component.reason)}</p>
            <p>${esc(component.reason)}</p>
            <p><em>${mathText(component.normalize)}</em></p>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}
function renderPipelineSlide(animate = false) {
  const slideEl = $("#pipeline-slide");
  if (!slideEl) return;
  const slide = pipelineSlides[state.pipelineIndex];
  const detailHtml = slide.details.map((item) => `
    <article class="pipeline-detail-card${item.variables ? " has-variable-table" : ""}">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.text)}</p>
      ${item.code ? `<code>${esc(item.code)}</code>` : ""}
      ${item.chips ? renderChipList(item.chips) : ""}
      ${item.variables ? renderVariableTable(item.variables) : ""}
    </article>
  `).join("");
  const metricHtml = slide.metrics.map((metric) => {
    const item = overviewMetric(metric.match);
    const hasValue = Boolean(item || metric.fallback);
    const value = item ? esc(fmt(item.metric_value)) : esc(metric.fallback || "Không có dữ liệu");
    const unit = item ? esc(item.metric_unit || "") : (metric.fallback ? "tham chiếu project" : "không có metric");
    return `<div class="pipeline-metric${hasValue ? "" : " missing"}"><span>${esc(metric.label)}</span><strong>${value}</strong><small>${unit}</small></div>`;
  }).join("");
  const explanationHtml = `
    <article class="pipeline-explanation-card">
      <strong>Giải thích</strong>
      <p>${esc(slide.why)}</p>
    </article>
  `;
  slideEl.innerHTML = `
    <div class="pipeline-slide-content${slide.score ? " is-score-layout" : ""}">
      <div class="pipeline-hero">
        <div class="pipeline-icon" aria-hidden="true">${slide.icon}</div>
        <div>
          <span class="pipeline-step-label">${esc(slide.step)} / ${pipelineSlides.length}</span>
          <h3>${esc(slide.title)}</h3>
          <p class="pipeline-subtitle">${esc(slide.subtitle)}</p>
          <p>${esc(slide.description)}</p>
          <div class="pipeline-tech-list" aria-label="Công nghệ sử dụng">
            ${slide.technologies.map((tech) => `<span>${esc(tech)}</span>`).join("")}
          </div>
        </div>
      </div>
      <div class="pipeline-body-grid${slide.score ? " score-grid" : ""}">
        <div class="pipeline-detail-grid">
          ${detailHtml}
          ${renderScoreBlock(slide.score)}
          ${explanationHtml}
        </div>
        <aside class="pipeline-side">
          <h3>Chỉ số liên quan</h3>
          <div class="pipeline-metric-grid">${metricHtml}</div>
        </aside>
      </div>
    </div>
  `;
  slideEl.dataset.direction = state.pipelineDirection;
  if (animate) {
    slideEl.classList.remove("is-animating");
    void slideEl.offsetWidth;
    slideEl.classList.add("is-animating");
  }
  const counter = $("#pipeline-counter");
  if (counter) counter.textContent = `Bước ${state.pipelineIndex + 1} / ${pipelineSlides.length}`;
  const prev = $("#pipeline-prev");
  const next = $("#pipeline-next");
  if (prev) prev.disabled = state.pipelineIndex === 0;
  if (next) next.disabled = state.pipelineIndex === pipelineSlides.length - 1;
  const dots = $("#pipeline-dots");
  if (dots) {
    dots.innerHTML = pipelineSlides.map((item, index) => {
      const selected = index === state.pipelineIndex;
      return `<button type="button" class="pipeline-dot${selected ? " active" : ""}" role="tab" aria-selected="${selected}" aria-label="${esc(item.step)}: ${esc(item.title)}" data-index="${index}"></button>`;
    }).join("");
    dots.querySelectorAll(".pipeline-dot").forEach((dot) => dot.addEventListener("click", () => setPipelineIndex(Number(dot.dataset.index))));
  }
}
function setPipelineIndex(index) {
  const nextIndex = clamp(index, 0, pipelineSlides.length - 1);
  if (nextIndex === state.pipelineIndex) return;
  state.pipelineDirection = nextIndex > state.pipelineIndex ? "next" : "prev";
  state.pipelineIndex = nextIndex;
  renderPipelineSlide(true);
}
function pathForTab(tab) {
  if (tab === "pipeline") return "/pipeline";
  if (tab === "overview") return "/";
  return `/#${tab}`;
}
function tabFromLocation() {
  if (window.location.pathname === "/pipeline") return "pipeline";
  const hashTab = window.location.hash.replace(/^#/, "");
  return navigableTabs.has(hashTab) ? hashTab : "overview";
}
function activateTab(tab, options = {}) {
  const nextTab = navigableTabs.has(tab) ? tab : "overview";
  const panel = $(`#tab-${nextTab}`);
  if (!panel) return;
  const activeNav = detailTabs.has(nextTab) ? "pipeline" : nextTab;
  document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.dataset.tab === activeNav));
  document.querySelectorAll(".panel").forEach((item) => item.classList.toggle("active", item.id === `tab-${nextTab}`));
  syncNavigationUi(nextTab);
  if (nextTab === "pipeline") renderPipelineSlide(false);
  if (options.push !== false) {
    const nextPath = pathForTab(nextTab);
    const currentPath = `${window.location.pathname}${window.location.hash}`;
    if (currentPath !== nextPath) window.history.pushState({ tab: nextTab }, "", nextPath);
  }
  if (options.render !== false && state.data.overview) setTimeout(renderAll, 30);
}
function renderQc() {
  drawGroupedBars($("#qc-sample-chart"), state.data.qcSamples.items, "sample_group", [
    { key: "samples_before_qc", label: "Before QC", color: colors.gray },
    { key: "samples_after_qc", label: "After QC", color: colors.green }
  ], { x: "sample_group", y: "number of samples", text: "<br>QC pass means neither library-size nor detected-gene outlier flag is true." });
  drawVerticalBars($("#qc-exclusion-chart"), state.data.qcExclusions.items, "exclusion_reason", "sample_count", { rotate: false, color: () => colors.red, meta: "<strong>Exclusion reason:</strong> derived from quality_check boolean flags. X: reason. Y: number of removed samples." });
  drawHistogram($("#qc-library-chart"), state.data.qcLibrary.items, "number_of_samples", "<strong>Library size:</strong> histogram of total_raw_count from quality_check. X: raw count bin. Y: number of samples. Color follows sample_group.");
  drawHistogram($("#qc-zero-chart"), state.data.qcZero.items, "number_of_samples", "<strong>Zero gene rate:</strong> histogram of pct_zero_genes from quality_check. X: fraction of genes with zero count. Y: number of samples.");
}
async function renderDeg() {
  const highlight = Number($("#volcano-highlight").value || 20);
  state.data.volcano = await api(`/api/v1/visualizations/deg/volcano?max_points=20000&highlight_top_n=${highlight}`);
  redrawVolcano();
  drawVerticalBars($("#deg-summary-chart"), state.data.degSummary.items, "deg_direction", "gene_count", { rotate: false, color: (row) => row.deg_direction === "Upregulated" ? colors.red : row.deg_direction === "Downregulated" ? colors.blue : colors.gray, meta: "X: DEG status. Y: number of genes. Labels are horizontal because there are only three categories." });
  drawBar($("#top-deg-chart"), state.data.topDeg.items.slice(0, 18), "gene_name", "abs_log2FC", { color: (row) => row.log2FC >= 0 ? colors.red : colors.blue, meta: "Top real DEG genes sorted by absolute log2FC. Bar length is abs(log2FC); color shows direction." });
  drawHeatmap($("#heatmap-chart"), state.data.heatmap);
}
function renderMapping() {
  drawDonut($("#mapping-summary-chart"), state.data.mappingSummary.items, "mapping_status", "gene_count", [colors.green, colors.red], "Mapped genes have a STRING protein_id in Phase 3. Not mapped genes are DEG rows with no STRING protein mapping.");
  drawVerticalBars($("#mapping-confidence-chart"), state.data.mappingConfidence.items, "gene_confidence", "number_of_proteins", { rotate: false, color: (_, i) => clusterColors[i], meta: "X: STRING gene_confidence. Y: number of mapped proteins." });
  renderTable($("#unmapped-table"), state.data.unmapped.items, [
    { key: "gene_name", label: "Gene", help: "DEG gene symbol from Phase 2." }, { key: "gene_id_base", label: "Gene ID", help: "Ensembl gene ID without version suffix." }, { key: "log2FC", label: "log2FC", help: help.log2FC }, { key: "p_value", label: "p-value", help: help.p_value }, { key: "mapping_status", label: "Status", help: help.mapping_status }, { key: "mapping_reason", label: "Reason", help: help.mapping_reason }
  ]);
}
async function renderNetwork() {
  const top = $("#network-top").value;
  const min = $("#network-min").value;
  const cluster = $("#network-cluster").value;
  const direction = $("#network-direction").value;
  const geo = $("#network-geo").value;
  const params = new URLSearchParams({ top_n: top, min_edge_score: min });
  if (cluster) params.set("cluster_id", cluster);
  if (direction) params.set("deg_direction", direction);
  if (geo) params.set("geo_support_level", geo);
  state.data.network = await api(`/api/v1/visualizations/network?${params.toString()}`);
  drawNetwork($("#network-chart"), state.data.network);
  drawBar($("#network-top-chart"), state.data.networkTop.items.slice(0, 15), "gene_name", "weighted_degree_protein", { color: () => colors.cyan, meta: "X: weighted_degree_protein. Y: gene. Higher values mean broader/stronger STRING network connectivity." });
  drawHistogram($("#network-score-chart"), state.data.networkScores.items, "number_of_edges", "<strong>STRING score distribution:</strong> X is edge_weight_protein = combined_score_protein / 1000. Y is number of real STRING edges among selected top targets.");
}
async function renderRanking() {
  const params = new URLSearchParams({ limit: "100" });
  const search = $("#candidate-search").value.trim();
  const cluster = $("#candidate-cluster").value;
  const geo = $("#candidate-geo").value;
  if (search) params.set("search", search);
  if (cluster) params.set("cluster_id", cluster);
  if (geo) params.set("geo_support_level", geo);
  state.data.targets = await api(`/api/v1/targets?${params.toString()}`);
  const rows = state.data.targets.items;
  drawBar($("#ranking-chart"), rows.slice(0, 14), "gene_name", "final_score", {
    color: (row) => clusterColors[Math.abs(Number(row.cluster_id || 0)) % clusterColors.length],
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>Rank: ${fmt(row.rank)}<br>log2FC: ${fmt(row.log2FC)}<br>Weighted degree: ${fmt(row.weighted_degree_protein)}<br>Avg STRING: ${fmt(row.avg_combined_score)}<br>Final score: ${fmt(row.final_score)}<br>GEO support: ${esc(row.geo_support_level)}<br>Support score: ${fmt(row.geo_support_score)}`,
    meta: "Top candidate ranking from the Phase 7 enriched target mart. Bar length is GDC + STRING final_score; GEO support is shown as supporting evidence, not a ranking component."
  });
  renderTable($("#candidate-table"), rows, [
    { key: "rank", label: "Rank" }, { key: "gene_name", label: "Gene" }, { key: "protein_id", label: "STRING protein ID" }, { key: "log2FC", label: "log2FC" }, { key: "p_value", label: "p-value" }, { key: "weighted_degree_protein", label: "Weighted degree" }, { key: "avg_combined_score", label: "Avg STRING" }, { key: "final_score", label: "Final score" }, { key: "geo_support_score", label: "GEO score" }, { key: "geo_support_level", label: "GEO support" }, { key: "cluster_id", label: "Cluster" }, { key: "candidate_group", label: "Group" }
  ], { clickable: true, sortId: "candidate" });
  if (!state.currentTarget && rows[0]) await renderScore(rows[0].protein_id);
}
async function renderScore(proteinId) {
  const breakdown = await api(`/api/v1/targets/${encodeURIComponent(proteinId)}/score-breakdown`);
  $("#score-title").textContent = `${breakdown.gene_name} final score: ${fmt(breakdown.final_score)}`;
  drawScoreBreakdown($("#score-chart"), breakdown);
}
function renderGeo() {
  const summaryItems = state.data.geoSummary.items || [];
  drawDonut(
    $("#geo-summary-chart"),
    summaryItems,
    "geo_support_level",
    "count",
    summaryItems.map((row) => geoSupportColor(row.geo_support_level)),
    "Mode: tumor-cohort expression support. GEO support summarizes coverage and within-cohort candidate expression percentile; it is not tumor-vs-normal validation."
  );
  drawBar($("#geo-top-supported-chart"), (state.data.geoTopSupported.items || []).slice(0, 15), "gene_name", "geo_support_score", {
    color: (row) => geoSupportColor(row.geo_support_level),
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>GEO support rank: ${fmt(row.geo_support_rank)}<br>GDC rank: ${fmt(row.rank)}<br>Support score: ${fmt(row.geo_support_score)}<br>Coverage: ${fmt(row.geo_coverage_rate)}<br>Mean percentile: ${fmt(row.geo_mean_percentile)}<br>Top-quartile rate: ${fmt(row.geo_top_quartile_rate)}<br>Level: ${esc(row.geo_support_level)}`,
    meta: "Top supported candidates are sorted by geo_support_score descending, with GDC rank as the tie-breaker."
  });
  drawScatter($("#geo-scatter-chart"), state.data.geoScatter.items || [], "final_score", "geo_support_score", {
    xLabel: "GDC + STRING final_score",
    yLabel: "GEO support score",
    minY: 0,
    maxY: 1,
    radius: (row) => 4 + Math.max(0, 101 - Number(row.rank || 101)) / 40,
    color: (row) => geoSupportColor(row.geo_support_level),
    adaptiveLabels: true,
    labelDensityLimit: 65,
    maxLabels: 24,
    labelText: (row) => row.gene_name,
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>GDC rank: ${fmt(row.rank)}<br>Final score: ${fmt(row.final_score)}<br>GEO support score: ${fmt(row.geo_support_score)}<br>Coverage: ${fmt(row.geo_coverage_rate)}<br>Mean percentile: ${fmt(row.geo_mean_percentile)}<br>Top-quartile rate: ${fmt(row.geo_top_quartile_rate)}<br>Level: ${esc(row.geo_support_level)}`,
    meta: `${legend(Object.entries(geoSupportColors).map(([label, color]) => ({ label, color })))}<div class="axis-note">X remains the primary GDC + STRING ranking score. Y is supplemental tumor-only GEO support and does not alter rank.</div>`
  });
  renderTable($("#geo-overlap-table"), state.data.geoOverlap.items || [], [
    { key: "rank", label: "GDC rank", help: help.rank }, { key: "gene_name", label: "Gene", help: help.gene_name }, { key: "protein_id", label: "STRING protein ID", help: help.protein_id }, { key: "final_score", label: "Final score", help: help.final_score }, { key: "geo_support_score", label: "GEO score", help: help.geo_support_score }, { key: "geo_support_level", label: "Support level", help: help.geo_support_level }, { key: "geo_coverage_rate", label: "Coverage", help: help.geo_coverage_rate }, { key: "geo_mean_percentile", label: "Mean percentile", help: help.geo_mean_percentile }, { key: "geo_top_quartile_rate", label: "Top quartile rate", help: help.geo_top_quartile_rate }
  ], false);
  renderTable($("#geo-unmatched-table"), state.data.geoUnmatched.items || [], [
    { key: "rank", label: "Rank" }, { key: "gene_name", label: "Gene" }, { key: "protein_id", label: "STRING protein ID", help: help.protein_id }, { key: "final_score", label: "Final score", help: help.final_score }, { key: "geo_support_level", label: "Support level", help: help.geo_support_level }, { key: "geo_match_reason", label: "GEO match reason", help: help.geo_match_reason }
  ], false);
}
function mlViewport(rows) {
  const zoom = Number($("#ml-zoom").value || 1);
  const xs = rows.map((row) => Number(row.abs_log2FC)).filter(Number.isFinite);
  const ys = rows.map((row) => Number(row.weighted_degree_protein)).filter(Number.isFinite);
  const minAllX = Math.min(...xs, 0);
  const maxAllX = Math.max(...xs, 1);
  const minAllY = Math.min(...ys, 0);
  const maxAllY = Math.max(...ys, 1);
  const spanX = Math.max(0.1, (maxAllX - minAllX || 1) / zoom);
  const spanY = Math.max(1, (maxAllY - minAllY || 1) / zoom);
  if (!Number.isFinite(state.mlView.centerX) || state.mlView.centerX === 0) state.mlView.centerX = (minAllX + maxAllX) / 2;
  if (!Number.isFinite(state.mlView.centerY) || state.mlView.centerY === 0) state.mlView.centerY = (minAllY + maxAllY) / 2;
  state.mlView.centerX = clamp(state.mlView.centerX, minAllX + spanX / 2, maxAllX - spanX / 2);
  state.mlView.centerY = clamp(state.mlView.centerY, minAllY + spanY / 2, maxAllY - spanY / 2);
  return { zoom, minX: state.mlView.centerX - spanX / 2, maxX: state.mlView.centerX + spanX / 2, minY: state.mlView.centerY - spanY / 2, maxY: state.mlView.centerY + spanY / 2, spanX, spanY, minAllX, maxAllX, minAllY, maxAllY };
}
function drawMlScatter() {
  const rows = state.data.mlScatter?.items || [];
  const view = mlViewport(rows);
  $("#ml-zoom-value").textContent = `${view.zoom.toFixed(1).replace(".0", "")}x`;
  drawScatter($("#ml-scatter-chart"), rows, "abs_log2FC", "weighted_degree_protein", {
    xLabel: "abs(log2FC)",
    yLabel: "weighted degree",
    minX: view.minX,
    maxX: view.maxX,
    minY: view.minY,
    maxY: view.maxY,
    radius: (row) => 3 + (row.final_score || 0) * 10,
    color: (row) => clusterColors[Math.abs(Number(row.cluster_id || 0)) % clusterColors.length],
    adaptiveLabels: true,
    labelDensityLimit: 45,
    maxLabels: 18,
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>Cluster: ${fmt(row.cluster_id)}<br>abs_log2FC: ${fmt(row.abs_log2FC)}<br>Weighted degree: ${fmt(row.weighted_degree_protein)}<br>Avg STRING: ${fmt(row.avg_combined_score)}<br>Final score: ${fmt(row.final_score)}<br>Group: ${esc(row.candidate_group)}`,
    meta: `${legend([...new Set(rows.map((row) => row.cluster_id))].sort((a, b) => Number(a) - Number(b)).map((cluster) => ({ label: `Cluster ${cluster}`, color: clusterColors[Math.abs(Number(cluster || 0)) % clusterColors.length] })))}<div class="axis-note">Each point is a candidate protein from Phase 7. X = expression effect size, Y = STRING weighted degree, point size = final_score. Wheel or pinch to zoom; drag to pan.</div>`
  });
}
async function renderMl() {
  const cluster = $("#ml-cluster").value;
  const topOnly = $("#ml-top-only").checked;
  const params = new URLSearchParams({ limit: "5000", top_only: String(topOnly) });
  if (cluster) params.set("cluster_id", cluster);
  state.data.mlScatter = await api(`/api/v1/visualizations/ml/scatter?${params.toString()}`);
  drawLine($("#ml-k-chart"), state.data.mlK.items, "k", "silhouette_score", "X: candidate number of clusters k. Y: silhouette score. Higher is better separation.");
  drawMlScatter();
  drawVerticalBars($("#ml-summary-chart"), state.data.mlSummary.items, "cluster_id", "num_candidates", { rotate: false, color: (_, i) => clusterColors[i], meta: "X: cluster_id. Y: number of candidate proteins in the cluster." });
  renderTable($("#ml-cluster-table"), state.data.mlClusters.items, [
    { key: "cluster_id", label: "Cluster" }, { key: "candidate_group", label: "Candidate group" }, { key: "num_candidates", label: "Candidates" }, { key: "avg_abs_log2FC", label: "Avg abs log2FC" }, { key: "avg_weighted_degree", label: "Avg weighted degree" }, { key: "avg_combined_score", label: "Avg STRING" }, { key: "avg_final_score", label: "Avg final score" }
  ]);
}
function targetDetailSections(detail) {
  return [["Identity", detail.identity], ["Phase 2 DEG", detail.phase_2_deg], ["Phase 3 Mapping", detail.phase_3_mapping], ["Phase 4 PPI", detail.phase_4_ppi], ["Phase 5 Scoring", detail.phase_5_scoring], ["Phase 6 GEO", detail.phase_6_geo], ["Phase 7 ML", detail.phase_7_ml]];
}
function detailGrid(payload) {
  return `<div class="detail-grid">${Object.entries(payload).map(([key, value]) => `<div class="detail-item" title="${esc(help[key] || key)}"><span>${esc(key)}</span><strong>${esc(fmt(value))}</strong></div>`).join("")}</div>`;
}
function targetDetailHtml(detail) {
  return `<h2>${esc(detail.identity.gene_name)}</h2><p class="hint">STRING protein: ${esc(detail.identity.protein_id)}</p>${targetDetailSections(detail).map(([title, payload]) => `<h3>${title}</h3>${detailGrid(payload)}`).join("")}`;
}
function renderTargetDetailPanel(detail) {
  const panel = $("#target-detail-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="target-summary">
      <span class="target-kicker">Target hiện tại</span>
      <h4>${esc(detail.identity.gene_name)}</h4>
      <p class="hint">${esc(detail.identity.protein_id)}</p>
      <div class="target-badges">
        <span>Rank #${esc(fmt(detail.identity.rank))}</span>
        <span>${esc(detail.phase_2_deg.deg_direction || "NA")}</span>
        <span>${esc(detail.phase_6_geo.support_level || "NA")}</span>
      </div>
      <button type="button" class="detail-drawer-btn" data-open-drawer="${esc(detail.identity.protein_id)}">Mở drawer chi tiết</button>
    </div>
    ${targetDetailSections(detail).map(([title, payload]) => `<section class="detail-section"><h4>${title}</h4>${detailGrid(payload)}</section>`).join("")}
  `;
  panel.querySelector("[data-open-drawer]")?.addEventListener("click", (event) => openTarget(event.currentTarget.dataset.openDrawer, { openDrawer: true }));
}
async function openTarget(proteinId, options = {}) {
  const detail = await api(`/api/v1/targets/${encodeURIComponent(proteinId)}`);
  state.currentTarget = detail.identity;
  $("#chat-target").textContent = `${detail.identity.gene_name} (${detail.identity.protein_id})`;
  await renderScore(detail.identity.protein_id);
  renderTargetDetailPanel(detail);
  $("#drawer-content").innerHTML = targetDetailHtml(detail);
  if (options.openDrawer) setDrawerOpen(true);
}

function addChatMessage(role, text) {
  const log = $("#chat-log");
  const div = document.createElement("div");
  div.className = `chat-message ${role}`;
  div.innerHTML = `<small>${role === "user" ? "You" : "Assistant"}</small>${esc(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
async function initializeData() {
  const health = await api("/api/v1/health");
  state.data.health = health;
  $("#health-label").textContent = `API sẵn sàng (${health.mart_source || "json"}, real data)`;
  $(".status-dot").classList.add("ok");
  $(".status-dot").classList.remove("error");
  const calls = [
    ["overview", "/api/v1/overview"], ["qcSamples", "/api/v1/visualizations/qc/sample-counts"], ["qcExclusions", "/api/v1/visualizations/qc/exclusions"], ["qcLibrary", "/api/v1/visualizations/qc/library-size"], ["qcZero", "/api/v1/visualizations/qc/zero-gene-rate"], ["degSummary", "/api/v1/visualizations/deg/summary"], ["topDeg", "/api/v1/visualizations/deg/top-genes?limit=50"], ["heatmap", "/api/v1/visualizations/deg/heatmap?top_n=24"], ["mappingSummary", "/api/v1/visualizations/mapping/summary"], ["mappingConfidence", "/api/v1/visualizations/mapping/confidence"], ["unmapped", "/api/v1/mapping/unmapped"], ["networkTop", "/api/v1/visualizations/network/top-proteins?limit=100"], ["networkScores", "/api/v1/visualizations/network/score-distribution"], ["geoSummary", "/api/v1/visualizations/geo/summary"], ["geoTopSupported", "/api/v1/visualizations/geo/top-supported?limit=100"], ["geoScatter", "/api/v1/visualizations/geo/gdc-vs-support"], ["geoOverlap", "/api/v1/visualizations/geo/top-candidate-overlap?limit=100"], ["geoUnmatched", "/api/v1/geo/unmatched-candidates"], ["mlK", "/api/v1/visualizations/ml/k-selection"], ["mlSummary", "/api/v1/visualizations/ml/cluster-summary"], ["mlClusters", "/api/v1/ml/clusters"]
  ];
  const entries = await Promise.all(calls.map(async ([key, path]) => [key, await api(path)]));
  state.data = { ...state.data, ...Object.fromEntries(entries) };
  populateClusterControls();
}

async function renderAll() {
  renderOverview(state.data.overview);
  renderPipelineSlide(false);
  renderQc();
  await renderDeg();
  renderMapping();
  await renderNetwork();
  await renderRanking();
  renderGeo();
  await renderMl();
}
function panVolcano(dx, dy) {
  const rows = filteredVolcanoRows(state.data.volcano?.items || []);
  const view = volcanoViewport(rows.length ? rows : state.data.volcano?.items || []);
  const canvas = $("#volcano-chart");
  const rect = canvas.getBoundingClientRect();
  const plotW = Math.max(1, rect.width - 64 - 24);
  const plotH = Math.max(1, rect.height - 24 - 52);
  state.volcanoView.centerX -= (dx / plotW) * view.spanX;
  state.volcanoView.minY += (dy / plotH) * view.spanY;
  redrawVolcano();
}
function panNetwork(dx, dy) {
  state.networkView.panX += dx;
  state.networkView.panY += dy;
  if (state.data.network) drawNetwork($("#network-chart"), state.data.network);
}
function panMl(dx, dy) {
  const rows = state.data.mlScatter?.items || [];
  const view = mlViewport(rows);
  const canvas = $("#ml-scatter-chart");
  const rect = canvas.getBoundingClientRect();
  const plotW = Math.max(1, rect.width - 64 - 24);
  const plotH = Math.max(1, rect.height - 24 - 52);
  state.mlView.centerX -= (dx / plotW) * view.spanX;
  state.mlView.centerY += (dy / plotH) * view.spanY;
  drawMlScatter();
}
function bindCanvasPan(canvas, mode) {
  canvas.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    state.drag = { mode, x: event.clientX, y: event.clientY, moved: false };
    canvas.classList.add("is-panning");
    hideTooltip();
  });
}
document.addEventListener("mousemove", (event) => {
  if (!state.drag) return;
  const dx = event.clientX - state.drag.x;
  const dy = event.clientY - state.drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 1) state.drag.moved = true;
  state.drag.x = event.clientX;
  state.drag.y = event.clientY;
  if (state.drag.mode === "volcano") panVolcano(dx, dy);
  if (state.drag.mode === "network") panNetwork(dx, dy);
  if (state.drag.mode === "ml") panMl(dx, dy);
});
document.addEventListener("mouseup", () => {
  if (!state.drag) return;
  if (state.drag.mode === "network" && state.drag.moved) state.suppressNetworkClick = true;
  document.querySelectorAll("canvas.is-panning").forEach((canvas) => canvas.classList.remove("is-panning"));
  state.drag = null;
});
function zoomVolcanoAt(point, factor) {
  const rows = filteredVolcanoRows(state.data.volcano?.items || []);
  const view = volcanoViewport(rows.length ? rows : state.data.volcano?.items || []);
  const canvas = $("#volcano-chart");
  const rect = canvas.getBoundingClientRect();
  const pad = { left: 64, right: 24, top: 24, bottom: 52 };
  const plotW = Math.max(1, rect.width - pad.left - pad.right);
  const plotH = Math.max(1, rect.height - pad.top - pad.bottom);
  const rx = clamp((point.x - pad.left) / plotW, 0, 1);
  const ry = clamp((point.y - pad.top) / plotH, 0, 1);
  const dataX = view.minX + rx * view.spanX;
  const dataY = view.minY + (1 - ry) * view.spanY;
  const nextZoom = clamp(Number($("#volcano-zoom").value || 1) * factor, 1, 30);
  $("#volcano-zoom").value = String(nextZoom);
  const nextView = volcanoViewport(rows.length ? rows : state.data.volcano?.items || []);
  state.volcanoView.centerX = dataX + (0.5 - rx) * nextView.spanX;
  state.volcanoView.minY = dataY - (1 - ry) * nextView.spanY;
  redrawVolcano();
}
function zoomNetworkAt(point, factor) {
  const canvas = $("#network-chart");
  const rect = canvas.getBoundingClientRect();
  const oldZoom = Number($("#network-zoom").value || 1);
  const nextZoom = clamp(oldZoom * factor, 1, 30);
  const actualFactor = nextZoom / oldZoom;
  const anchorX = point.x - rect.width / 2 - state.networkView.panX;
  const anchorY = point.y - rect.height / 2 - state.networkView.panY;
  state.networkView.panX -= anchorX * (actualFactor - 1);
  state.networkView.panY -= anchorY * (actualFactor - 1);
  $("#network-zoom").value = String(nextZoom);
  if (state.data.network) drawNetwork(canvas, state.data.network);
}
function zoomMlAt(point, factor) {
  const rows = state.data.mlScatter?.items || [];
  const view = mlViewport(rows);
  const canvas = $("#ml-scatter-chart");
  const rect = canvas.getBoundingClientRect();
  const pad = { left: 64, right: 24, top: 24, bottom: 52 };
  const plotW = Math.max(1, rect.width - pad.left - pad.right);
  const plotH = Math.max(1, rect.height - pad.top - pad.bottom);
  const rx = clamp((point.x - pad.left) / plotW, 0, 1);
  const ry = clamp((point.y - pad.top) / plotH, 0, 1);
  const dataX = view.minX + rx * view.spanX;
  const dataY = view.minY + (1 - ry) * view.spanY;
  const nextZoom = clamp(Number($("#ml-zoom").value || 1) * factor, 1, 30);
  $("#ml-zoom").value = String(nextZoom);
  const nextView = mlViewport(rows);
  state.mlView.centerX = dataX + (0.5 - rx) * nextView.spanX;
  state.mlView.centerY = dataY + (ry - 0.5) * nextView.spanY;
  drawMlScatter();
}
function bindCanvasWheel(canvas, mode) {
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    hideTooltip();
    const point = canvasPoint(event, canvas);
    const factor = Math.exp(-event.deltaY * 0.0025);
    if (mode === "volcano") zoomVolcanoAt(point, factor);
    if (mode === "network") zoomNetworkAt(point, factor);
    if (mode === "ml") zoomMlAt(point, factor);
  }, { passive: false });
}
function bindEvents() {
  document.querySelectorAll("canvas").forEach(bindCanvasTooltip);
  document.querySelectorAll("h3[data-help]").forEach((h3) => {
    h3.addEventListener("mousemove", (event) => showTooltip(`<strong>${esc(h3.textContent)}</strong>${esc(h3.dataset.help)}`, event.clientX, event.clientY));
    h3.addEventListener("mouseleave", hideTooltip);
  });
  document.querySelectorAll(".nav-btn").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.tab === "pipeline") {
      const pipelinePanelActive = $("#tab-pipeline")?.classList.contains("active");
      const pipelineNavActive = button.classList.contains("active");
      if (pipelinePanelActive && pipelineNavActive) {
        setPipelineSubnavCollapsed(!document.body.classList.contains("pipeline-subnav-collapsed"));
        return;
      }
      setPipelineSubnavCollapsed(false);
      activateTab("pipeline");
      return;
    }
    setPipelineSubnavCollapsed(false);
    activateTab(button.dataset.tab);
  }));
  document.querySelectorAll("[data-analysis-tab]").forEach((button) => button.addEventListener("click", () => {
    setPipelineSubnavCollapsed(false);
    activateTab(button.dataset.analysisTab);
  }));
  $("#pipeline-prev")?.addEventListener("click", () => setPipelineIndex(state.pipelineIndex - 1));
  $("#pipeline-next")?.addEventListener("click", () => setPipelineIndex(state.pipelineIndex + 1));
  document.addEventListener("keydown", (event) => {
    if (!$("#tab-pipeline")?.classList.contains("active")) return;
    if (event.key === "ArrowLeft") setPipelineIndex(state.pipelineIndex - 1);
    if (event.key === "ArrowRight") setPipelineIndex(state.pipelineIndex + 1);
  });
  window.addEventListener("popstate", () => activateTab(tabFromLocation(), { push: false }));
  $("#sidebar-toggle")?.addEventListener("click", () => setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed")));
  $(".brand-mark")?.addEventListener("click", () => {
    if (document.body.classList.contains("sidebar-collapsed")) setSidebarCollapsed(false);
  });
  $("#export-csv")?.addEventListener("click", exportCurrentCandidates);
  $("#drawer-close").addEventListener("click", () => setDrawerOpen(false));
  $("#drawer-backdrop")?.addEventListener("click", () => setDrawerOpen(false));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setDrawerOpen(false); });
  $("#volcano-highlight").addEventListener("change", async () => { resetVolcanoView(); await renderDeg(); });
  $("#volcano-top-only").addEventListener("change", () => { resetVolcanoView(); redrawVolcano(); });
  document.querySelectorAll(".volcano-color-filter").forEach((input) => input.addEventListener("change", redrawVolcano));
  $("#volcano-zoom").addEventListener("input", redrawVolcano);
  $("#volcano-reset").addEventListener("click", () => { resetVolcanoView(); $("#volcano-zoom").value = "1"; redrawVolcano(); });
  ["network-top", "network-min", "network-cluster", "network-direction", "network-geo"].forEach((id) => $(`#${id}`).addEventListener("change", async () => { resetNetworkView(); await renderNetwork(); }));
  $("#network-zoom").addEventListener("input", () => { if (state.data.network) drawNetwork($("#network-chart"), state.data.network); });
  $("#network-reset").addEventListener("click", () => { resetNetworkView(); $("#network-zoom").value = "1"; if (state.data.network) drawNetwork($("#network-chart"), state.data.network); });
  ["candidate-search", "candidate-cluster", "candidate-geo"].forEach((id) => $(`#${id}`).addEventListener(id === "candidate-search" ? "input" : "change", renderRanking));
  ["ml-cluster", "ml-top-only"].forEach((id) => $(`#${id}`).addEventListener("change", async () => { resetMlView(); await renderMl(); }));
  $("#ml-zoom").addEventListener("input", drawMlScatter);
  $("#ml-reset").addEventListener("click", () => { resetMlView(); $("#ml-zoom").value = "1"; drawMlScatter(); });
  bindCanvasPan($("#volcano-chart"), "volcano");
  bindCanvasPan($("#network-chart"), "network");
  bindCanvasPan($("#ml-scatter-chart"), "ml");
  bindCanvasWheel($("#volcano-chart"), "volcano");
  bindCanvasWheel($("#network-chart"), "network");
  bindCanvasWheel($("#ml-scatter-chart"), "ml");
  $("#network-chart").addEventListener("click", (event) => {
    if (state.suppressNetworkClick) {
      state.suppressNetworkClick = false;
      return;
    }
    const point = canvasPoint(event, event.currentTarget);
    const hit = state.networkHit.find((node) => Math.hypot(node.x - point.x, node.y - point.y) <= node.hitRadius + 4);
    if (hit) openTarget(hit.protein_id);
  });
  $("#chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#chat-input");
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    addChatMessage("user", question);
    const response = await api("/api/v1/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, target: state.currentTarget?.protein_id || null }) });
    addChatMessage("assistant", response.answer);
  });
  window.addEventListener("resize", () => {
    clearTimeout(window.__drugTargetResize);
    window.__drugTargetResize = setTimeout(renderAll, 120);
  });
}
document.addEventListener("DOMContentLoaded", async () => {
  refreshIcons();
  bindEvents();
  activateTab(tabFromLocation(), { push: false, render: false });
  addChatMessage("assistant", "AI Assistant đang ở chế độ thử nghiệm giao diện; dữ liệu dashboard lấy từ mart hiện tại của project.");
  try {
    await initializeData();
    await renderAll();
  } catch (error) {
    $("#health-label").textContent = "Không tải được API/data";
    $(".status-dot").classList.add("error");
    addChatMessage("assistant", `Không tải được dữ liệu dashboard: ${error.message}`);
  }
});
