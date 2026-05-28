// --- 1. Định nghĩa Kiểu dữ liệu (TypeScript Interfaces) ---

export interface VolcanoPoint {
  gene: string;
  log2fc: number;
  p_value: number;
  neg_log10_p: number;
  status: "Up-regulated" | "Down-regulated" | "Not Significant";
}

export interface HeatmapData {
  patients: string[];
  genes: string[];
  z_values: number[][]; // Ma trận nồng độ biểu hiện (TPM)
}

// --- 2. Tạo Dữ liệu giả lập ---

// Dữ liệu Volcano Plot (Mô phỏng 100 gene)
export const mockVolcanoData: VolcanoPoint[] = Array.from({ length: 100 }).map((_, i) => {
  const log2fc = (Math.random() - 0.5) * 6; // Từ -3 đến 3
  const p_value = Math.abs(log2fc) > 1.5 ? Math.random() * 0.049 : Math.random() * 0.95 + 0.05;
  const neg_log10_p = -Math.log10(p_value);
  
  let status: VolcanoPoint["status"] = "Not Significant";
  if (p_value < 0.05) {
    if (log2fc > 1.5) status = "Up-regulated";
    if (log2fc < -1.5) status = "Down-regulated";
  }

  // Gắn tên cho một số gene "đầu sỏ"
  const geneNames = ["EGFR", "TP53", "KRAS", "ALK", "ROS1", "BRAF"];
  const gene = i < geneNames.length ? geneNames[i] : `GENE_${i}`;

  return { gene, log2fc, p_value, neg_log10_p, status };
});

// Dữ liệu Heatmap (So sánh 5 Normal vs 5 Tumor trên 5 Gene mục tiêu)
export const mockHeatmapData: HeatmapData = {
  patients: ["N1", "N2", "N3", "N4", "N5", "T1", "T2", "T3", "T4", "T5"], // N: Normal, T: Tumor
  genes: ["EGFR", "TP53", "KRAS", "ALK", "BRAF"],
  z_values: [
    [1.2, 1.5, 1.1, 1.8, 1.3, 8.5, 9.1, 8.2, 7.9, 9.5], // EGFR tăng vọt ở Tumor
    [2.1, 2.3, 2.0, 2.5, 2.2, 7.8, 8.0, 7.5, 8.1, 7.9], // TP53 tăng
    [5.5, 5.2, 5.8, 5.1, 5.6, 1.2, 1.5, 1.1, 1.0, 1.4], // KRAS lại giảm (ví dụ)
    [3.1, 3.2, 3.0, 3.5, 3.1, 3.2, 3.4, 3.1, 3.5, 3.3], // ALK không đổi
    [4.0, 4.2, 4.1, 4.5, 4.0, 6.5, 6.8, 6.2, 6.9, 7.1], // BRAF tăng nhẹ
  ]
};

// Dữ liệu Network Graph (Mạng lưới tương tác Protein STRING)
export const mockNetworkElements = [
  // Nodes (Các Protein) - pagerank mô phỏng độ quan trọng
  { data: { id: "EGFR", label: "EGFR", pagerank: 0.9, cluster: "C1" } },
  { data: { id: "KRAS", label: "KRAS", pagerank: 0.8, cluster: "C1" } },
  { data: { id: "TP53", label: "TP53", pagerank: 0.95, cluster: "C2" } },
  { data: { id: "GRB2", label: "GRB2", pagerank: 0.6, cluster: "C1" } },
  { data: { id: "MDM2", label: "MDM2", pagerank: 0.7, cluster: "C2" } },
  
  // Edges (Tương tác) - weight là Confidence Score từ STRING
  { data: { source: "EGFR", target: "KRAS", weight: 0.9 } },
  { data: { source: "EGFR", target: "GRB2", weight: 0.8 } },
  { data: { source: "GRB2", target: "KRAS", weight: 0.7 } },
  { data: { source: "TP53", target: "MDM2", weight: 0.95 } },
  { data: { source: "EGFR", target: "TP53", weight: 0.4 } }, // Tương tác chéo cụm
];