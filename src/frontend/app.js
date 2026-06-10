const state = {
  currentTarget: null,
  pipelineIndex: 0,
  pipelineDirection: "next",
  pipelineVisualTabs: {},
  pipelineNetworkFilters: { topN: 50, minScore: 0.4, direction: "", geoSupported: false },
  pipelineDegFilter: "top100",
  pipelineDegView: { zoom: 1, centerX: 0, minY: 0 },
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
function clusterProfile(clusterId) {
  return (state.data.mlExplain?.items || []).find((row) => Number(row.cluster_id) === Number(clusterId)) || null;
}
function clusterInterpretation(clusterId) {
  return clusterProfile(clusterId)?.cluster_interpretation || `Cluster ${clusterId}`;
}
function clusterFullLabel(clusterId) {
  return `Cluster ${clusterId} · ${clusterInterpretation(clusterId)}`;
}

const detailTabs = new Set(["qc", "deg", "mapping", "network", "ml"]);
const navigableTabs = new Set(["overview", "pipeline", "ranking", "geo", "ai"]);
detailTabs.forEach((tab) => navigableTabs.add(tab));
const overviewCards = [
  { label: "Sample sau QC", match: "GDC samples after QC", unit: "samples", icon: "scan-search", note: "Sample GDC/TCGA-LUAD còn lại sau quality control." },
  { label: "DEGs", match: "Differentially expressed genes", unit: "genes", icon: "chart-scatter", note: "Gene khác biệt expression giữa Tumor và Normal." },
  { label: "Protein đã mapping", match: "DEG mapped to proteins", unit: "genes", icon: "git-compare-arrows", note: "DEG map được sang STRING protein_id." },
  { label: "STRING edges", match: "PPI edges in top-target graph", unit: "edges", icon: "share-2", note: "Cạnh PPI trong top-target graph với edge_weight >= 0.4." },
  { label: "Candidate ưu tiên", match: "Top candidate targets", unit: "targets", icon: "trophy", note: "Candidate target cuối cùng từ mart enriched." },
  { label: "Target có GEO support", match: "Candidates with GEO support", unit: "targets", icon: "database-zap", note: "Target có support trong GEO tumor-only cohort." }
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
    id: 1,
    stepLabel: "Thu thập dữ liệu",
    shortLabel: "Dữ liệu",
    icon: "database",
    title: "Thu thập dữ liệu từ GDC, STRING và GEO",
    description: "Pipeline bắt đầu bằng việc tự động lấy dữ liệu từ nhiều nguồn sinh học. GDC cung cấp expression gene và metadata sample, STRING cung cấp mạng PPI, còn GEO hỗ trợ đối chiếu cohort bên ngoài.",
    goal: "Đưa dữ liệu thô từ các nguồn khác nhau về cùng một hệ thống để xử lý tiếp.",
    inputs: ["GDC/TCGA expression & metadata", "STRING protein-protein interaction", "GEO tumor cohort support"],
    outputs: ["Dữ liệu thô được lưu trữ tập trung", "Các file nguồn được quản lý theo từng lần tải"],
    details: [
      { title: "Tổng quan", text: "NiFi đóng vai trò như 'ống hút' tự động hút dữ liệu từ các nguồn thông qua API và đưa về HDFS để lưu trữ file thô." },
      { title: "Nguồn GEO và STRING", text: "GEO bổ sung cohort hỗ trợ bên ngoài; STRING cung cấp aliases, protein nodes và cạnh PPI. Các nguồn này đi cùng pipeline để downstream có thể mapping và kiểm chứng candidate." },
      { title: "Kiểm soát luồng tải", text: "NiFi có cơ chế giúp tự động thu thập dữ liệu sau một khoảng thời gian cố định." },
      { title: "Raw HDFS", text: "Raw layer được xem là bất biến: không rename, không lọc, không sửa nội dung. Mọi cleaning và analysis đọc từ raw/refined để pipeline có thể replay." }
    ],
    statHighlights: [
      { label: "Nguồn dữ liệu", value: 3, unit: "nguồn" },
      { label: "GDC samples", match: "GDC samples before QC" },
      { label: "STRING edges", match: "PPI edges in top-target graph" },
      { label: "Có GEO support", match: "Candidates with GEO support" }
    ],
    visual: { type: "sources" },
    actions: [
      { label: "Chi tiết kỹ thuật", icon: "settings", title: "Thu thập tự động", body: ["NiFi tự động gọi API theo lịch để tải GDC, STRING và GEO.", "Dữ liệu raw được đưa về HDFS theo partition ngày để có thể audit và chạy lại pipeline khi cần.", "Các lỗi tải file được route riêng để không làm sai lệch dữ liệu downstream."] }
    ]
  },
  {
    id: 2,
    stepLabel: "Làm sạch",
    shortLabel: "Làm sạch",
    icon: "sparkles",
    title: "Làm sạch dữ liệu để các nguồn có thể liên kết với nhau",
    description: "Dữ liệu từ GDC, STRING và GEO dùng các định dạng tên gene và protein khác nhau. Bước này chuẩn hóa định danh để các nguồn có thể được phân tích chung một cách nhất quán.",
    goal: "Tạo dữ liệu refined sạch, nhất quán, sẵn sàng cho QC và phân tích tiếp theo.",
    inputs: ["Raw GDC expression", "Raw STRING edges", "Raw GEO cohort"],
    outputs: ["Expression matrix đã chuẩn hóa", "Metadata sample/case", "Bảng ánh xạ gene-protein", "Network edges từ STRING"],
    details: [
      { title: "Chuẩn hóa schema", text: "Tên các gene đã được chuẩn hóa và lọc bỏ phần thừa, ví dụ loại bỏ version của gene vì không link được với bộ STRING. Các bảng phục vụ phân tích được join lại để dữ liệu sạch hơn và dễ liên kết giữa GDC/STRING hơn." },
      { title: "Chuẩn hóa missing/null", text: "Các giá trị như NA, Unknown, not available được quy về null trong Parquet. Điều này giúp Spark SQL xử lý missing nhất quán thay vì coi chuỗi rác là dữ liệu thật." },
      { title: "Expression gene-level", text: "Expression được đưa về dạng gene-level, tránh duplicate key ngoài ý muốn và không trộn đơn vị expression nếu chưa có cột expression_unit." },
      { title: "QC output", text: "Cleaning tạo QC report cho sample, gene, missingness và batch. Các report này là bằng chứng vì sao một dòng dữ liệu được giữ hoặc loại." }
    ],
    statHighlights: [
      { label: "Gene sau chuẩn hóa", compute: "totalGenes", unit: "genes" },
      { label: "Sample hợp lệ", match: "GDC samples after QC" },
      { label: "Mapping rate", compute: "mappingRate", unit: "%" },
      { label: "STRING edges sau lọc", match: "PPI edges in top-target graph" }
    ],
    visual: { type: "cleaningStats" },
    actions: [
      { label: "Chi tiết kỹ thuật", icon: "wrench", title: "Chuẩn hóa định danh", body: ["Ensembl gene ID được chuẩn hóa bằng cách bỏ version suffix trước khi link sang STRING.", "Các bảng phân tích join theo identifier đã thống nhất để giảm lỗi do alias, khoảng trắng hoặc chữ hoa/thường.", "Dữ liệu refined được lưu dạng Parquet để dashboard và notebook đọc lại cùng một schema."] }
    ]
  },
  {
    id: 3,
    stepLabel: "QC",
    shortLabel: "QC",
    icon: "shield-check",
    title: "Kiểm tra chất lượng trước khi phân tích",
    description: "Trước khi so sánh Tumor và Normal, pipeline loại bỏ các sample có chất lượng kém như tổng expression quá thấp hoặc quá ít gene được phát hiện để tránh sai lệch kết quả.",
    goal: "Giữ lại các sample đủ tin cậy cho phân tích Differential Expression.",
    inputs: ["Expression matrix", "Metadata sample", "Library size", "Gene detected count", "Zero rate"],
    outputs: ["Danh sách sample pass/fail QC", "Expression data sẵn sàng cho log2(TPM+1) và DE"],
    details: [
      { title: "Đọc dữ liệu QC", text: "Notebook đọc dữ liệu QC từ Hive table nếu bảng đã được đăng ký. Nếu chưa có Hive table, hệ thống sẽ đọc trực tiếp dữ liệu Parquet refined trên HDFS để đảm bảo notebook vẫn chạy được." },
      { title: "Loại sample outlier", text: "Sample bị loại nếu có outlier về library size hoặc số gene phát hiện được. Đây là hai tín hiệu thường phản ánh sample quá ít dữ liệu hoặc profile expression bất thường." },
      { title: "Giữ protein-coding", text: "Pipeline chỉ giữ protein-coding expression vì downstream cần map gene sang protein target và STRING PPI." },
      { title: "Chuẩn hóa thang expression", text: "TPM được chuyển sang log2(TPM + 1) để giảm ảnh hưởng của giá trị expression quá lớn và làm so sánh Tumor/Normal ổn định hơn.", code: "log2_tpm = log2(TPM + 1)" },
      { title: "Giải thích", text: "QC giúp kiểm tra và loại các sample có chất lượng bất thường trước khi phân tích DE, ví dụ sample có tổng expression quá thấp hoặc số gene phát hiện quá ít. Sau bước QC, dữ liệu expression được chuẩn hóa bằng log2(TPM + 1) để giảm ảnh hưởng của các giá trị quá lớn, xử lý được trường hợp TPM = 0 và giúp việc so sánh Tumor/Normal ổn định hơn. Nếu xuất hiện TPM âm, đó được xem là dữ liệu không hợp lệ và cần được đánh dấu hoặc loại bỏ trước khi phân tích." }
    ],
    statHighlights: [
      { label: "Trước QC", match: "GDC samples before QC" },
      { label: "Sau QC", match: "GDC samples after QC" },
      { label: "Loại", compute: "qcRemoved", unit: "samples", tone: "danger" }
    ],
    visual: { type: "qc" },
    actions: [
      { label: "Xem lý do loại sample", icon: "list-filter", title: "Lý do loại sample", body: ["Bảng này hiển thị lý do QC loại sample trong mart hiện tại."], dynamic: "qcExclusions" },
      { label: "Giải thích log2(TPM+1)", icon: "calculator", title: "Vì sao dùng log2(TPM+1)?", body: ["TPM có thể có giá trị rất lớn và cũng có giá trị bằng 0.", "Công thức log2(TPM+1) làm phân phối ổn định hơn, giảm ảnh hưởng của outlier lớn và vẫn xử lý được TPM = 0."] },
      { label: "Chi tiết kỹ thuật", icon: "settings", title: "QC data access", body: ["Notebook ưu tiên đọc QC từ Hive table khi bảng đã đăng ký.", "Nếu Hive table chưa sẵn sàng, notebook fallback sang Parquet trên HDFS để vẫn chạy được trong môi trường local/lab."] }
    ]
  },
  {
    id: 4,
    stepLabel: "Differential Expression",
    shortLabel: "DE",
    icon: "trending-up",
    title: "Tìm gene biểu hiện khác biệt giữa Tumor và Normal",
    description: "DE so sánh expression của từng gene giữa nhóm Tumor và Normal. Gene có |log2FC| >= 1 và p-value < 0.05 được xác định là DEG, tạo danh sách ứng viên ban đầu cho drug target.",
    goal: "Xác định các gene tăng hoặc giảm rõ rệt trong ung thư phổi LUAD.",
    inputs: ["Expression đã qua QC", "Nhãn Tumor / Normal cho từng sample"],
    outputs: ["Danh sách DEG", "log2FC", "p-value", "Chiều Up/Down/Not DEG"],
    details: [
      { title: "Tách nhóm Tumor/Normal", text: "sample_group được normalize thành Tumor hoặc Normal. Gene chỉ được so sánh khi có dữ liệu ở cả hai nhóm." },
      { title: "Tính trung bình và phương sai", text: "Với mỗi gene, hệ thống gom các sample Tumor và Normal thành hai nhóm. Sau đó tính expression trung bình của gene trong từng nhóm để xem gene đó tăng hay giảm ở Tumor. Phương sai được dùng để biết expression của gene có ổn định giữa các sample hay dao động quá mạnh. Nhờ vậy, bước DE không chỉ nhìn vào chênh lệch trung bình mà còn xem độ tin cậy của chênh lệch đó." },
      { title: "Tính log2FC và p-value", text: "log2FC là chênh lệch mean_log2_tpm giữa Tumor và Normal. p-value được tính bằng Welch-style t-stat để xử lý hai nhóm có phương sai/kích thước khác nhau." },
      { title: "Ngưỡng significant", text: "Một gene được xem là DEG khi vừa có mức thay đổi expression đủ lớn, vừa có bằng chứng thống kê đủ mạnh. Ngưỡng |log2FC| >= 1 tương đương expression thay đổi khoảng 2 lần giữa Tumor và Normal, giúp giữ lại các gene có hiệu ứng rõ ràng. Ngưỡng p_value < 0.05 giúp lọc các gene có khác biệt ít khả năng xuất hiện do ngẫu nhiên.", code: "|log2FC| >= 1 và p_value < 0.05" }
    ],
    statHighlights: [
      { label: "Tumor samples", match: "Tumor samples", unit: "samples" },
      { label: "Normal samples", match: "Normal samples", unit: "samples" },
      { label: "Gene DEG", match: "Differentially expressed genes", unit: "genes" }
    ],
    visual: { type: "deg", tabs: ["Volcano plot"] },
    actions: [
      { label: "Giải thích log2FC & p-value", icon: "book-open", title: "log2FC và p-value", body: ["Ngưỡng |log2FC| >= 1 tương đương expression thay đổi khoảng 2 lần giữa Tumor và Normal.", "p-value < 0.05 giúp lọc các khác biệt ít khả năng xuất hiện do ngẫu nhiên.", "Một gene chỉ được xem là DEG khi vừa có hiệu ứng đủ lớn vừa có bằng chứng thống kê đủ mạnh."] },
      { label: "Giải thích mean & variance", icon: "activity", title: "Mean và variance trong DE", body: ["Pipeline tính expression trung bình của từng gene trong nhóm Tumor và nhóm Normal.", "Variance cho biết expression của gene đó ổn định hay dao động mạnh giữa các sample.", "Kết hợp mean và variance giúp tránh chọn gene chỉ chênh lệch tình cờ hoặc quá nhiễu."] }
    ]
  },
  {
    id: 5,
    stepLabel: "Gene-to-Protein Mapping",
    shortLabel: "Mapping",
    icon: "link",
    title: "Liên kết gene khác biệt sang protein target",
    description: "Drug target thường được nghiên cứu ở mức protein. Bước này ánh xạ DEG sang protein tương ứng trong STRING để tiếp tục phân tích mạng tương tác.",
    goal: "Chuyển danh sách DEG thành danh sách protein candidate có thể phân tích bằng mạng STRING.",
    inputs: ["Danh sách DEG", "Gene symbol / ENSG ID đã chuẩn hóa", "STRING gene-protein map"],
    outputs: ["DEG đã được ánh xạ sang protein", "Danh sách gene chưa ánh xạ được", "Mapping confidence"],
    details: [
      { title: "Chuẩn hóa tên gene", text: "Tên gene được trim và uppercase trước khi join. Bước này giảm lỗi do khoảng trắng, chữ hoa/thường hoặc alias không đồng nhất giữa GDC và STRING." },
      { title: "Đọc STRING gene_map", text: "Pipeline ưu tiên Hive table STRING.gene_map; nếu Hive table chưa đăng ký thì fallback sang Parquet refined trên HDFS." },
      { title: "Giữ mapping có protein_id", text: "Mapping hợp lệ cần protein_id, ensp_id và gene_confidence. protein_id là khóa chính để nối sang STRING edges/nodes." },
      { title: "Audit gene không map", text: "Gene không nối được sang STRING protein vẫn được ghi audit, giúp biết expression hit nào bị loại trước PPI và scoring." }
    ],
    statHighlights: [
      { label: "DEG đã mapping", compute: "mappedRatio" },
      { label: "Tỷ lệ thành công", compute: "mappingRate", unit: "%" },
      { label: "Chưa mapping", compute: "unmappedGenes", unit: "genes", tone: "danger" },
      { label: "Confidence", compute: "mappingConfidence" }
    ],
    visual: { type: "mapping" },
    callout: "Không phải gene nào cũng có protein tương ứng trong STRING. Bước này kiểm tra độ phủ trước khi đưa vào phân tích mạng.",
    actions: [
      { label: "Xem gene chưa mapping được", icon: "list-x", title: "Audit gene chưa mapping", body: ["Các gene dưới đây là DEG nhưng không nối được sang STRING protein trong mart hiện tại."], dynamic: "unmappedGenes" },
      { label: "Mapping confidence là gì?", icon: "badge-help", title: "Mapping confidence", body: ["STRING cung cấp mức tin cậy cho ánh xạ gene/protein dựa trên identifier và alias.", "ENSP ID là Ensembl protein ID được dùng để nối candidate sang mạng protein.", "Confidence cao nghĩa là bước mapping ít mơ hồ hơn trước khi tính network score."] }
    ]
  },
  {
    id: 6,
    stepLabel: "PPI Network & Target Score",
    shortLabel: "PPI",
    icon: "network",
    title: "DA - PPI Network & Target Score",
    subtitle: "Tính bối cảnh mạng và điểm mục tiêu",
    technologies: ["PySpark", "STRING edges/nodes", "Network features", "Min-max normalization", "Target scoring"],
    description: "Protein ứng viên được đặt vào mạng PPI để tính feature mạng, sau đó kết hợp với tín hiệu DE và độ tin cậy STRING thành Target Score.",
    details: [
      { title: "Lọc cạnh PPI", text: "PySpark lọc STRING edges liên quan protein ứng viên. Cạnh được giữ khi edge_weight_protein >= 0.4; cạnh tin cậy cao dùng ngưỡng 0.7." },
      { title: "Tính feature mạng", text: "Các feature mạng được tính theo từng protein trung tâm, rồi nối với nodes_protein để bổ sung degree và weighted degree đã có trong refined STRING." },
      { title: "Chuẩn bị scoring", text: "Các feature expression, centrality và confidence được chuẩn hóa trước khi cộng trọng số để không biến nào áp đảo chỉ vì khác đơn vị đo." },
      { title: "Biến mạng", text: "Tên hiển thị bên dưới thay cho biến thô; tooltip vẫn giữ tên biến gốc để trace về notebook.", variables: targetFeatureDefinitions }
    ],
    statHighlights: [
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
    why: "Slide này tách rõ hai việc: PPI network cho biết protein nằm ở đâu trong mạng, còn Target Score gom nhiều bằng chứng đã chuẩn hóa. Cách này tránh xếp hạng chỉ dựa vào expression hoặc chỉ dựa vào độ trung tâm mạng.",
    visual: { type: "network" }
  },
  {
    id: 7,
    stepLabel: "Candidate Scoring & GEO",
    shortLabel: "Scoring",
    icon: "trophy",
    title: "Chấm điểm và đánh giá mức hỗ trợ của candidate target",
    description: "Pipeline kết hợp mức thay đổi expression, vị trí mạng và độ tin cậy STRING để chấm điểm protein candidate. GEO được dùng như cohort bên ngoài để xem mức hỗ trợ expression.",
    goal: "Tạo danh sách candidate protein target có thể xếp hạng, giải thích và ưu tiên.",
    inputs: ["DEG metrics", "Network metrics", "STRING confidence score", "GEO tumor cohort expression"],
    outputs: ["Candidate ranking", "Score decomposition", "GEO support level", "Candidate table"],
    details: [
      { title: "Weighted candidate ranking", text: "Final score kết hợp expression_score, protein_network_score và string_confidence_score theo trọng số Phase 5 đã chốt.", code: "0.5 × expression + 0.3 × network + 0.2 × STRING confidence" }
    ],
    statHighlights: [
      { label: "Candidate ưu tiên", match: "Top candidate targets" },
      { label: "Có GEO support", match: "Candidates with GEO support" },
      { label: "Moderate support", compute: "geoModerate", unit: "targets" },
      { label: "Top final score", compute: "topFinalScore" }
    ],
    visual: { type: "scoring", tabs: ["Xếp hạng", "GEO Support", "Bảng đầy đủ"] },
    callout: "GEO trong project là dữ liệu tumor cohort bên ngoài: dùng để đánh giá độ phủ và mức expression, không phải validation Tumor-vs-Normal độc lập.",
    actions: [
      { label: "GEO support là gì?", icon: "database-zap", title: "GEO support", body: ["GEO ở project này là tumor cohort bên ngoài, không có nhóm Normal đối chứng.", "Vì vậy GEO support phản ánh coverage và expression percentile trong cohort, không phải independent Tumor-vs-Normal DE validation.", "Ranking chính vẫn đến từ GDC + STRING; GEO là bằng chứng phụ để đọc candidate cẩn thận hơn."] },
      { label: "Giải thích scoring", icon: "scale", title: "Candidate scoring", body: ["Score kết hợp có trọng số của |log2FC|, weighted degree và STRING confidence.", "Expression score phản ánh mức thay đổi giữa Tumor và Normal.", "Network score phản ánh vai trò trung tâm trong PPI.", "STRING confidence score phản ánh độ tin cậy của bằng chứng tương tác."] }
    ]
  },
  {
    id: 8,
    stepLabel: "ML Clustering",
    shortLabel: "ML",
    icon: "brain-circuit",
    title: "Phân nhóm candidate bằng Machine Learning không giám sát",
    description: "Bước cuối dùng clustering để tự động nhóm các candidate protein có đặc điểm tương tự, giúp khám phá pattern thay vì chỉ nhìn vào một bảng xếp hạng phẳng.",
    goal: "Hỗ trợ khám phá các kiểu target khác nhau trong danh sách candidate.",
    inputs: ["abs(log2FC)", "log1p(weighted degree)", "Avg STRING score", "log1p(DEG interactions)"],
    outputs: ["Cluster label cho mỗi candidate", "Cluster summary", "Scatter plot 2D", "Silhouette score"],
    statHighlights: [
      { label: "Số cụm", match: "ML clusters" },
      { label: "Best k", compute: "bestK" },
      { label: "Silhouette", compute: "bestSilhouette" },
      { label: "Candidate", compute: "mlTotalCandidates", unit: "proteins" }
    ],
    visual: { type: "ml", tabs: ["Silhouette score", "Scatter plot", "Chi tiết cụm"] },
    callout: "Đây là học máy không giám sát: hệ thống tự tìm nhóm mà không cần nhãn đúng/sai. Mục đích là khám phá, không phải phân loại.",
    actions: [
      { label: "Candidate vào cluster bằng cách nào?", icon: "brain", title: "Quy tắc gán KMeans", body: ["Không có một ngưỡng điểm cố định để vào Cluster 0, 1 hoặc 2.", "Bốn feature được biến đổi và chuẩn hóa; KMeans gán mỗi candidate vào centroid gần nhất trong không gian feature.", "Min/median/max của mỗi cluster chỉ dùng để mô tả, không phải luật phân loại cứng."] },
      { label: "Giải thích silhouette score", icon: "line-chart", title: "Silhouette score", body: ["Score gần 1 nghĩa là các cụm tách nhau rõ hơn.", "Score gần 0 nghĩa là cụm chồng lấp hoặc ranh giới không rõ.", "Pipeline thử nhiều giá trị k và dùng silhouette để chọn cấu hình hợp lý hơn."] }
    ]
  }
];
const help = {
  rank: "Hạng trong Phase 5 candidate scoring; số nhỏ hơn nghĩa là ưu tiên cao hơn trong pipeline này.",
  gene_name: "Gene symbol gắn với candidate protein.",
  protein_id: "STRING protein identifier dùng cho mapping và join PPI ở Phase 3-5.",
  ensp_id: "Ensembl protein ID tách từ STRING protein_id.",
  log2FC: "log2 fold change từ Phase 2. Giá trị dương nghĩa là mean expression cao hơn ở Tumor; giá trị âm nghĩa là thấp hơn ở Tumor.",
  p_value: "p-value từ output Phase 2. Mart hiện tại chưa có adjusted_p_value, nên dashboard không đổi tên thành adjusted.",
  deg_direction: "Chiều DEG được Phase 2 gán theo dấu của log2FC.",
  gene_confidence: "Mapping confidence từ refined STRING gene_map dùng trong Phase 3.",
  weighted_degree_protein: "STRING network weighted degree của protein này từ Phase 4.",
  avg_combined_score: "Điểm STRING combined_score trung bình trên các tương tác quanh protein. STRING combined_score dùng thang 0-1000.",
  edge_weight_protein: "STRING combined_score_protein chia 1000. 0.4 là medium confidence; 0.7 là high confidence.",
  final_score: "Phase 5 weighted candidate score kết hợp expression, protein_network_score và STRING confidence score.",
  geo_match_status: "Candidate gene có match expression row trong GEO tumor-only cohort hay không.",
  geo_coverage_rate: "Tỷ lệ sample GEO tumor-cohort có expression dùng được cho candidate gene này.",
  geo_mean_expression: "Mean GEO expression trên các sample tumor-cohort đã match.",
  geo_median_expression: "Median GEO expression trên các sample tumor-cohort đã match.",
  geo_mean_percentile: "Trung bình within-sample expression percentile trong nhóm top candidate gene ở GEO.",
  geo_top_quartile_rate: "Tỷ lệ sample GEO tumor-cohort mà candidate nằm trong top quartile expression.",
  geo_support_score: "Phase 6 tumor-only GEO support score: 0.2 coverage + 0.5 mean percentile + 0.3 top-quartile rate.",
  geo_support_level: "Nhóm support suy ra từ geo_support_score; Not Found không có score.",
  match_status: "Candidate gene có match expression row trong GEO tumor-only cohort hay không.",
  coverage_rate: "Tỷ lệ sample GEO tumor-cohort có expression dùng được cho candidate gene này.",
  mean_expression: "Mean GEO expression trên các sample tumor-cohort đã match.",
  median_expression: "Median GEO expression trên các sample tumor-cohort đã match.",
  mean_percentile: "Trung bình within-sample expression percentile trong nhóm top candidate gene ở GEO.",
  top_quartile_rate: "Tỷ lệ sample GEO tumor-cohort mà candidate nằm trong top quartile expression.",
  support_score: "Phase 6 tumor-only GEO support score: 0.2 coverage + 0.5 mean percentile + 0.3 top-quartile rate.",
  support_level: "Nhóm support suy ra từ GEO support score; Not Found không có score.",
  cluster_id: "KMeans cluster ID từ Phase 7.",
  candidate_group: "Nhãn diễn giải gốc từ Phase 7; có thể trùng nếu hai cluster cùng nằm một phía của median.",
  cluster_interpretation: "Nhãn diễn giải riêng của dashboard, dựa trên profile định lượng để phân biệt từng cluster.",
  mapping_status: "DEG gene này đã mapping sang STRING protein_id trong Phase 3 hay chưa.",
  mapping_reason: "Lý do gene xuất hiện trong audit chưa mapping. Trong mart này, các dòng không có STRING protein_id khớp trong refined STRING gene_map.",
  geo_match_reason: "Lý do candidate vắng trong kết quả GEO tumor-cohort support."
};

function $(selector) { return document.querySelector(selector); }

const tabLabels = {
  overview: "Tổng quan",
  pipeline: "Luồng pipeline",
  qc: "Phase 1 / QC dữ liệu",
  deg: "Phase 2 / Differential Expression",
  mapping: "Phase 3 / Gene-Protein Mapping",
  network: "Phase 4 / Mạng PPI",
  ranking: "Xếp hạng candidate",
  geo: "Hỗ trợ GEO",
  ml: "Phase 7 / ML Clustering",
  ai: "Trợ lý AI"
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
  tip.classList.remove("visible", "sidebar-tooltip");
}
function showSidebarTooltip(label, anchor) {
  clearTimeout(tooltipTimer);
  const tip = ensureTooltip();
  tip.innerHTML = `<strong>${esc(label)}</strong>`;
  tip.style.left = `${anchor.x}px`;
  tip.style.top = `${anchor.y}px`;
  tip.classList.add("sidebar-tooltip", "visible");
}
function bindSidebarTooltips() {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    const label = button.querySelector("span")?.textContent?.trim() || button.getAttribute("aria-label") || "Mục điều hướng";
    const show = () => {
      if (!document.body.classList.contains("sidebar-collapsed")) return;
      const rect = button.getBoundingClientRect();
      showSidebarTooltip(label, { x: rect.right + 12, y: rect.top + rect.height / 2 });
    };
    button.addEventListener("mouseenter", show);
    button.addEventListener("focus", show);
    button.addEventListener("mouseleave", hideTooltip);
    button.addEventListener("blur", hideTooltip);
  });
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

function bindCanvasTooltipOnce(canvas) {
  if (!canvas || canvas.dataset.tooltipBound === "true") return;
  bindCanvasTooltip(canvas);
  canvas.dataset.tooltipBound = "true";
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
  const pad = { left: 68, right: 30, top: 30, bottom: 56 };
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
  const pad = { left: 66, right: 30, top: 28, bottom: options.rotate ? 86 : 56 };
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
  const pad = { left: options.left || 150, right: 58, top: 30, bottom: 44 };
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
  const pad = options.pad || { left: 76, right: 34, top: 30, bottom: 64 };
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
  ctx.translate(18, pad.top + plotH / 2 + 42);
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
    xLabel: "log2FC (Tumor vs Normal)",
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
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.gene_id_base)}</small><br>log2FC: ${fmt(row.log2FC)}<br>p_value: ${fmt(row.p_value)}<br>-log10(p): ${fmt(row.minus_log10_p_value)}<br>Hạng: ${fmt(row.rank)}<br>Trạng thái: ${row.is_deg ? esc(row.deg_direction) : "Not DEG"}`,
    meta: `${legend([{ label: "Top candidate", color: colors.amber }, { label: "Upregulated DEG", color: colors.red }, { label: "Downregulated DEG", color: colors.blue }, { label: "Not DEG", color: colors.gray }])}<div class="axis-note">Mỗi điểm là một gene. Trục X là log2FC, trục Y là -log10(p-value). Đang hiển thị ${fmt(filtered.length)} gene; ${fmt(visibleEstimate)} gene nằm trong vùng xem hiện tại. Điểm vàng là top candidate; cuộn chuột hoặc pinch để zoom, kéo để pan.</div>`
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
  const pad = { left: 66, right: 30, top: 28, bottom: 58 };
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
  const pad = { left: 112, right: 26, top: 30, bottom: 90 };
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
  setMeta(canvas, `${colorScaleLegend(min, max, data.value_label || "log2 TPM")}<div class="axis-note">Hàng là top DEG genes; cột là các case Tumor/Normal đã pass QC. Xanh là ${esc(data.value_label || "value")} thấp hơn; đỏ là cao hơn.</div>`);
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
    hits.push({ x: node.x - node.hitRadius, y: node.y - node.hitRadius, w: node.hitRadius * 2, h: node.hitRadius * 2, html: `<strong>${esc(node.gene_name)}</strong><small>${esc(node.protein_id)}</small><br>ENSP: ${esc(node.ensp_id)}<br>Hạng: ${fmt(node.rank)}<br>log2FC: ${fmt(node.log2FC)}<br>Weighted degree: ${fmt(node.weighted_degree_protein)}<br>Avg STRING combined score: ${fmt(node.avg_combined_score)}<br>Final score: ${fmt(node.final_score)}<br>GEO support: ${esc(node.geo_support_level)}<br>Support score: ${fmt(node.geo_support_score)}<br>Coverage: ${fmt(node.geo_coverage_rate)}<br>Mean percentile: ${fmt(node.geo_mean_percentile)}<br>Cluster: ${fmt(node.cluster_id)}<br>Diễn giải: ${esc(node.cluster_interpretation || clusterInterpretation(node.cluster_id))}` });
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
  const explain = payload.edge_explanation || "Các cạnh là tương tác STRING thật giữa những candidate protein đã chọn.";
  $("#network-zoom-value").textContent = `${zoom.toFixed(1).replace(".0", "")}x`;
  $("#network-explain").innerHTML = `<strong>Cách đọc graph:</strong> ${esc(explain)} Cuộn chuột hoặc pinch để zoom; kéo để pan. Label chỉ hiện khi không chồng nhau. Kích thước node theo weighted_degree_protein, màu theo ML cluster, viền theo GEO support level.`;
  setMeta(canvas, `${legend(clusters.map((cluster) => ({ label: `Cluster ${cluster}`, color: clusterColors[Math.abs(cluster) % clusterColors.length] })))}${legend(Object.entries(geoSupportColors).map(([label, color]) => ({ label, color })))}<div class="axis-note">Mỗi node là candidate protein, cạnh là STRING PPI. Hover để xem STRING protein_id và metrics; zoom/pan giúp đọc vùng dày node.</div>`);
}

function drawScoreBreakdown(canvas, breakdown) {
  const rows = breakdown.components || [];
  const { ctx, width, height } = canvasContext(canvas);
  const hits = [];
  const pad = { left: 182, right: 92, top: 30, bottom: 46 };
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
    hits.push({ x: pad.left, y, w: Math.max(rawW, 8), h, html: `<strong>${esc(row.name)}</strong><br>Raw score: ${fmt(raw)}<br>Trọng số: ${fmt(weight)}<br>Weighted score: ${fmt(weighted)}` });
  });
  ctx.textAlign = "left";
  registerHits(canvas, hits);
  setMeta(canvas, `${legend([{ label: "Raw component score", color: "rgba(224, 255, 244, 0.18)" }, { label: "Weighted contribution", color: colors.green }])}<div class="axis-note">Weighted contribution = raw component score x trọng số Phase 5. Final score là tổng các weighted contribution.</div>`);
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
    container.innerHTML = "<p class=\"hint\">Không có dòng nào khớp với bộ lọc hiện tại.</p>";
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
      option.textContent = clusterFullLabel(cluster);
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
  const summary = "Dữ liệu hiển thị được build từ phase outputs thật và JSON mart local. Tổng quan không phải một phase phân tích riêng; nó giúp đọc nhanh quy mô sample sau QC, số DEG, mapping protein, PPI edges, top candidate và GEO support.";
  container.innerHTML = `
    <article class="overview-summary-card">
      <strong>Tổng quan project</strong>
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
function pipelineRows(key) {
  return state.data[key]?.items || [];
}
function metricNumber(match) {
  const item = overviewMetric(match);
  const value = Number(item?.metric_value);
  return Number.isFinite(value) ? value : null;
}
function sumRows(rows, key) {
  return (rows || []).reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}
function degCount(direction) {
  return pipelineRows("degSummary").find((row) => row.deg_direction === direction)?.gene_count || 0;
}
function mappingRows() {
  return pipelineRows("mappingSummary");
}
function mappingMappedRow() {
  return mappingRows().find((row) => String(row.mapping_status || "").toLowerCase().includes("mapped")) || null;
}
function mappingUnmappedRow() {
  return mappingRows().find((row) => String(row.mapping_status || "").toLowerCase().includes("not")) || null;
}
function activePipelineNetwork() {
  return state.data.pipelineNetwork || state.data.network || { nodes: [], edges: [] };
}
function bestKRow() {
  return [...pipelineRows("mlK")].sort((a, b) => Number(b.silhouette_score || 0) - Number(a.silhouette_score || 0))[0] || null;
}
function pipelineComputedMetric(key) {
  const network = activePipelineNetwork();
  const nodes = network.nodes || [];
  const edges = network.edges || [];
  const targets = pipelineRows("targets");
  if (key === "totalGenes") return { value: sumRows(pipelineRows("degSummary"), "gene_count"), unit: "genes" };
  if (key === "mappingRate") return { value: mappingMappedRow()?.percentage, unit: "%" };
  if (key === "mappedRatio") {
    const mapped = mappingMappedRow()?.gene_count ?? metricNumber("DEG mapped to proteins");
    const total = metricNumber("Differentially expressed genes");
    return { value: mapped && total ? `${fmt(mapped)} / ${fmt(total)}` : "NA", unit: "genes" };
  }
  if (key === "unmappedGenes") return { value: mappingUnmappedRow()?.gene_count || 0, unit: "genes" };
  if (key === "mappingConfidence") return { value: pipelineRows("mappingConfidence")[0]?.gene_confidence || "NA", unit: "STRING" };
  if (key === "qcRemoved") return { value: sumRows(pipelineRows("qcSamples"), "samples_removed"), unit: "samples" };
  if (key === "upregulated") return { value: degCount("Upregulated"), unit: "genes" };
  if (key === "downregulated") return { value: degCount("Downregulated"), unit: "genes" };
  if (key === "topGene") return { value: pipelineRows("topDeg")[0]?.gene_name || "NA", unit: pipelineRows("topDeg")[0]?.deg_direction || "" };
  if (key === "networkNodes") return { value: nodes.length || state.data.network?.nodes?.length || 0, unit: "node" };
  if (key === "networkEdges") return { value: edges.length || metricNumber("PPI edges in top-target graph") || 0, unit: "edge" };
  if (key === "avgNetworkDegree") {
    const avg = nodes.length ? nodes.reduce((sum, row) => sum + (Number(row.weighted_degree_protein) || 0), 0) / nodes.length : null;
    return { value: avg, unit: "weighted" };
  }
  if (key === "maxStringScore") {
    const max = Math.max(...edges.map((edge) => Number(edge.edge_weight_protein || 0)), 0);
    return { value: max, unit: "0-1" };
  }
  if (key === "geoModerate") return { value: pipelineRows("geoSummary").find((row) => row.geo_support_level === "Moderate GEO support")?.count || 0, unit: "targets" };
  if (key === "topFinalScore") return { value: targets[0]?.final_score || null, unit: "rank #1" };
  if (key === "bestK") return { value: bestKRow()?.k || "NA", unit: "clusters" };
  if (key === "bestSilhouette") return { value: bestKRow()?.silhouette_score || null, unit: "score" };
  if (key === "mlTotalCandidates") return { value: sumRows(pipelineRows("mlSummary"), "num_candidates"), unit: "proteins" };
  return { value: "NA", unit: "" };
}
function pipelineStat(stat) {
  if (stat.compute) {
    const computed = pipelineComputedMetric(stat.compute);
    return { label: stat.label, tone: stat.tone, ...computed, unit: stat.unit || computed.unit };
  }
  if (stat.match) {
    const item = overviewMetric(stat.match);
    return { label: stat.label, value: item ? item.metric_value : "NA", unit: stat.unit || item?.metric_unit || "", tone: stat.tone };
  }
  return { label: stat.label, value: stat.value, unit: stat.unit || "", tone: stat.tone };
}
function statValueHtml(stat, className = "pipeline-highlight-card") {
  const item = pipelineStat(stat);
  const numeric = Number(item.value);
  const countAttr = Number.isFinite(numeric) ? ` data-count-value="${esc(numeric)}"` : "";
  return `
    <article class="${className}${item.tone ? ` tone-${esc(item.tone)}` : ""}">
      <span>${esc(item.label)}</span>
      <strong${countAttr}>${esc(fmt(item.value))}</strong>
      ${item.unit ? `<small>${esc(item.unit)}</small>` : ""}
    </article>
  `;
}
function renderPipelineStats(stats = [], className) {
  return stats.map((stat) => statValueHtml(stat, className)).join("");
}
function renderPipelinePills(items = [], type) {
  return items.map((item) => `<span class="pipeline-io-pill ${type}">${esc(item)}</span>`).join("");
}

function renderPipelineDetailBlocks(details = []) {
  if (!details.length) return "";
  return `<div class="pipeline-detail-blocks">${details.map((item) => `
    <article class="pipeline-narrative-block">
      <strong>${esc(item.title)}</strong>
      <p>${esc(item.text)}</p>
      ${item.code ? `<code>${esc(item.code)}</code>` : ""}
      ${item.variables ? `<div class="pipeline-variable-list">${item.variables.map((variable) => `<div title="${esc(variable.raw)}"><b>${esc(variable.display)}</b><span>${esc(variable.meaning)}</span><code>${esc(variable.raw)}</code></div>`).join("")}</div>` : ""}
    </article>
  `).join("")}</div>`;
}
function renderPipelineScoreBlock(score) {
  if (!score) return "";
  return `
    <section class="pipeline-score-explain">
      <strong>Target Score</strong>
      <code>${esc(score.formula)}</code>
      <div>${(score.components || []).map((item) => `
        <article>
          <b>${esc(item.term)}</b>
          <span>${esc(item.source)}</span>
          <p>${esc(item.definition)}</p>
          <p>${esc(item.reason)}</p>
          <p>${esc(item.normalize)}</p>
        </article>
      `).join("")}</div>
    </section>
  `;
}
function renderPipelineNarrative(slide, actionHtml) {
  if (slide.id === 6) {
    return `
      <section class="pipeline-narrative" aria-label="Narrative panel">
        <span class="pipeline-step-badge">Bước ${slide.id}/${pipelineSlides.length}</span>
        <h3>${esc(slide.title)}</h3>
        ${slide.subtitle ? `<p class="pipeline-subtitle-text">${esc(slide.subtitle)}</p>` : ""}
        <p class="pipeline-description">${esc(slide.description)}</p>
        <div class="pipeline-tech-list mini">${(slide.technologies || []).map((item) => `<span>${esc(item)}</span>`).join("")}</div>
        ${renderPipelineDetailBlocks(slide.details)}
        ${renderPipelineScoreBlock(slide.score)}
        ${slide.why ? `<aside class="pipeline-callout"><strong>Vì sao bước này quan trọng</strong><p>${esc(slide.why)}</p></aside>` : ""}
      </section>
    `;
  }
  return `
    <section class="pipeline-narrative" aria-label="Narrative panel">
      <span class="pipeline-step-badge">Bước ${slide.id}/${pipelineSlides.length}</span>
      <h3>${esc(slide.title)}</h3>
      <p class="pipeline-description">${esc(slide.description)}</p>
      ${renderPipelineDetailBlocks(slide.details)}
      <article class="pipeline-goal-card"><i data-lucide="target" aria-hidden="true"></i><div><strong>Mục tiêu</strong><p>${esc(slide.goal)}</p></div></article>
      <div class="pipeline-io-grid">
        <article><strong>Đầu vào</strong><div>${renderPipelinePills(slide.inputs, "input")}</div></article>
        <article><strong>Đầu ra</strong><div>${renderPipelinePills(slide.outputs, "output")}</div></article>
      </div>
      ${slide.callout ? `<aside class="pipeline-callout">${esc(slide.callout)}</aside>` : ""}
      <div class="pipeline-actions">${actionHtml}</div>
    </section>
  `;
}

function renderPipelineTabs(slide) {
  const tabs = slide.visual?.tabs || [];
  if (!tabs.length) return "";
  const active = state.pipelineVisualTabs[slide.id] || tabs[0];
  return `<div class="pipeline-visual-tabs" role="tablist">${tabs.map((tab) => `<button type="button" class="pipeline-visual-tab${tab === active ? " active" : ""}" data-pipeline-tab="${esc(tab)}">${esc(tab)}</button>`).join("")}</div>`;
}
function renderPipelineStepper() {
  const stepper = $("#pipeline-stepper");
  if (!stepper) return;
  stepper.innerHTML = pipelineSlides.map((slide, index) => {
    const stateClass = index < state.pipelineIndex ? " done" : index === state.pipelineIndex ? " active" : "";
    return `
      <button type="button" class="pipeline-stepper-item${stateClass}" role="tab" aria-selected="${index === state.pipelineIndex}" data-index="${index}">
        <span class="step-circle"><i data-lucide="${esc(index < state.pipelineIndex ? "check" : slide.icon)}" aria-hidden="true"></i></span>
        <span class="step-copy"><small>${String(index + 1).padStart(2, "0")}</small><strong>${esc(slide.shortLabel)}</strong></span>
      </button>
    `;
  }).join("");
  stepper.querySelectorAll("[data-index]").forEach((button) => button.addEventListener("click", () => setPipelineIndex(Number(button.dataset.index))));
  const mobile = $("#pipeline-mobile-step");
  const current = pipelineSlides[state.pipelineIndex];
  if (mobile) mobile.textContent = `${state.pipelineIndex + 1}/${pipelineSlides.length} ${current.shortLabel}`;
}
function renderPipelineDots() {
  const dots = $("#pipeline-dots");
  if (!dots) return;
  dots.innerHTML = pipelineSlides.map((slide, index) => `
    <button type="button" class="pipeline-dot${index === state.pipelineIndex ? " active" : ""}" role="tab" aria-selected="${index === state.pipelineIndex}" aria-label="Đến bước ${index + 1}: ${esc(slide.shortLabel)}" data-index="${index}"></button>
  `).join("");
  dots.querySelectorAll("[data-index]").forEach((button) => button.addEventListener("click", () => setPipelineIndex(Number(button.dataset.index))));
}
function animateCountUps(scope = document) {
  const counters = scope.querySelectorAll("[data-count-value]");
  counters.forEach((counter) => {
    const value = Number(counter.dataset.countValue);
    if (!Number.isFinite(value)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      counter.textContent = fmt(value);
      return;
    }
    const start = performance.now();
    const duration = 720;
    const frame = (now) => {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      counter.textContent = fmt(value * eased);
      if (progress < 1) requestAnimationFrame(frame);
      else counter.textContent = fmt(value);
    };
    requestAnimationFrame(frame);
  });
}
function pipelineLoading(message = "Đang tải dữ liệu mart...") {
  return `<div class="pipeline-loading"><i data-lucide="loader-circle" aria-hidden="true"></i><span>${esc(message)}</span></div>`;
}
function renderPipelineSlide(animate = false) {
  const slideEl = $("#pipeline-slide");
  if (!slideEl) return;
  const slide = pipelineSlides[state.pipelineIndex];
  const actionHtml = (slide.actions || []).map((action, index) => `
    <button type="button" class="pipeline-action-btn" data-action-index="${index}">
      <i data-lucide="${esc(action.icon || "info")}" aria-hidden="true"></i>${esc(action.label)}
    </button>
  `).join("");
  slideEl.dataset.direction = state.pipelineDirection;
  slideEl.innerHTML = `
    <div class="pipeline-slide-frame">
      ${renderPipelineNarrative(slide, actionHtml)}
      <section class="pipeline-visual-panel" aria-label="Visual panel">
        <div class="pipeline-visual-head">
          <div>
            <span>${esc(slide.stepLabel)}</span>
            <h4>${esc(slide.shortLabel)}</h4>
          </div>
          ${renderPipelineTabs(slide)}
        </div>
        <div class="pipeline-highlight-grid">${renderPipelineStats(slide.statHighlights)}</div>
        <div class="pipeline-visual-body" id="pipeline-visual-body"></div>
      </section>
    </div>
  `;
  slideEl.querySelectorAll("[data-action-index]").forEach((button) => button.addEventListener("click", () => openPipelineModal(Number(button.dataset.actionIndex))));
  slideEl.querySelectorAll("[data-pipeline-tab]").forEach((button) => button.addEventListener("click", () => {
    state.pipelineVisualTabs[slide.id] = button.dataset.pipelineTab;
    renderPipelineSlide(false);
  }));
  if (animate) {
    slideEl.classList.remove("is-animating");
    void slideEl.offsetWidth;
    slideEl.classList.add("is-animating");
  }
  renderPipelineStepper();
  renderPipelineDots();
  renderPipelineVisual(slide);
  animateCountUps(slideEl);
  const counter = $("#pipeline-counter");
  if (counter) counter.textContent = `Bước ${state.pipelineIndex + 1} / ${pipelineSlides.length}`;
  const prev = $("#pipeline-prev");
  const next = $("#pipeline-next");
  if (prev) prev.disabled = state.pipelineIndex === 0;
  if (next) next.disabled = state.pipelineIndex === pipelineSlides.length - 1;
  refreshIcons();
}
function renderPipelineVisual(slide) {
  const body = $("#pipeline-visual-body");
  if (!body) return;
  if (slide.visual.type === "sources") renderPipelineSourceVisual(body);
  if (slide.visual.type === "cleaningStats") renderPipelineCleaningVisual(body);
  if (slide.visual.type === "qc") renderPipelineQcVisual(body);
  if (slide.visual.type === "deg") renderPipelineDegVisual(body, slide);
  if (slide.visual.type === "mapping") renderPipelineMappingVisual(body);
  if (slide.visual.type === "network") renderPipelineNetworkVisual(body);
  if (slide.visual.type === "scoring") renderPipelineScoringVisual(body, slide);
  if (slide.visual.type === "ml") renderPipelineMlVisual(body, slide);
  animateCountUps(body);
  refreshIcons();
}
function renderPipelineSourceVisual(body) {
  const cards = [
    { name: "GDC", icon: "database", desc: "Expression và metadata mẫu LUAD", stat: { match: "GDC samples before QC", label: "samples" } },
    { name: "STRING", icon: "network", desc: "Protein interactions cho network", stat: { match: "PPI edges in top-target graph", label: "edges" } },
    { name: "GEO", icon: "database-zap", desc: "Tumor cohort support bên ngoài", stat: { match: "Candidates with GEO support", label: "targets" } }
  ];
  body.innerHTML = `
    <div class="pipeline-source-flow">
      <div class="pipeline-source-cards">
        ${cards.map((card) => {
          const metric = pipelineStat(card.stat);
          return `<article class="pipeline-source-card"><i data-lucide="${card.icon}" aria-hidden="true"></i><strong>${card.name}</strong><p>${card.desc}</p><span>${esc(fmt(metric.value))} ${esc(metric.unit || card.stat.label)}</span></article>`;
        }).join("")}
      </div>
      <svg class="pipeline-source-arrows" viewBox="0 0 680 120" aria-hidden="true">
        <path d="M115 10 C115 64 250 72 330 104" />
        <path d="M340 10 C340 62 340 72 340 104" />
        <path d="M565 10 C565 64 430 72 350 104" />
      </svg>
      <div class="pipeline-storage-node"><i data-lucide="server" aria-hidden="true"></i><strong>Kho lưu trữ tập trung</strong><span>Cập nhật: ${new Date().toLocaleDateString("vi-VN")}</span></div>
      <div class="pipeline-source-row"><span>3 nguồn dữ liệu</span><span>Manifest raw theo từng nguồn</span><span>Mart local sẵn sàng đọc</span></div>
    </div>
  `;
}
function renderPipelineCleaningVisual(body) {
  body.innerHTML = `<div class="pipeline-big-stat-grid">${renderPipelineStats([
    { label: "Gene sau chuẩn hóa", compute: "totalGenes", unit: "genes" },
    { label: "Sample hợp lệ", match: "GDC samples after QC" },
    { label: "Gene-Protein mapping rate", compute: "mappingRate", unit: "%" },
    { label: "STRING edges sau lọc", match: "PPI edges in top-target graph" }
  ], "pipeline-big-stat")}</div>`;
}
function renderPipelineQcVisual(body) {
  body.innerHTML = `
    <div class="pipeline-qc-flow">
      <article><span>Trước QC</span><strong data-count-value="${esc(metricNumber("GDC samples before QC") || 0)}">0</strong><small>samples</small></article>
      <i data-lucide="arrow-right" aria-hidden="true"></i>
      <article><span>Sau QC</span><strong data-count-value="${esc(metricNumber("GDC samples after QC") || 0)}">0</strong><small>samples</small></article>
      <b>Loại ${esc(fmt(pipelineComputedMetric("qcRemoved").value))} samples</b>
    </div>
    <div class="pipeline-mini-chart-grid">
      <article class="pipeline-mini-chart"><h5>Phân phối library size</h5><canvas id="pipeline-qc-library"></canvas></article>
      <article class="pipeline-mini-chart"><h5>Lý do loại sample</h5><canvas id="pipeline-qc-exclusion"></canvas></article>
    </div>
    <div class="pipeline-formula-note">Expression được chuẩn hóa bằng <strong>log2(TPM+1)</strong> để ổn định phân phối và xử lý giá trị bằng 0.</div>
  `;
  const library = $("#pipeline-qc-library");
  const exclusion = $("#pipeline-qc-exclusion");
  if (library && pipelineRows("qcLibrary").length) { drawHistogram(library, pipelineRows("qcLibrary"), "number_of_samples", "Phân phối tổng lượng expression trên mỗi sample. Sample có library size quá thấp sẽ bị loại."); bindCanvasTooltipOnce(library); }
  if (exclusion && pipelineRows("qcExclusions").length) { drawVerticalBars(exclusion, pipelineRows("qcExclusions"), "exclusion_reason", "sample_count", { rotate: false, color: () => colors.red, meta: "Số sample bị loại theo từng lý do QC; cột cao hơn nghĩa là nhiều sample bị loại vì lý do đó." }); bindCanvasTooltipOnce(exclusion); }
}
function resetPipelineDegView() {
  state.pipelineDegView = { zoom: 1, centerX: 0, minY: 0 };
}
function pipelineVolcanoFilteredRows(rows) {
  const drawable = drawableVolcanoRows(rows || []);
  if (state.pipelineDegFilter === "up") return drawable.filter((row) => row.is_deg && row.deg_direction === "Upregulated");
  if (state.pipelineDegFilter === "down") return drawable.filter((row) => row.is_deg && row.deg_direction === "Downregulated");
  if (state.pipelineDegFilter === "not") return drawable.filter((row) => !row.is_deg);
  return [...drawable].sort((a, b) => {
    const ar = Number(a.rank || 999999);
    const br = Number(b.rank || 999999);
    if (ar !== br) return ar - br;
    return Math.abs(Number(b.log2FC || 0)) - Math.abs(Number(a.log2FC || 0));
  }).slice(0, 100);
}
function pipelineVolcanoViewport(rows) {
  const xs = rows.map((row) => Math.abs(Number(row.log2FC))).filter(Number.isFinite);
  const ys = rows.map((row) => Number(row.plot_minus_log10_p_value)).filter(Number.isFinite);
  const maxAbsX = Math.max(...xs, 1) * 1.08;
  const maxY = Math.max(...ys, 4) * 1.06;
  const zoom = clamp(Number(state.pipelineDegView.zoom || 1), 1, 30);
  const halfX = Math.max(0.08, maxAbsX / zoom);
  const spanY = Math.max(0.5, maxY / zoom);
  const maxCenterShift = Math.max(0, maxAbsX - halfX);
  state.pipelineDegView.centerX = clamp(state.pipelineDegView.centerX, -maxCenterShift, maxCenterShift);
  state.pipelineDegView.minY = clamp(state.pipelineDegView.minY, 0, Math.max(0, maxY - spanY));
  return { minX: state.pipelineDegView.centerX - halfX, maxX: state.pipelineDegView.centerX + halfX, minY: state.pipelineDegView.minY, maxY: state.pipelineDegView.minY + spanY, spanX: halfX * 2, spanY, zoom };
}
function drawPipelineVolcano(canvas) {
  const rows = pipelineVolcanoFilteredRows(state.data.volcano?.items || []);
  if (!rows.length) return;
  const view = pipelineVolcanoViewport(rows);
  const visible = rows.filter((row) => {
    const x = Number(row.log2FC);
    const y = Number(row.plot_minus_log10_p_value);
    return Number.isFinite(x) && Number.isFinite(y) && x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;
  }).length;
  const zoomLabel = $("#pipeline-volcano-zoom-value");
  if (zoomLabel) zoomLabel.textContent = `${view.zoom.toFixed(1).replace(".0", "")}x`;
  drawScatter(canvas, rows, "log2FC", "plot_minus_log10_p_value", {
    xLabel: "log2FC (Tumor vs Normal)",
    yLabel: "-log10(p-value)",
    minX: view.minX,
    maxX: view.maxX,
    minY: view.minY,
    maxY: view.maxY,
    radius: (row) => row.is_top_candidate ? 4.2 : 2.2,
    alpha: 0.58,
    color: (row) => {
      if (!row.is_deg) return colors.gray;
      return row.deg_direction === "Upregulated" ? colors.red : colors.blue;
    },
    adaptiveLabels: true,
    labelDensityLimit: 70,
    maxLabels: 18,
    labelEligible: (row) => row.is_top_candidate,
    labelText: (row) => row.gene_name,
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><br>log2FC: ${fmt(row.log2FC)}<br>p-value: ${fmt(row.p_value)}<br>Trạng thái: ${row.is_deg ? esc(row.deg_direction) : "Not DEG"}`,
    meta: `${legend([{ label: "Upregulated", color: colors.red }, { label: "Downregulated", color: colors.blue }, { label: "Not DEG", color: colors.gray }])}<div class="axis-note">Mỗi điểm là một gene. Trục X là log2FC, trục Y là -log10(p-value). Đang hiển thị ${fmt(rows.length)} gene; ${fmt(visible)} gene nằm trong vùng zoom hiện tại. Cuộn chuột hoặc pinch trackpad để zoom.</div>`
  });
}
function zoomPipelineVolcanoAt(point, factor) {
  const rows = pipelineVolcanoFilteredRows(state.data.volcano?.items || []);
  if (!rows.length) return;
  const view = pipelineVolcanoViewport(rows);
  const canvas = $("#pipeline-volcano-chart");
  const rect = canvas.getBoundingClientRect();
  const pad = { left: 76, right: 34, top: 30, bottom: 64 };
  const plotW = Math.max(1, rect.width - pad.left - pad.right);
  const plotH = Math.max(1, rect.height - pad.top - pad.bottom);
  const rx = clamp((point.x - pad.left) / plotW, 0, 1);
  const ry = clamp((point.y - pad.top) / plotH, 0, 1);
  const dataX = view.minX + rx * view.spanX;
  const dataY = view.minY + (1 - ry) * view.spanY;
  state.pipelineDegView.zoom = clamp(Number(state.pipelineDegView.zoom || 1) * factor, 1, 30);
  const nextView = pipelineVolcanoViewport(rows);
  state.pipelineDegView.centerX = dataX + (0.5 - rx) * nextView.spanX;
  state.pipelineDegView.minY = dataY - (1 - ry) * nextView.spanY;
  drawPipelineVolcano(canvas);
}
function bindPipelineVolcanoWheel(canvas) {
  if (!canvas || canvas.dataset.pipelineWheelBound === "true") return;
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    hideTooltip();
    zoomPipelineVolcanoAt(canvasPoint(event, canvas), Math.exp(-event.deltaY * 0.0025));
  }, { passive: false });
  canvas.dataset.pipelineWheelBound = "true";
}
function renderPipelineDegVisual(body, slide) {
  const options = [
    { value: "top100", label: "100 gene" },
    { value: "up", label: "Upregulated" },
    { value: "down", label: "Downregulated" },
    { value: "not", label: "Not DEG" }
  ];
  body.innerHTML = `
    <div class="pipeline-volcano-controls" role="group" aria-label="Bộ lọc Volcano plot">
      ${options.map((item) => `<button type="button" class="pipeline-filter-pill${state.pipelineDegFilter === item.value ? " active" : ""}" data-pipeline-deg-filter="${item.value}">${item.label}</button>`).join("")}
      <span>Zoom <output id="pipeline-volcano-zoom-value">${fmt(state.pipelineDegView.zoom)}x</output></span>
    </div>
    <article class="pipeline-mini-chart wide"><canvas id="pipeline-volcano-chart"></canvas></article>
  `;
  body.querySelectorAll("[data-pipeline-deg-filter]").forEach((button) => button.addEventListener("click", () => {
    state.pipelineDegFilter = button.dataset.pipelineDegFilter;
    resetPipelineDegView();
    renderPipelineDegVisual(body, slide);
  }));
  const canvas = $("#pipeline-volcano-chart");
  if (canvas && state.data.volcano?.items?.length) {
    drawPipelineVolcano(canvas);
    bindCanvasTooltipOnce(canvas);
    bindPipelineVolcanoWheel(canvas);
  } else {
    body.innerHTML = pipelineLoading("Volcano plot sẽ hiển thị sau khi mart DE tải xong.");
  }
}
function renderPipelineMappingVisual(body) {
  body.innerHTML = `
    <div class="pipeline-mapping-layout">
      <article class="pipeline-mini-chart"><canvas id="pipeline-mapping-donut"></canvas></article>
      <div class="pipeline-side-stat-list">${renderPipelineStats([
        { label: "DEG đã mapping", compute: "mappedRatio" },
        { label: "Tỷ lệ thành công", compute: "mappingRate", unit: "%" },
        { label: "Mapping confidence", compute: "mappingConfidence" }
      ], "pipeline-side-stat")}</div>
    </div>
    <details class="pipeline-inline-audit"><summary>Xem nhanh gene chưa mapping được</summary><div class="table-wrap" id="pipeline-unmapped-preview"></div></details>
  `;
  const canvas = $("#pipeline-mapping-donut");
  if (canvas && pipelineRows("mappingSummary").length) { drawDonut(canvas, pipelineRows("mappingSummary"), "mapping_status", "gene_count", [colors.green, colors.red], "Tỷ lệ gene DEG mapping thành công sang protein trong STRING."); bindCanvasTooltipOnce(canvas); }
  renderTable($("#pipeline-unmapped-preview"), pipelineRows("unmapped").slice(0, 8), [
    { key: "gene_name", label: "Gene" }, { key: "gene_id_base", label: "Gene ID" }, { key: "log2FC", label: "log2FC" }, { key: "mapping_reason", label: "Lý do" }
  ]);
}
function filteredPipelineNetworkPayload(payload) {
  const source = payload || { nodes: [], edges: [] };
  const geoSupported = state.pipelineNetworkFilters.geoSupported;
  const nodes = geoSupported ? (source.nodes || []).filter((node) => node.geo_support_level && node.geo_support_level !== "Not Found") : (source.nodes || []);
  const ids = new Set(nodes.map((node) => node.protein_id));
  const edges = (source.edges || []).filter((edge) => ids.has(edge.protein_id_src) && ids.has(edge.protein_id_dst));
  return { nodes, edges };
}
function drawPipelineNetwork(canvas, payload) {
  const { ctx, width, height } = canvasContext(canvas);
  const { nodes, edges } = filteredPipelineNetworkPayload(payload);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36;
  const positioned = nodes.map((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const ring = radius * (0.72 + (index % 4) * 0.08);
    return { ...node, x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring, hitRadius: Math.max(6, Math.min(20, Number(node.node_size || 10))) };
  });
  const byId = Object.fromEntries(positioned.map((node) => [node.protein_id, node]));
  edges.forEach((edge) => {
    const src = byId[edge.protein_id_src];
    const dst = byId[edge.protein_id_dst];
    if (!src || !dst) return;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(dst.x, dst.y);
    ctx.strokeStyle = `rgba(56,189,248,${Math.max(0.12, Number(edge.edge_weight_protein || 0.4) * 0.55)})`;
    ctx.lineWidth = Math.max(1, Number(edge.edge_weight_protein || 0.4) * 3);
    ctx.stroke();
  });
  const hits = [];
  const labels = [];
  positioned.forEach((node) => {
    const color = node.deg_direction === "Upregulated" ? colors.red : colors.blue;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = geoSupportColor(node.geo_support_level);
    ctx.lineWidth = 2;
    ctx.stroke();
    labels.push({ row: node, x: node.x, y: node.y, radius: node.hitRadius, bounds: { left: 8, right: width - 8, top: 8, bottom: height - 8 } });
    hits.push({ x: node.x - node.hitRadius, y: node.y - node.hitRadius, w: node.hitRadius * 2, h: node.hitRadius * 2, html: `<strong>${esc(node.gene_name)}</strong><br>Hạng: ${fmt(node.rank)}<br>Weighted degree: ${fmt(node.weighted_degree_protein)}<br>GEO: ${esc(node.geo_support_level)}` });
  });
  drawAdaptiveLabels(ctx, labels, { maxLabels: 12, labelEligible: (node) => Number(node.rank || 999) <= 20, labelText: (node) => node.gene_name });
  registerHits(canvas, hits);
  setMeta(canvas, `${legend([{ label: "Upregulated", color: colors.red }, { label: "Downregulated", color: colors.blue }])}<div class="axis-note">Mỗi node là protein candidate trong mạng STRING PPI. Cạnh thể hiện tương tác protein; viền node biểu thị mức GEO support.</div>`);
}
async function loadPipelineNetwork() {
  const filters = state.pipelineNetworkFilters;
  const params = new URLSearchParams({ top_n: String(filters.topN), min_edge_score: String(filters.minScore) });
  if (filters.direction) params.set("deg_direction", filters.direction);
  state.data.pipelineNetwork = await api(`/api/v1/visualizations/network?${params.toString()}`);
  if (pipelineSlides[state.pipelineIndex]?.id === 6) renderPipelineSlide(false);
}
function renderPipelineNetworkVisual(body) {
  const filters = state.pipelineNetworkFilters;
  body.innerHTML = `
    <div class="pipeline-network-controls">
      <label>Top N <input id="pipeline-network-top" type="range" min="20" max="100" step="10" value="${esc(filters.topN)}"><output>${esc(filters.topN)}</output></label>
      <label>Min score <select id="pipeline-network-min"><option value="0.4"${filters.minScore === 0.4 ? " selected" : ""}>0.4</option><option value="0.7"${filters.minScore === 0.7 ? " selected" : ""}>0.7</option></select></label>
      <label>Chiều DEG <select id="pipeline-network-direction"><option value="">Tất cả</option><option value="Upregulated"${filters.direction === "Upregulated" ? " selected" : ""}>Upregulated</option><option value="Downregulated"${filters.direction === "Downregulated" ? " selected" : ""}>Downregulated</option></select></label>
      <label class="check"><input id="pipeline-network-geo" type="checkbox"${filters.geoSupported ? " checked" : ""}> Chỉ có GEO support</label>
    </div>
    <article class="pipeline-mini-chart wide network"><canvas id="pipeline-network-mini"></canvas></article>
    <div class="pipeline-network-metrics">${renderPipelineStats([
      { label: "Số node", compute: "networkNodes" }, { label: "Số edge", compute: "networkEdges" }, { label: "Avg weighted degree", compute: "avgNetworkDegree" }, { label: "Max STRING score", compute: "maxStringScore" }
    ], "pipeline-network-metric")}</div>
  `;
  const top = $("#pipeline-network-top");
  const output = top?.closest("label")?.querySelector("output");
  top?.addEventListener("input", () => { output.textContent = top.value; });
  top?.addEventListener("change", async () => { state.pipelineNetworkFilters.topN = Number(top.value); await loadPipelineNetwork(); });
  $("#pipeline-network-min")?.addEventListener("change", async (event) => { state.pipelineNetworkFilters.minScore = Number(event.currentTarget.value); await loadPipelineNetwork(); });
  $("#pipeline-network-direction")?.addEventListener("change", async (event) => { state.pipelineNetworkFilters.direction = event.currentTarget.value; await loadPipelineNetwork(); });
  $("#pipeline-network-geo")?.addEventListener("change", (event) => { state.pipelineNetworkFilters.geoSupported = event.currentTarget.checked; renderPipelineSlide(false); });
  const canvas = $("#pipeline-network-mini");
  if (canvas) { drawPipelineNetwork(canvas, activePipelineNetwork()); bindCanvasTooltipOnce(canvas); }
}
function renderPipelineScoringVisual(body, slide) {
  const tabs = slide.visual.tabs;
  const active = state.pipelineVisualTabs[slide.id] || tabs[0];
  if (active === "Xếp hạng") {
    const rows = pipelineRows("targets").slice(0, 8);
    body.innerHTML = rows.length ? `<div class="pipeline-ranked-list">${rows.map((row) => `
      <article>
        <div><strong>#${esc(fmt(row.rank))} ${esc(row.gene_name)}</strong><span>${esc(row.geo_support_level || "NA")}</span></div>
        <div class="pipeline-score-stack" title="Expression / Network / STRING">
          <i class="score-expression" style="width:${clamp(Number(row.expression_score || 0) * 52, 2, 52)}%"></i>
          <i class="score-network" style="width:${clamp(Number(row.protein_network_score || 0) * 30, 2, 30)}%"></i>
          <i class="score-string" style="width:${clamp(Number(row.string_confidence_score || 0) * 18, 2, 18)}%"></i>
        </div>
        <b>${esc(fmt(row.final_score))}</b>
      </article>`).join("")}</div>` : pipelineLoading("Candidate ranking sẽ hiển thị sau khi tải target mart.");
  }
  if (active === "GEO Support") {
    body.innerHTML = `<article class="pipeline-mini-chart wide"><canvas id="pipeline-geo-scatter-mini"></canvas></article>`;
    const canvas = $("#pipeline-geo-scatter-mini");
    if (canvas && pipelineRows("geoScatter").length) {
      drawScatter(canvas, pipelineRows("geoScatter"), "final_score", "geo_support_score", {
        xLabel: "GDC + STRING final_score",
        yLabel: "GEO support score",
        minY: 0,
        maxY: 1,
        radius: (row) => 4 + Math.max(0, 101 - Number(row.rank || 101)) / 42,
        color: (row) => geoSupportColor(row.geo_support_level),
        adaptiveLabels: true,
        labelDensityLimit: 70,
        maxLabels: 18,
        labelText: (row) => row.gene_name,
        tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><br>Final score: ${fmt(row.final_score)}<br>GEO support: ${fmt(row.geo_support_score)}<br>${esc(row.geo_support_level)}`,
        meta: "Mỗi điểm là một candidate. Trục X là final_score từ GDC + STRING; trục Y là GEO support score bổ sung và không đổi ranking chính."
      });
      bindCanvasTooltipOnce(canvas);
    }
  }
  if (active === "Bảng đầy đủ") {
    body.innerHTML = `<div class="table-wrap pipeline-table" id="pipeline-candidate-preview"></div>`;
    renderTable($("#pipeline-candidate-preview"), pipelineRows("targets").slice(0, 20), [
      { key: "rank", label: "Hạng" }, { key: "gene_name", label: "Gene" }, { key: "final_score", label: "Final score" }, { key: "geo_support_score", label: "GEO score" }, { key: "geo_support_level", label: "GEO support" }, { key: "cluster_id", label: "Cluster" }
    ]);
  }
}
function renderPipelineMlVisual(body, slide) {
  const tabs = slide.visual.tabs;
  const active = state.pipelineVisualTabs[slide.id] || tabs[0];
  if (active === "Silhouette score") {
    body.innerHTML = `<article class="pipeline-mini-chart wide"><canvas id="pipeline-ml-k-mini"></canvas></article>`;
    const canvas = $("#pipeline-ml-k-mini");
    if (canvas && pipelineRows("mlK").length) { drawLine(canvas, pipelineRows("mlK"), "k", "silhouette_score", "Silhouette score đo mức độ phân tách giữa các cụm theo từng k. Giá trị gần 1 là phân tách tốt."); bindCanvasTooltipOnce(canvas); }
  }
  if (active === "Scatter plot") {
    body.innerHTML = `<article class="pipeline-mini-chart wide"><canvas id="pipeline-ml-scatter-mini"></canvas></article>`;
    const canvas = $("#pipeline-ml-scatter-mini");
    const rows = state.data.mlScatter?.items || [];
    if (canvas && rows.length) {
      drawScatter(canvas, rows, "abs_log2FC", "weighted_degree_protein", {
        xLabel: "abs(log2FC)",
        yLabel: "weighted degree",
        radius: (row) => 3 + (row.final_score || 0) * 9,
        color: (row) => clusterColors[Math.abs(Number(row.cluster_id || 0)) % clusterColors.length],
        adaptiveLabels: true,
        labelDensityLimit: 58,
        maxLabels: 16,
        tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><br>${esc(clusterFullLabel(row.cluster_id))}<br>Nhãn nguồn: ${esc(row.candidate_group)}`,
        meta: "Mỗi điểm là một candidate protein; màu biểu thị cluster và vị trí cho thấy quan hệ giữa abs(log2FC) và weighted degree."
      });
      bindCanvasTooltipOnce(canvas);
    } else body.innerHTML = pipelineLoading("Scatter plot sẽ hiển thị sau khi tải ML mart.");
  }
  if (active === "Chi tiết cụm") {
    body.innerHTML = `<div class="pipeline-cluster-cards">${pipelineRows("mlSummary").map((row) => `<article><strong>Cluster ${esc(row.cluster_id)}</strong><span>${esc(fmt(row.num_candidates))} proteins</span><p>${esc(row.cluster_interpretation || clusterInterpretation(row.cluster_id))}</p></article>`).join("")}</div><div class="table-wrap pipeline-table" id="pipeline-cluster-table-mini"></div>`;
    renderTable($("#pipeline-cluster-table-mini"), pipelineRows("mlClusters"), [
      { key: "cluster_id", label: "Cluster" }, { key: "cluster_interpretation", label: "Diễn giải" }, { key: "num_candidates", label: "Số candidate" }, { key: "avg_abs_log2FC", label: "Avg abs log2FC" }, { key: "avg_weighted_degree", label: "Avg weighted degree" }
    ]);
  }
}
function openPipelineModal(actionIndex) {
  const slide = pipelineSlides[state.pipelineIndex];
  const action = slide.actions?.[actionIndex];
  if (!action) return;
  $("#pipeline-modal-kicker").textContent = `Bước ${slide.id} · ${slide.shortLabel}`;
  $("#pipeline-modal-title").textContent = action.title;
  $("#pipeline-modal-body").innerHTML = `${(action.body || []).map((text) => `<p>${esc(text)}</p>`).join("")}${action.dynamic ? `<div class="table-wrap pipeline-modal-table" id="pipeline-modal-dynamic"></div>` : ""}`;
  const dynamic = $("#pipeline-modal-dynamic");
  if (dynamic && action.dynamic === "qcExclusions") renderTable(dynamic, pipelineRows("qcExclusions"), [{ key: "exclusion_reason", label: "Lý do" }, { key: "sample_count", label: "Samples" }]);
  if (dynamic && action.dynamic === "unmappedGenes") renderTable(dynamic, pipelineRows("unmapped").slice(0, 80), [{ key: "gene_name", label: "Gene" }, { key: "gene_id_base", label: "Gene ID" }, { key: "log2FC", label: "log2FC" }, { key: "p_value", label: "p-value" }, { key: "mapping_reason", label: "Lý do" }]);
  if (dynamic && action.dynamic === "topProteins") renderTable(dynamic, pipelineRows("networkTop").slice(0, 30), [{ key: "gene_name", label: "Gene" }, { key: "protein_id", label: "Protein ID" }, { key: "weighted_degree_protein", label: "Weighted degree" }, { key: "avg_combined_score", label: "Avg STRING" }, { key: "geo_support_level", label: "GEO" }]);
  $("#pipeline-modal")?.classList.add("open");
  $("#pipeline-modal")?.setAttribute("aria-hidden", "false");
  $("#pipeline-modal-backdrop")?.classList.add("open");
  document.body.classList.add("pipeline-modal-open");
}
function closePipelineModal() {
  $("#pipeline-modal")?.classList.remove("open");
  $("#pipeline-modal")?.setAttribute("aria-hidden", "true");
  $("#pipeline-modal-backdrop")?.classList.remove("open");
  document.body.classList.remove("pipeline-modal-open");
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
    { key: "samples_before_qc", label: "Trước QC", color: colors.gray },
    { key: "samples_after_qc", label: "Sau QC", color: colors.green }
  ], { x: "sample_group", y: "số sample", text: "<br>Pass QC nghĩa là sample không bị gắn cờ outlier về library size hoặc số gene phát hiện được." });
  drawVerticalBars($("#qc-exclusion-chart"), state.data.qcExclusions.items, "exclusion_reason", "sample_count", { rotate: false, color: () => colors.red, meta: "<strong>Lý do loại sample:</strong> lấy từ các cờ boolean trong quality_check. Trục X là lý do; trục Y là số sample bị loại." });
  drawHistogram($("#qc-library-chart"), state.data.qcLibrary.items, "number_of_samples", "<strong>Library size:</strong> histogram của total_raw_count từ quality_check. Trục X là bin raw count; trục Y là số sample; màu theo sample_group.");
  drawHistogram($("#qc-zero-chart"), state.data.qcZero.items, "number_of_samples", "<strong>Tỷ lệ zero gene:</strong> histogram của pct_zero_genes từ quality_check. Trục X là tỷ lệ gene có count bằng 0; trục Y là số sample.");
}
async function renderDeg() {
  const highlight = Number($("#volcano-highlight").value || 20);
  state.data.volcano = await api(`/api/v1/visualizations/deg/volcano?max_points=20000&highlight_top_n=${highlight}`);
  redrawVolcano();
  drawVerticalBars($("#deg-summary-chart"), state.data.degSummary.items, "deg_direction", "gene_count", { rotate: false, color: (row) => row.deg_direction === "Upregulated" ? colors.red : row.deg_direction === "Downregulated" ? colors.blue : colors.gray, meta: "Trục X là trạng thái DEG; trục Y là số gene. Màu giữ nguyên theo Upregulated, Downregulated và Not DEG." });
  drawBar($("#top-deg-chart"), state.data.topDeg.items.slice(0, 18), "gene_name", "abs_log2FC", { color: (row) => row.log2FC >= 0 ? colors.red : colors.blue, meta: "Các gene DEG top được sắp theo abs(log2FC). Chiều dài cột là abs(log2FC); màu cho biết chiều Up/Down." });
  drawHeatmap($("#heatmap-chart"), state.data.heatmap);
}
function renderMapping() {
  drawDonut($("#mapping-summary-chart"), state.data.mappingSummary.items, "mapping_status", "gene_count", [colors.green, colors.red], "Donut cho thấy tỷ lệ DEG mapping được sang STRING protein_id ở Phase 3; phần chưa mapping là DEG không có protein tương ứng trong STRING gene_map.");
  drawVerticalBars($("#mapping-confidence-chart"), state.data.mappingConfidence.items, "gene_confidence", "number_of_proteins", { rotate: false, color: (_, i) => clusterColors[i], meta: "Trục X là STRING gene_confidence; trục Y là số protein đã mapping." });
  renderTable($("#unmapped-table"), state.data.unmapped.items, [
    { key: "gene_name", label: "Gene", help: "Gene symbol của DEG từ Phase 2." }, { key: "gene_id_base", label: "Gene ID", help: "Ensembl gene ID đã bỏ version suffix." }, { key: "log2FC", label: "log2FC", help: help.log2FC }, { key: "p_value", label: "p-value", help: help.p_value }, { key: "mapping_status", label: "Trạng thái", help: help.mapping_status }, { key: "mapping_reason", label: "Lý do", help: help.mapping_reason }
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
  drawBar($("#network-top-chart"), state.data.networkTop.items.slice(0, 15), "gene_name", "weighted_degree_protein", { color: () => colors.cyan, meta: "Trục X là weighted_degree_protein; trục Y là gene. Giá trị cao hơn nghĩa là kết nối STRING rộng hoặc mạnh hơn." });
  drawHistogram($("#network-score-chart"), state.data.networkScores.items, "number_of_edges", "<strong>Phân phối STRING score:</strong> Trục X là edge_weight_protein = combined_score_protein / 1000; trục Y là số cạnh STRING thật trong nhóm top target đã chọn.");
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
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>Hạng: ${fmt(row.rank)}<br>log2FC: ${fmt(row.log2FC)}<br>Weighted degree: ${fmt(row.weighted_degree_protein)}<br>Avg STRING: ${fmt(row.avg_combined_score)}<br>Final score: ${fmt(row.final_score)}<br>GEO support: ${esc(row.geo_support_level)}<br>Support score: ${fmt(row.geo_support_score)}`,
    meta: "Các gene/protein được xếp hạng theo điểm tổng hợp từ expression, network và STRING confidence. Chiều dài cột là final_score; GEO support là bằng chứng bổ sung."
  });
  renderTable($("#candidate-table"), rows, [
    { key: "rank", label: "Hạng" }, { key: "gene_name", label: "Gene" }, { key: "protein_id", label: "STRING protein ID" }, { key: "log2FC", label: "log2FC" }, { key: "p_value", label: "p-value" }, { key: "weighted_degree_protein", label: "Weighted degree" }, { key: "avg_combined_score", label: "Avg STRING" }, { key: "final_score", label: "Final score" }, { key: "geo_support_score", label: "GEO score" }, { key: "geo_support_level", label: "GEO support" }, { key: "cluster_id", label: "Cluster" }, { key: "cluster_interpretation", label: "Diễn giải cluster" }
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
    "Donut tóm tắt GEO support theo coverage và expression percentile trong tumor-only cohort; đây không phải validation Tumor-vs-Normal."
  );
  drawBar($("#geo-top-supported-chart"), (state.data.geoTopSupported.items || []).slice(0, 15), "gene_name", "geo_support_score", {
    color: (row) => geoSupportColor(row.geo_support_level),
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>Hạng GEO support: ${fmt(row.geo_support_rank)}<br>Hạng GDC: ${fmt(row.rank)}<br>Support score: ${fmt(row.geo_support_score)}<br>Coverage: ${fmt(row.geo_coverage_rate)}<br>Mean percentile: ${fmt(row.geo_mean_percentile)}<br>Top-quartile rate: ${fmt(row.geo_top_quartile_rate)}<br>Mức: ${esc(row.geo_support_level)}`,
    meta: "Các candidate có GEO support cao nhất được sắp theo geo_support_score giảm dần; GDC rank dùng để phá hòa."
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
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>Hạng GDC: ${fmt(row.rank)}<br>Final score: ${fmt(row.final_score)}<br>GEO support score: ${fmt(row.geo_support_score)}<br>Coverage: ${fmt(row.geo_coverage_rate)}<br>Mean percentile: ${fmt(row.geo_mean_percentile)}<br>Top-quartile rate: ${fmt(row.geo_top_quartile_rate)}<br>Mức: ${esc(row.geo_support_level)}`,
    meta: `${legend(Object.entries(geoSupportColors).map(([label, color]) => ({ label, color })))}<div class="axis-note">Trục X là final_score chính từ GDC + STRING. Trục Y là GEO support trong tumor-only cohort và không làm đổi ranking.</div>`
  });
  renderTable($("#geo-overlap-table"), state.data.geoOverlap.items || [], [
    { key: "rank", label: "Hạng GDC", help: help.rank }, { key: "gene_name", label: "Gene", help: help.gene_name }, { key: "protein_id", label: "STRING protein ID", help: help.protein_id }, { key: "final_score", label: "Final score", help: help.final_score }, { key: "geo_support_score", label: "GEO score", help: help.geo_support_score }, { key: "geo_support_level", label: "Mức support", help: help.geo_support_level }, { key: "geo_coverage_rate", label: "Coverage", help: help.geo_coverage_rate }, { key: "geo_mean_percentile", label: "Mean percentile", help: help.geo_mean_percentile }, { key: "geo_top_quartile_rate", label: "Top quartile rate", help: help.geo_top_quartile_rate }
  ], false);
  renderTable($("#geo-unmatched-table"), state.data.geoUnmatched.items || [], [
    { key: "rank", label: "Hạng" }, { key: "gene_name", label: "Gene" }, { key: "protein_id", label: "STRING protein ID", help: help.protein_id }, { key: "final_score", label: "Final score", help: help.final_score }, { key: "geo_support_level", label: "Mức support", help: help.geo_support_level }, { key: "geo_match_reason", label: "Lý do match GEO", help: help.geo_match_reason }
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
    tooltip: (row) => `<strong>${esc(row.gene_name)}</strong><small>${esc(row.protein_id)}</small><br>${esc(clusterFullLabel(row.cluster_id))}<br>abs_log2FC: ${fmt(row.abs_log2FC)}<br>Weighted degree: ${fmt(row.weighted_degree_protein)}<br>Avg STRING: ${fmt(row.avg_combined_score)}<br>Final score: ${fmt(row.final_score)}`,
    meta: `${legend([...new Set(rows.map((row) => row.cluster_id))].sort((a, b) => Number(a) - Number(b)).map((cluster) => ({ label: clusterFullLabel(cluster), color: clusterColors[Math.abs(Number(cluster || 0)) % clusterColors.length] })))}<div class="axis-note">Mỗi điểm là một candidate protein. KMeans gán điểm vào centroid gần nhất theo 4 feature đã chuẩn hóa; không có ngưỡng điểm cố định. Trục X/Y chỉ hiển thị 2 trong 4 feature.</div>`
  });
}
function renderMlExplainability() {
  const explain = state.data.mlExplain || { assignment: {}, items: [] };
  const assignment = explain.assignment || {};
  const note = $("#ml-assignment-note");
  if (note) note.innerHTML = `<strong>Candidate vào cluster bằng cách nào?</strong><p>${esc(assignment.rule || "Không có dữ liệu giải thích.")}</p><div>${(assignment.features || []).map((feature) => `<span><b>${esc(feature.model_key)}</b>${esc(feature.meaning)}</span>`).join("")}</div><small>${esc(assignment.note || "")}</small>`;
  drawVerticalBars($("#ml-top100-chart"), explain.items || [], "cluster_id", "top_100_count", { rotate: false, color: (row) => clusterColors[Math.abs(Number(row.cluster_id || 0)) % clusterColors.length], meta: "Số gene trong bảng xếp hạng Top 100 thuộc từng cluster. Tổng bằng 100; cluster có giá trị 0 không có gene nào trong Top 100." });
  const profiles = $("#ml-cluster-profiles");
  if (profiles) profiles.innerHTML = (explain.items || []).map((row) => {
    const ranges = row.feature_ranges || {};
    const range = (key) => `${fmt(ranges[key]?.min)} / ${fmt(ranges[key]?.median)} / ${fmt(ranges[key]?.max)}`;
    return `<article class="ml-profile-card" style="--cluster-color:${clusterColors[Math.abs(Number(row.cluster_id || 0)) % clusterColors.length]}"><div class="ml-profile-head"><span>Cluster ${esc(row.cluster_id)}</span><strong>${esc(row.cluster_interpretation)}</strong></div><div class="ml-profile-stats"><span><b>${esc(fmt(row.num_candidates))}</b> toàn bộ candidate</span><span><b>${esc(fmt(row.top_100_count))}</b> gene trong Top 100</span><span><b>${esc(fmt(row.top_100_percentage))}%</b> của Top 100</span></div><dl><div><dt>|log2FC| min / median / max</dt><dd>${esc(range("abs_log2FC"))}</dd></div><div><dt>Weighted degree min / median / max</dt><dd>${esc(range("weighted_degree_protein"))}</dd></div><div><dt>Avg STRING min / median / max</dt><dd>${esc(range("avg_combined_score"))}</dd></div><div><dt>DEG interactions min / median / max</dt><dd>${esc(range("num_interactions_in_deg_network"))}</dd></div></dl><p><b>Top gene đại diện:</b> ${esc((row.top_genes || []).join(", ") || "Không có gene Top 100")}</p></article>`;
  }).join("");
  renderTable($("#ml-top100-table"), explain.items || [], [
    { key: "cluster_id", label: "Cluster" }, { key: "cluster_interpretation", label: "Diễn giải riêng" }, { key: "num_candidates", label: "Toàn bộ candidate" }, { key: "population_percentage", label: "% toàn bộ" }, { key: "top_100_count", label: "Gene Top 100" }, { key: "top_100_percentage", label: "% Top 100" }, { key: "top_100_capture_rate", label: "% thành viên lọt Top 100" }
  ]);
}
async function renderMl() {
  const cluster = $("#ml-cluster").value;
  const topOnly = $("#ml-top-only").checked;
  const params = new URLSearchParams({ limit: "5000", top_only: String(topOnly) });
  if (cluster) params.set("cluster_id", cluster);
  state.data.mlScatter = await api(`/api/v1/visualizations/ml/scatter?${params.toString()}`);
  drawLine($("#ml-k-chart"), state.data.mlK.items, "k", "silhouette_score", "Trục X là số cụm k; trục Y là silhouette score. Giá trị cao hơn nghĩa là cụm tách tốt hơn.");
  drawMlScatter();
  drawVerticalBars($("#ml-summary-chart"), state.data.mlSummary.items, "cluster_id", "num_candidates", { rotate: false, color: (row) => clusterColors[Math.abs(Number(row.cluster_id || 0)) % clusterColors.length], meta: "Trục X là cluster_id; trục Y là số candidate protein trong toàn bộ 2.579 candidate." });
  renderMlExplainability();
  renderTable($("#ml-cluster-table"), state.data.mlClusters.items, [
    { key: "cluster_id", label: "Cluster" }, { key: "cluster_interpretation", label: "Diễn giải riêng" }, { key: "candidate_group", label: "Nhãn nguồn" }, { key: "num_candidates", label: "Số candidate" }, { key: "avg_abs_log2FC", label: "Avg abs log2FC" }, { key: "avg_weighted_degree", label: "Avg weighted degree" }, { key: "avg_combined_score", label: "Avg STRING" }, { key: "avg_final_score", label: "Avg final score" }
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
  div.innerHTML = `<small>${role === "user" ? "Bạn" : "Trợ lý"}</small>${esc(text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
async function initializeData() {
  const health = await api("/api/v1/health");
  state.data.health = health;
  $("#health-label").textContent = `API sẵn sàng (${health.mart_source || "json"}, dữ liệu thật)`;
  $(".status-dot").classList.add("ok");
  $(".status-dot").classList.remove("error");
  const calls = [
    ["overview", "/api/v1/overview"], ["qcSamples", "/api/v1/visualizations/qc/sample-counts"], ["qcExclusions", "/api/v1/visualizations/qc/exclusions"], ["qcLibrary", "/api/v1/visualizations/qc/library-size"], ["qcZero", "/api/v1/visualizations/qc/zero-gene-rate"], ["degSummary", "/api/v1/visualizations/deg/summary"], ["topDeg", "/api/v1/visualizations/deg/top-genes?limit=50"], ["heatmap", "/api/v1/visualizations/deg/heatmap?top_n=24"], ["mappingSummary", "/api/v1/visualizations/mapping/summary"], ["mappingConfidence", "/api/v1/visualizations/mapping/confidence"], ["unmapped", "/api/v1/mapping/unmapped"], ["networkTop", "/api/v1/visualizations/network/top-proteins?limit=100"], ["networkScores", "/api/v1/visualizations/network/score-distribution"], ["geoSummary", "/api/v1/visualizations/geo/summary"], ["geoTopSupported", "/api/v1/visualizations/geo/top-supported?limit=100"], ["geoScatter", "/api/v1/visualizations/geo/gdc-vs-support"], ["geoOverlap", "/api/v1/visualizations/geo/top-candidate-overlap?limit=100"], ["geoUnmatched", "/api/v1/geo/unmatched-candidates"], ["mlK", "/api/v1/visualizations/ml/k-selection"], ["mlSummary", "/api/v1/visualizations/ml/cluster-summary"], ["mlClusters", "/api/v1/ml/clusters"], ["mlExplain", "/api/v1/visualizations/ml/explainability"]
  ];
  const entries = await Promise.all(calls.map(async ([key, path]) => [key, await api(path)]));
  state.data = { ...state.data, ...Object.fromEntries(entries) };
  populateClusterControls();
}

async function renderAll() {
  renderOverview(state.data.overview);
  renderQc();
  await renderDeg();
  renderMapping();
  await renderNetwork();
  await renderRanking();
  renderGeo();
  await renderMl();
  renderPipelineSlide(false);
}
function panVolcano(dx, dy) {
  const rows = filteredVolcanoRows(state.data.volcano?.items || []);
  const view = volcanoViewport(rows.length ? rows : state.data.volcano?.items || []);
  const canvas = $("#volcano-chart");
  const rect = canvas.getBoundingClientRect();
  const plotW = Math.max(1, rect.width - 76 - 34);
  const plotH = Math.max(1, rect.height - 30 - 64);
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
  const plotW = Math.max(1, rect.width - 76 - 34);
  const plotH = Math.max(1, rect.height - 30 - 64);
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
  const pad = { left: 76, right: 34, top: 30, bottom: 64 };
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
  const pad = { left: 76, right: 34, top: 30, bottom: 64 };
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
  bindSidebarTooltips();
  document.querySelectorAll("canvas").forEach(bindCanvasTooltipOnce);
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
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { setDrawerOpen(false); closePipelineModal(); } });
  $("#pipeline-modal-close")?.addEventListener("click", closePipelineModal);
  $("#pipeline-modal-backdrop")?.addEventListener("click", closePipelineModal);
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
  addChatMessage("assistant", "Trợ lý AI đang ở chế độ thử nghiệm giao diện; dữ liệu dashboard lấy từ mart hiện tại của project.");
  try {
    await initializeData();
    await renderAll();
  } catch (error) {
    $("#health-label").textContent = "Không tải được API/data";
    $(".status-dot").classList.add("error");
    addChatMessage("assistant", `Không tải được dữ liệu dashboard: ${error.message}`);
  }
});
