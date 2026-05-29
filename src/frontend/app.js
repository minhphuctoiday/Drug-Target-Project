const $ = (id) => document.getElementById(id);
const fmt = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
const metricInfo = {
  target_score: "DA-driven target priority from expression dysregulation, FDR, GEO signal, prevalence and PPI-aware evidence.",
  protein_ml_priority_score: "Unsupervised ML priority from Isolation Forest, GMM rarity, KMeans cluster priority and evidence prior.",
  gdc_log2_fc: "Tumor-vs-normal log2 fold change. Positive values are higher in tumor samples.",
  gdc_adj_p_value: "Multiple-testing adjusted p-value/FDR for differential expression.",
  degree_gene: "STRING PPI degree for the encoded protein node.",
  pagerank: "STRING PPI graph influence score for the encoded protein node.",
  model_importance: "Auxiliary classifier feature contribution. This supports phenotype separation, not target causality.",
};

let inputScale = "log2_tpm";
let volcanoData = [];
let networkData = { nodes: [], edges: [] };
let heatmapData = { genes: [], samples: [], matrix: [] };
let heatmapSamples = 80;
let targetsData = [];
let importanceData = [];
let enrichedData = [];
let selectedGene = null;
let networkFocusTop20 = false;
let userNavigated = false;
const chartState = {
  volcano: { zoom: 1, panX: 0, panY: 0 },
  heatmap: { zoom: 1, panX: 0, panY: 0 },
  network: { zoom: 1, panX: 0, panY: 0 },
};
let dragState = null;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json();
}

function parseExpression(text) {
  const expression = {};
  text.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return;
    const [gene, value] = clean.split(/[,\t ]+/);
    const number = Number(value);
    if (gene && Number.isFinite(number)) expression[gene.toUpperCase()] = number;
  });
  return expression;
}

function renderTable(target, rows, columns) {
  if (!rows.length) {
    target.innerHTML = `<div class="empty-state"><strong>No rows</strong><span>Adjust filters or search another protein-coding gene.</span></div>`;
    return;
  }
  const head = columns.map((col) => `<th${metricInfo[col.key] ? ` title="${metricInfo[col.key]}"` : ""}>${col.label}${metricInfo[col.key] ? " <span class=\"info-dot\">i</span>" : ""}</th>`).join("");
  const body = rows.map((row) => {
    const cells = columns.map((col) => {
      const raw = row[col.key];
      const value = col.format ? col.format(raw, row) : raw ?? "-";
      const cls = col.key.includes("rank") ? " class=\"rank\"" : "";
      const title = metricInfo[col.key] ? `${metricInfo[col.key]} Value: ${String(value).replaceAll('"', "'")}` : String(value ?? "-").replaceAll('"', "'");
      return `<td${cls} title="${title}">${value}</td>`;
    }).join("");
    const gene = row.gene_name_norm || "";
    const selected = selectedGene && gene === selectedGene ? " class=\"selected\"" : "";
    return `<tr${selected} data-gene="${gene}">${cells}</tr>`;
  }).join("");
  target.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  target.querySelectorAll("tbody tr[data-gene]").forEach((row) => {
    row.addEventListener("click", () => openGeneDrawer(row.dataset.gene));
  });
}

function setLoading(id, label = "Loading artifact data") {
  const el = $(id);
  if (el) el.innerHTML = `<div class="skeleton-state"><span></span><span></span><span></span><strong>${label}</strong></div>`;
}

function setSelectedGene(gene, options = {}) {
  selectedGene = gene || null;
  updateSelectionContext(options.row || null);
  renderTargets();
  renderImportanceHighlight();
  drawVolcano();
  drawNetwork();
}

function findTargetRow(gene) {
  if (!gene) return null;
  return (
    enrichedData.find((row) => row.gene_name_norm === gene) ||
    targetsData.find((row) => row.gene_name_norm === gene) ||
    importanceData.find((row) => row.gene_name_norm === gene) ||
    null
  );
}

function updateSelectionContext(row = null) {
  const bar = $("selection-bar");
  if (!bar) return;
  if (!selectedGene) {
    bar.classList.add("hidden");
    $("chat-question").placeholder = "Ask a project-grounded question in English...";
    updateChatPrompts();
    return;
  }
  const data = row || findTargetRow(selectedGene) || {};
  bar.classList.remove("hidden");
  $("selected-target-title").textContent = `${data.protein_target || selectedGene} (${selectedGene})`;
  $("selected-target-subtitle").textContent = `rank ${data.target_rank ?? data.integrated_evidence_rank ?? "-"} | target score ${fmt(data.target_score, 3)} | ML priority ${fmt(data.protein_ml_priority_score, 3)}`;
  $("chat-question").placeholder = `Ask about ${selectedGene} evidence, rank, PPI context, or limitations...`;
  updateChatPrompts(selectedGene);
}

function updateChatPrompts(gene = selectedGene) {
  const prompts = document.querySelectorAll(".chat-prompts button");
  if (!prompts.length) return;
  if (gene) {
    prompts[0].textContent = `${gene} rationale`;
    prompts[0].dataset.question = `Why is ${gene} prioritized as a candidate protein target in this project?`;
    prompts[1].textContent = `${gene} evidence`;
    prompts[1].dataset.question = `Summarize the artifact evidence for ${gene}, including rank, score, expression and STRING PPI context.`;
    prompts[2].textContent = `${gene} limits`;
    prompts[2].dataset.question = `What are the scientific limitations when interpreting ${gene} as a candidate target?`;
  } else {
    prompts[0].textContent = "PLK1 rationale";
    prompts[0].dataset.question = "Why is PLK1 prioritized as a candidate protein target?";
    prompts[1].textContent = "Primary model";
    prompts[1].dataset.question = "What is the primary ML model in this project?";
    prompts[2].textContent = "Limitations";
    prompts[2].dataset.question = "What are the main scientific limitations?";
  }
}

function renderContributions(rows) {
  if (!rows.length) {
    $("contribution-list").innerHTML = "No coefficient-level explanation available for this model.";
    return;
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.contribution || 0)), 1e-9);
  $("contribution-list").innerHTML = rows.map((row) => {
    const width = Math.max(4, Math.abs(row.contribution || 0) / max * 100);
    const cls = row.contribution < 0 ? "gene-item negative" : "gene-item";
    const direction = row.contribution < 0 ? "Normal-like" : "Tumor-like";
    return `
      <div class="${cls}">
        <strong>${row.gene_name_norm}</strong>
        <div class="bar"><span style="width:${width}%"></span></div>
        <small>${direction} ${fmt(Math.abs(row.contribution), 3)}</small>
      </div>`;
  }).join("");
}

async function loadModel() {
  const health = await api("/api/health");
  if ($("health-status")) {
    $("health-status").textContent = "API online";
    $("health-status").previousElementSibling?.classList?.add("ok");
  }
  if ($("model-chip")) $("model-chip").textContent = `${health.model} | ${health.features} expression features`;
  const info = await api("/api/model");
  const rankerSummary = info.protein_target_ranker?.summary || {};
  const metrics = info.test_metrics || {};
  $("metric-auc").textContent = rankerSummary.n_targets ? Number(rankerSummary.n_targets).toLocaleString() : "-";
  $("metric-bal").textContent = rankerSummary.n_clusters ?? "-";
  $("metric-features").textContent = rankerSummary.n_features ?? "-";
  renderModelCard(info);
  renderConfusion(metrics.confusion_matrix || [[0, 0], [0, 0]]);
  const allMetrics = await api("/api/metrics");
  renderKpis(allMetrics);
  const project = await api("/api/project");
  renderProjectFabric(project);
}

function renderKpis(data) {
  const da = data.da_summary || {};
  const model = data.model || {};
  const validated = (da.geo_validation_counts || []).find((row) => row[0] === "validated")?.[1] ?? "-";
  $("kpi-master").textContent = da.master_rows?.toLocaleString?.() || "-";
  $("kpi-edges").textContent = da.network?.graph_edges?.toLocaleString?.() || "-";
  $("kpi-geo").textContent = Number(validated).toLocaleString();
  const top = (da.top_20_targets || [])[0];
  $("kpi-top").textContent = top?.gene_name_norm || "-";
  $("kpi-top-score").textContent = top ? `score ${fmt(top.target_score, 3)} | ${model.model_name}` : "Target score";
  $("insight-summary").textContent = top
    ? `Top DA-ranked candidate is ${top.gene_name_norm} with target score ${fmt(top.target_score, 3)}. The workspace links ${Number(da.network?.graph_edges || 0).toLocaleString()} STRING PPI edges, GEO validation and an unsupervised protein target ranker.`
    : "Cross-filter protein targets, volcano evidence, model features and STRING PPI network from the same artifact layer.";
}

function renderProjectFabric(project) {
  const sources = (project.data_sources || []).map((s) => {
    const sampleText = s.samples
      ? Object.entries(s.samples).map(([k, v]) => `${k}: ${v}`).join(" | ")
      : (s.high_confidence_edges ? `${Number(s.high_confidence_edges).toLocaleString()} edges` : "refined parquet");
    return `<div class="source-pill"><span>${s.name}</span><span>${sampleText}</span></div>`;
  }).join("");
  const steps = [
    {
      title: "1. Multi-source ingestion",
      body: "TCGA/GDC expression, GEO validation and STRING PPI form the input evidence layer.",
      tag: "GEO | STRING | TCGA",
      extra: `<div class="source-grid">${sources}</div>`,
    },
    {
      title: "2. Refined Parquet lake",
      body: "Clean expression and PPI tables are stored as columnar artifacts for fast analytical scans.",
      tag: "Parquet evidence lake",
    },
    {
      title: "3. Distributed analytics layer",
      body: "DE, FDR, GEO signal, STRING centrality and target score are generated as reusable features.",
      tag: "Spark-style DA",
    },
    {
      title: "4. Protein target ranker",
      body: "Unsupervised ML clusters and ranks candidate protein targets from DA, PPI and evidence features.",
      tag: "Isolation Forest + GMM + KMeans",
    },
    {
      title: "5. Research BI workspace",
      body: "Dashboard cross-filters protein targets, volcano, heatmap, PPI network, ML priority and reports.",
      tag: "Interactive visualization",
    },
  ];
  $("fabric-flow").innerHTML = steps.map((step, index) => `
    <div class="fabric-step ${step.extra ? "has-extra" : ""}" style="--step-index:${index}">
      <div class="fabric-node">${index + 1}</div>
      <strong>${step.title.replace(/^\d+\.\s*/, "")}</strong>
      <p>${step.body}</p>
      ${step.extra || ""}
      <span class="badge tag">${step.tag}</span>
    </div>
  `).join("");
}

function renderModelCard(info) {
  const ranker = info.protein_target_ranker || {};
  const summary = ranker.summary || {};
  const top = (summary.top_30 || [])[0] || {};
  const available = ranker.available ? "Available" : "Missing artifact";
  const featureText = summary.n_features ? `${summary.n_features} evidence features` : "DA/PPI evidence features";
  const targetText = summary.n_targets ? Number(summary.n_targets).toLocaleString() : "-";
  const clusterText = summary.n_clusters ? `${summary.n_clusters} clusters` : "-";
  $("model-card").innerHTML = `
    <div class="primary-model-hero">
      <span>${available}</span>
      <strong>Unsupervised protein target prioritization</strong>
      <small>Ranks candidate protein targets directly from expression, STRING PPI and evidence features.</small>
    </div>
    <div class="model-line"><span>Algorithm</span><strong>Isolation Forest + GMM + KMeans</strong></div>
    <div class="model-line"><span>Targets ranked</span><strong>${targetText}</strong></div>
    <div class="model-line"><span>Feature space</span><strong>${featureText}</strong></div>
    <div class="model-line"><span>Target clusters</span><strong>${clusterText}</strong></div>
    <div class="model-line"><span>Top ML priority</span><strong>${top.encoded_by_gene ? `${top.encoded_by_gene} (${fmt(top.protein_ml_priority_score, 3)})` : "-"}</strong></div>
    <div class="model-note">This is the main ML model for the project objective. It has no confusion matrix because it is unsupervised and does not use target/non-target labels.</div>
  `;
  renderAuxiliaryModelCard(info);
}

function renderAuxiliaryModelCard(info) {
  const metrics = info.test_metrics || {};
  const ci = info.bootstrap_ci || {};
  $("auxiliary-card").innerHTML = `
    <div class="model-line"><span>Model</span><strong>${info.model_name}</strong></div>
    <div class="model-line"><span>Role</span><strong>secondary expression probe</strong></div>
    <div class="model-line"><span>Threshold</span><strong>${fmt(info.threshold, 4)}</strong></div>
    <div class="model-line"><span>Balanced accuracy</span><strong>${fmt(metrics.balanced_accuracy, 4)}</strong></div>
    <div class="model-line"><span>Macro F1 95% CI</span><strong>${ci.macro_f1 ? `${fmt(ci.macro_f1.ci95_low, 3)} - ${fmt(ci.macro_f1.ci95_high, 3)}` : "-"}</strong></div>
    <div class="model-note">Confusion matrix below describes tumor-like expression separation only. It is supporting evidence, not the protein target ranker.</div>
  `;
}

function renderConfusion(cm) {
  $("confusion").innerHTML = `
    <div><span>Normal-like -> Normal-like</span><strong>${cm[0]?.[0] ?? 0}</strong></div>
    <div><span>Normal-like -> Tumor-like</span><strong>${cm[0]?.[1] ?? 0}</strong></div>
    <div><span>Tumor-like -> Normal-like</span><strong>${cm[1]?.[0] ?? 0}</strong></div>
    <div><span>Tumor-like -> Tumor-like</span><strong>${cm[1]?.[1] ?? 0}</strong></div>
  `;
}

async function loadTargets(q = "") {
  const data = await api(`/api/targets?limit=500${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  targetsData = data.items;
  const enriched = await api("/api/targets/enriched?limit=80");
  enrichedData = enriched.items;
  renderTargets();
  renderEvidenceChart();
}

function renderTargets() {
  const q = $("target-search").value.trim().toUpperCase();
  const evidence = $("evidence-filter").value;
  const minScore = Number($("score-filter").value);
  $("score-filter-value").textContent = fmt(minScore, 2);
  let rows = targetsData.filter((row) => {
    const haystack = `${row.gene_name_norm || ""} ${row.protein_target || ""}`.toUpperCase();
    const matchGene = !q || haystack.includes(q);
    const matchEvidence = !evidence || row.evidence_level === evidence;
    const matchScore = Number(row.target_score || 0) >= minScore;
    return matchGene && matchEvidence && matchScore;
  }).slice(0, 100);
  renderTable($("target-table"), rows, [
    { key: "target_rank", label: "#" },
    { key: "protein_target", label: "Protein target" },
    { key: "encoded_by_gene", label: "Encoded gene" },
    { key: "target_score", label: "Score", format: (v) => fmt(v, 3) },
    { key: "protein_ml_priority_score", label: "ML priority", format: (v) => fmt(v, 3) },
    { key: "protein_target_cluster", label: "Cluster" },
    { key: "druggability_class", label: "Druggability" },
    { key: "gdc_log2_fc", label: "log2FC", format: (v) => fmt(v, 2) },
    { key: "geo_validation_status", label: "GEO" },
    { key: "evidence_level", label: "Evidence" },
  ]);
  updateSelectionContext();
}

async function loadEnrichment() {
  const data = await api("/api/enrichment");
  renderTable($("pathway-table"), data.items, [
    { key: "pathway", label: "Pathway" },
    { key: "overlap_count", label: "Overlap" },
    { key: "fdr", label: "FDR", format: (v) => Number(v).toExponential(2) },
    { key: "overlap_genes", label: "Encoded genes" },
  ]);
}

function renderEvidenceChart() {
  const rows = enrichedData.slice(0, 20);
  const legend = `
    <div class="evidence-legend">
      <span><i class="legend-dot" style="background:var(--green)"></i>Expression</span>
      <span><i class="legend-dot" style="background:var(--cyan)"></i>Network</span>
      <span><i class="legend-dot" style="background:var(--amber)"></i>Validation</span>
      <span><i class="legend-dot" style="background:var(--blue)"></i>Druggability</span>
      <span><i class="legend-dot" style="background:var(--red)"></i>Model</span>
      <span><i class="legend-dot" style="background:#c084fc"></i>Survival</span>
    </div>`;
  $("evidence-chart").innerHTML = legend + rows.map((row) => {
    const expr = Math.max(0.04, Number(row.expression_component || 0));
    const net = Math.max(0.04, Number(row.network_component || 0));
    const val = Math.max(0.04, Number(row.validation_component || 0));
    const drug = Math.max(0.04, Number(row.druggability_score || 0));
    const model = Math.max(0.04, Number(row.model_component || 0));
    const surv = Math.max(0.04, Number(row.survival_component || 0));
    return `
      <div class="evidence-row" data-gene="${row.gene_name_norm}">
        <strong>${row.gene_name_norm}</strong>
        <div class="stack" style="--expr:${expr}fr;--net:${net}fr;--val:${val}fr;--drug:${drug}fr;--model:${model}fr;--surv:${surv}fr">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <small>${fmt(row.integrated_evidence_score, 3)}</small>
      </div>`;
  }).join("");
  $("evidence-chart").querySelectorAll("[data-gene]").forEach((el) => el.addEventListener("click", () => openGeneDrawer(el.dataset.gene)));
}

async function loadImportance() {
  const data = await api("/api/feature-importance?limit=80");
  importanceData = data.items;
  renderTable($("importance-table"), importanceData, [
    { key: "protein_target", label: "Protein target" },
    { key: "encoded_by_gene", label: "Encoded gene" },
    { key: "model_importance", label: "Importance", format: (v) => fmt(v, 4) },
    { key: "target_rank", label: "Target rank" },
    { key: "target_score", label: "Target score", format: (v) => fmt(v, 3) },
    { key: "evidence_level", label: "Evidence" },
  ]);
}

function drawVolcano() {
  const canvas = $("volcano-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#06100f";
  ctx.fillRect(0, 0, w, h);
  const pad = 42;
  const xs = volcanoData.map((d) => Number(d.gdc_log2_fc)).filter(Number.isFinite);
  const ys = volcanoData.map((d) => Number(d.gdc_neg_log10_fdr)).filter(Number.isFinite);
  const minX = Math.min(-5, ...xs), maxX = Math.max(5, ...xs);
  const maxY = Math.max(10, ...ys);
  const xScale = (x) => pad + (x - minX) / (maxX - minX) * (w - pad * 2);
  const yScale = (y) => h - pad - y / maxY * (h - pad * 2);
  const state = chartState.volcano;
  const tx = (x, y) => ({
    x: (x - w / 2) * state.zoom + w / 2 + state.panX,
    y: (y - h / 2) * state.zoom + h / 2 + state.panY,
  });
  ctx.strokeStyle = "rgba(237,248,243,.22)";
  ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad); ctx.stroke();
  volcanoData.forEach((d) => {
    const x = Number(d.gdc_log2_fc), y = Number(d.gdc_neg_log10_fdr);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const rank = Number(d.target_rank || 99999);
    const isSelected = selectedGene && d.gene_name_norm === selectedGene;
    ctx.fillStyle = isSelected ? "#ffcd72" : rank <= 100 ? "#31d69b" : x > 1 ? "rgba(99,215,255,.48)" : x < -1 ? "rgba(255,107,121,.48)" : "rgba(138,163,155,.26)";
    const p = tx(xScale(x), yScale(y));
    ctx.beginPath(); ctx.arc(p.x, p.y, isSelected ? 7 : rank <= 100 ? 3.2 : 1.6, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = "#8aa39b";
  ctx.font = "12px system-ui";
  ctx.fillText("log2 fold change", w / 2 - 44, h - 12);
  ctx.save(); ctx.translate(14, h / 2 + 52); ctx.rotate(-Math.PI / 2); ctx.fillText("-log10 FDR", 0, 0); ctx.restore();
}

async function loadVolcano() {
  const data = await api("/api/volcano?limit=20000");
  volcanoData = data.items;
  drawVolcano();
}

function heatColor(v) {
  const x = Math.max(-2.5, Math.min(2.5, Number(v) || 0)) / 2.5;
  if (x >= 0) {
    const g = Math.round(50 + (1 - x) * 70);
    const b = Math.round(120 + (1 - x) * 90);
    return `rgb(255,${g},${b})`;
  }
  const r = Math.round(70 + (1 + x) * 90);
  const g = Math.round(170 + (1 + x) * 55);
  return `rgb(${r},${g},255)`;
}

function drawHeatmap() {
  const canvas = $("heatmap-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#06100f";
  ctx.fillRect(0, 0, w, h);
  const genes = heatmapData.genes || [];
  const samples = heatmapData.samples || [];
  const matrix = heatmapData.matrix || [];
  if (!genes.length || !samples.length) return;
  const left = 90, top = 18, right = 8, bottom = 28;
  const state = chartState.heatmap;
  const baseCellW = (w - left - right) / samples.length;
  const baseCellH = (h - top - bottom) / genes.length;
  const cellW = baseCellW * state.zoom;
  const cellH = baseCellH * state.zoom;
  matrix.forEach((row, i) => row.forEach((value, j) => {
    ctx.fillStyle = heatColor(value);
    ctx.fillRect(left + state.panX + j * cellW, top + state.panY + i * cellH, Math.max(1, cellW + 0.3), Math.max(1, cellH + 0.3));
  }));
  const selectedIndex = selectedGene ? genes.findIndex((gene) => gene === selectedGene) : -1;
  if (selectedIndex >= 0) {
    ctx.strokeStyle = "#ffcd72";
    ctx.lineWidth = 2;
    ctx.strokeRect(left + state.panX, top + state.panY + selectedIndex * cellH, samples.length * cellW, Math.max(3, cellH));
  }
  ctx.fillStyle = "#cfe4dd";
  ctx.font = "10px system-ui";
  genes.forEach((gene, i) => {
    if (i % Math.ceil(genes.length / 28) === 0) ctx.fillText(gene, 8, top + state.panY + i * cellH + cellH * 0.75);
  });
  ctx.fillStyle = "#8aa39b";
  ctx.fillText(`${samples.length} samples | ${heatmapData.scale || "row z-score"}`, left, h - 9);
}

async function loadHeatmap() {
  heatmapData = await api(`/api/heatmap?genes=42&samples=${heatmapSamples}`);
  drawHeatmap();
}

function showHeatmapTooltip(evt) {
  const canvas = $("heatmap-canvas");
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const y = (evt.clientY - rect.top) * (canvas.height / rect.height);
  const left = 90, top = 18, right = 8, bottom = 28;
  const genes = heatmapData.genes || [];
  const samples = heatmapData.samples || [];
  const state = chartState.heatmap;
  const cellW = ((canvas.width - left - right) / samples.length) * state.zoom;
  const cellH = ((canvas.height - top - bottom) / genes.length) * state.zoom;
  const j = Math.floor((x - left - state.panX) / cellW);
  const i = Math.floor((y - top - state.panY) / cellH);
  const tip = $("heatmap-tooltip");
  if (i < 0 || j < 0 || i >= genes.length || j >= samples.length) {
    tip.style.display = "none";
    return;
  }
  tip.style.left = `${evt.clientX + 14}px`;
  tip.style.top = `${evt.clientY + 14}px`;
  tip.innerHTML = `<strong>${genes[i]}</strong><br/>sample ${samples[j].slice(0, 8)}...<br/>z-score ${fmt(heatmapData.matrix[i][j], 2)}`;
  tip.style.display = "block";
}

function hideHeatmapTooltip() {
  $("heatmap-tooltip").style.display = "none";
}

function drawNetwork() {
  const canvas = $("network-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#06100f";
  ctx.fillRect(0, 0, w, h);
  const nodes = networkLayoutNodes();
  const idToNode = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const state = chartState.network;
  const tx = (x, y) => ({
    x: (x - w / 2) * state.zoom + w / 2 + state.panX,
    y: (y - h / 2) * state.zoom + h / 2 + state.panY,
  });
  ctx.strokeStyle = "rgba(99,215,255,.12)";
  (networkData.edges || []).forEach((e) => {
    const s = idToNode[e.data.source], t = idToNode[e.data.target];
    if (!s || !t) return;
    const sp = tx(s.x, s.y);
    const tp = tx(t.x, t.y);
    ctx.lineWidth = Math.max(0.4, Number(e.data.weight || 0.2) * 1.6);
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
  });
  nodes.forEach((n) => {
    const isSelected = selectedGene && n.id === selectedGene;
    const size = isSelected ? 10 : Number(n.rank) <= 20 ? 6 : 3.6;
    const p = tx(n.x, n.y);
    ctx.fillStyle = isSelected ? "#ffcd72" : Number(n.rank) <= 20 ? "#31d69b" : "#63d7ff";
    ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill();
    if (Number(n.rank) <= 18) {
      ctx.fillStyle = "#edf8f3"; ctx.font = "11px system-ui"; ctx.fillText(n.label, p.x + 8, p.y + 4);
    }
  });
}

async function loadNetwork() {
  networkData = await api("/api/network");
  drawNetwork();
}

async function openGeneDrawer(gene) {
  selectedGene = gene;
  let report = {};
  try { report = await api(`/api/gene/${encodeURIComponent(gene)}`); } catch (_) { report = {}; }
  const target = targetsData.find((row) => row.gene_name_norm === gene) || {};
  const imp = importanceData.find((row) => row.gene_name_norm === gene) || {};
  const enriched = enrichedData.find((row) => row.gene_name_norm === gene) || report.features || {};
  const volc = volcanoData.find((row) => row.gene_name_norm === gene) || {};
  const pathways = report.report?.pathways || [];
  const tags = report.report?.druggability_tags || String(enriched.druggability_tags || "").split("|").filter(Boolean);
  const targetScore = target.target_score ?? imp.target_score ?? enriched.target_score;
  const mlScore = enriched.protein_ml_priority_score ?? target.protein_ml_priority_score;
  const expressionComponent = Number(enriched.expression_component || 0);
  const networkComponent = Number(enriched.network_component || 0);
  const validationComponent = Number(enriched.validation_component || 0);
  const drugComponent = Number(enriched.druggability_score || 0);
  const modelComponent = Number(enriched.model_component || imp.model_importance || 0);
  const survivalComponent = Number(enriched.survival_component || 0);
  $("drawer-content").innerHTML = `
    <div class="drawer-hero">
      <span class="badge">${enriched.evidence_level || target.evidence_level || imp.evidence_level || "candidate"}</span>
      <h3>${enriched.protein_target || report.protein_target || gene}</h3>
      <p>Encoded by <strong>${gene}</strong> | STRING PPI protein-target evidence sheet</p>
    </div>
    <div class="drawer-scoreline">
      <div><small>Target rank</small><strong>#${target.target_rank ?? imp.target_rank ?? "-"}</strong></div>
      <div><small>Target score</small><strong>${fmt(targetScore, 3)}</strong></div>
      <div><small>ML priority</small><strong>${fmt(mlScore, 3)}</strong></div>
    </div>
    <p class="muted">${report.report?.summary || "Evidence is assembled from expression dysregulation, GEO validation, STRING PPI network context, druggability and auxiliary ML interpretation."}</p>
    <h4>Evidence decomposition</h4>
    <div class="drawer-evidence-stack">
      ${evidenceBar("Expression", expressionComponent, "var(--green)")}
      ${evidenceBar("Network", networkComponent, "var(--cyan)")}
      ${evidenceBar("Validation", validationComponent, "var(--amber)")}
      ${evidenceBar("Druggability", drugComponent, "var(--blue)")}
      ${evidenceBar("Model", modelComponent, "var(--red)")}
      ${evidenceBar("Survival", survivalComponent, "#c084fc")}
    </div>
    <div class="drawer-metrics">
      <div title="${metricInfo.gdc_log2_fc}"><small>log2FC</small><strong>${fmt(target.gdc_log2_fc ?? volc.gdc_log2_fc, 3)}</strong></div>
      <div title="${metricInfo.gdc_adj_p_value}"><small>-log10 FDR</small><strong>${fmt(target.gdc_neg_log10_fdr ?? volc.gdc_neg_log10_fdr, 2)}</strong></div>
      <div title="${metricInfo.degree_gene}"><small>STRING degree</small><strong>${enriched.degree_gene ?? target.degree_gene ?? "-"}</strong></div>
      <div title="${metricInfo.pagerank}"><small>PageRank</small><strong>${fmt(enriched.pagerank ?? target.pagerank, 6)}</strong></div>
      <div><small>ML protein rank</small><strong>${enriched.protein_ml_rank ?? target.protein_ml_rank ?? "-"}</strong></div>
      <div><small>Target cluster</small><strong>${enriched.protein_target_cluster ?? target.protein_target_cluster ?? "-"}</strong></div>
      <div><small>GEO validation</small><strong>${target.geo_validation_status || enriched.geo_validation_status || "-"}</strong></div>
      <div title="${metricInfo.model_importance}"><small>Aux model importance</small><strong>${fmt(imp.model_importance, 4)}</strong></div>
      <div><small>Druggability</small><strong>${enriched.druggability_class || "-"}</strong></div>
      <div><small>Survival FDR</small><strong>${fmt(enriched.survival_time_fdr, 3)}</strong></div>
    </div>
    <h4>Evidence timeline</h4>
    <div class="evidence-timeline">
      <span>TCGA/GDC expression</span>
      <span>GEO validation</span>
      <span>STRING PPI context</span>
      <span>Unsupervised ranker</span>
      <span>Research decision</span>
    </div>
    <h4>Druggability tags</h4>
    <p>${tags.map((tag) => `<span class="badge">${tag}</span>`).join(" ") || '<span class="muted">No curated annotation</span>'}</p>
    <h4>Enriched biological programs</h4>
    <p class="muted">${pathways.length ? pathways.join(", ") : "No curated top-target pathway overlap found."}</p>
    <p class="muted">Use this drill-down to distinguish auxiliary classifier utility from protein target priority. A feature can help phenotype separation without being a strong therapeutic target.</p>
    <div class="actions">
      <button onclick="document.getElementById('chat-question').value='Explain ${gene} as a candidate LUAD protein target'; document.getElementById('chat-send').click(); location.hash='assistant';">Ask assistant</button>
      <button onclick="window.open('/api/gene/${gene}/report', '_blank')">Export report</button>
      <button onclick="document.getElementById('compare-input').value='${gene},PLK1,TOP2A,SPP1'; document.getElementById('compare-run').click(); location.hash='model';">Compare</button>
    </div>
  `;
  $("gene-drawer").classList.add("open");
  updateSelectionContext(enriched || target || imp);
  renderTargets();
  renderImportanceHighlight();
  drawVolcano();
  drawHeatmap();
  drawNetwork();
}

function evidenceBar(label, value, color) {
  const width = Math.max(3, Math.min(100, Number(value || 0) * 100));
  return `<div class="drawer-evidence-row"><span>${label}</span><div><i style="width:${width}%;background:${color}"></i></div><strong>${fmt(value, 2)}</strong></div>`;
}

function renderImportanceHighlight() {
  renderTable($("importance-table"), importanceData, [
    { key: "protein_target", label: "Protein target" },
    { key: "encoded_by_gene", label: "Encoded gene" },
    { key: "model_importance", label: "Importance", format: (v) => fmt(v, 4) },
    { key: "target_rank", label: "Target rank" },
    { key: "target_score", label: "Target score", format: (v) => fmt(v, 3) },
    { key: "protein_ml_priority_score", label: "ML priority", format: (v) => fmt(v, 3) },
    { key: "evidence_level", label: "Evidence" },
  ]);
}

function nearestVolcanoPoint(evt) {
  const canvas = $("volcano-canvas");
  const rect = canvas.getBoundingClientRect();
  const mx = (evt.clientX - rect.left) * (canvas.width / rect.width);
  const my = (evt.clientY - rect.top) * (canvas.height / rect.height);
  const pad = 42;
  const xs = volcanoData.map((d) => Number(d.gdc_log2_fc)).filter(Number.isFinite);
  const ys = volcanoData.map((d) => Number(d.gdc_neg_log10_fdr)).filter(Number.isFinite);
  const minX = Math.min(-5, ...xs), maxX = Math.max(5, ...xs), maxY = Math.max(10, ...ys);
  const xScale = (x) => pad + (x - minX) / (maxX - minX) * (canvas.width - pad * 2);
  const yScale = (y) => canvas.height - pad - y / maxY * (canvas.height - pad * 2);
  const state = chartState.volcano;
  const tx = (x, y) => ({
    x: (x - canvas.width / 2) * state.zoom + canvas.width / 2 + state.panX,
    y: (y - canvas.height / 2) * state.zoom + canvas.height / 2 + state.panY,
  });
  let best = null;
  let bestDist = 14;
  for (const d of volcanoData) {
    const x = Number(d.gdc_log2_fc), y = Number(d.gdc_neg_log10_fdr);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const p = tx(xScale(x), yScale(y));
    const dist = Math.hypot(mx - p.x, my - p.y);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

function showVolcanoTooltip(evt) {
  const point = nearestVolcanoPoint(evt);
  const tip = $("volcano-tooltip");
  if (!point) {
    tip.style.display = "none";
    return;
  }
  tip.style.left = `${evt.clientX + 14}px`;
  tip.style.top = `${evt.clientY + 14}px`;
  tip.innerHTML = `<strong>${point.gene_name_norm}</strong><br/>log2FC ${fmt(point.gdc_log2_fc, 3)}<br/>FDR -log10 ${fmt(point.gdc_neg_log10_fdr, 2)}<br/>rank ${point.target_rank ?? "-"}`;
  tip.style.display = "block";
}

function hideVolcanoTooltip() {
  $("volcano-tooltip").style.display = "none";
}

function getCanvasPoint(evt, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * (canvas.width / rect.width),
    y: (evt.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function redrawChart(chart) {
  if (chart === "volcano") drawVolcano();
  if (chart === "heatmap") drawHeatmap();
  if (chart === "network") drawNetwork();
}

function zoomChart(chart, factor, center = null) {
  const state = chartState[chart];
  const canvas = $(`${chart}-canvas`);
  const before = state.zoom;
  const next = Math.max(0.5, Math.min(6, before * factor));
  if (next === before) return;
  const pivot = center || { x: canvas.width / 2, y: canvas.height / 2 };
  state.panX = pivot.x - ((pivot.x - state.panX - canvas.width / 2) / before) * next - canvas.width / 2;
  state.panY = pivot.y - ((pivot.y - state.panY - canvas.height / 2) / before) * next - canvas.height / 2;
  state.zoom = next;
  redrawChart(chart);
}

function resetChart(chart) {
  chartState[chart] = { zoom: 1, panX: 0, panY: 0 };
  redrawChart(chart);
}

function fullscreenChart(chart) {
  const panel = $(`${chart}-canvas`)?.closest(".panel");
  if (!panel) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  panel.requestFullscreen?.();
}

function startChartDrag(chart, evt) {
  const canvas = $(`${chart}-canvas`);
  const p = getCanvasPoint(evt, canvas);
  dragState = { chart, x: p.x, y: p.y, total: 0, moved: false };
  canvas.classList.add("dragging");
}

function moveChartDrag(chart, evt) {
  if (!dragState || dragState.chart !== chart) return false;
  const canvas = $(`${chart}-canvas`);
  const p = getCanvasPoint(evt, canvas);
  const step = Math.hypot(p.x - dragState.x, p.y - dragState.y);
  dragState.total += step;
  if (dragState.total > 3) dragState.moved = true;
  chartState[chart].panX += p.x - dragState.x;
  chartState[chart].panY += p.y - dragState.y;
  dragState.x = p.x;
  dragState.y = p.y;
  redrawChart(chart);
  return true;
}

function endChartDrag(chart) {
  if (dragState?.chart === chart) dragState = null;
  $(`${chart}-canvas`)?.classList.remove("dragging");
}

function bindChartInteractions(chart, handlers = {}) {
  const canvas = $(`${chart}-canvas`);
  let suppressClick = false;
  canvas.addEventListener("mousedown", (evt) => startChartDrag(chart, evt));
  canvas.addEventListener("mousemove", (evt) => {
    if (moveChartDrag(chart, evt)) return;
    handlers.hover?.(evt);
  });
  canvas.addEventListener("mouseleave", () => {
    endChartDrag(chart);
    handlers.leave?.();
  });
  canvas.addEventListener("mouseup", () => {
    suppressClick = Boolean(dragState?.moved);
    endChartDrag(chart);
  });
  canvas.addEventListener("wheel", (evt) => {
    evt.preventDefault();
    const factor = evt.deltaY < 0 ? 1.16 : 0.86;
    zoomChart(chart, factor, getCanvasPoint(evt, canvas));
  }, { passive: false });
  canvas.addEventListener("click", (evt) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    handlers.click?.(evt);
  });
}

function networkLayoutNodes() {
  const canvas = $("network-canvas");
  const w = canvas.width, h = canvas.height;
  const nodesRaw = (networkData.nodes || []).map((n) => n.data).filter((n) => !networkFocusTop20 || Number(n.rank) <= 20);
  const nodes = nodesRaw.slice(0, 100).map((n, i) => ({ ...n, i }));
  const cx = w / 2, cy = h / 2;
  nodes.forEach((n, i) => {
    const r = 48 + (i % 4) * 42 + (Number(n.rank) <= 20 ? 12 : 0);
    const a = i / Math.max(nodes.length, 1) * Math.PI * 2;
    n.x = cx + Math.cos(a) * (r + 110);
    n.y = cy + Math.sin(a) * (r + 70);
  });
  return nodes;
}

function nearestNetworkNode(evt) {
  const canvas = $("network-canvas");
  const m = getCanvasPoint(evt, canvas);
  const state = chartState.network;
  let best = null;
  let bestDist = 16;
  networkLayoutNodes().forEach((n) => {
    const x = (n.x - canvas.width / 2) * state.zoom + canvas.width / 2 + state.panX;
    const y = (n.y - canvas.height / 2) * state.zoom + canvas.height / 2 + state.panY;
    const dist = Math.hypot(m.x - x, m.y - y);
    if (dist < bestDist) {
      best = n;
      bestDist = dist;
    }
  });
  return best;
}

function openCommand() {
  $("command-modal").classList.add("open");
  $("command-input").value = "";
  renderCommandResults("");
  $("command-input").focus();
}

function renderCommandResults(query) {
  const q = query.trim().toUpperCase();
  const commands = [
    { group: "Actions", title: "Load demo expression", subtitle: "Run the secondary expression probe on a held-out profile", action: loadDemo },
    { group: "Actions", title: "Focus top 20 network", subtitle: "Show only highest-ranked target nodes", action: () => { networkFocusTop20 = true; drawNetwork(); location.hash = "network"; } },
    { group: "Actions", title: "Show high evidence protein targets", subtitle: "Filter target table", action: () => { $("evidence-filter").value = "high"; renderTargets(); location.hash = "targets"; } },
    { group: "Docs", title: "Open metric docs", subtitle: "Understand target score, ML priority, FDR and PPI metrics", action: () => { window.location.href = "/docs-page#metrics"; } },
    { group: "Views", title: "Open model evidence", subtitle: "Primary ranker and supporting classifier cards", action: () => { location.hash = "model"; } },
  ];
  const geneResults = targetsData
    .filter((row) => !q || `${row.gene_name_norm || ""} ${row.protein_target || ""}`.toUpperCase().includes(q))
    .slice(0, 8)
    .map((row) => ({ group: "Protein targets", title: row.protein_target || row.gene_name_norm, subtitle: `${row.gene_name_norm} | rank ${row.target_rank} | score ${fmt(row.target_score, 3)} | ML ${fmt(row.protein_ml_priority_score, 3)}`, action: () => openGeneDrawer(row.gene_name_norm) }));
  const all = [...commands.filter((c) => !q || c.title.toUpperCase().includes(q)), ...geneResults].slice(0, 10);
  $("command-results").innerHTML = all.map((item, i) => `<div class="command-result" data-index="${i}"><div><em>${item.group}</em><strong>${item.title}</strong><small>${item.subtitle}</small></div><span>Enter</span></div>`).join("");
  $("command-results").querySelectorAll(".command-result").forEach((el) => el.addEventListener("click", () => {
    const item = all[Number(el.dataset.index)];
    $("command-modal").classList.remove("open");
    item.action();
  }));
}

async function predict() {
  const expression = parseExpression($("expression-input").value);
  if (!Object.keys(expression).length) {
    alert("Paste at least one protein-coding gene,value pair or load a demo expression profile.");
    return;
  }
  const result = await api("/api/predict", {
    method: "POST",
    body: JSON.stringify({ expression, input_scale: inputScale, top_k: 12 }),
  });
  $("prediction-label").textContent = result.label === "Tumor" ? "Tumor-like profile" : "Normal-like profile";
  $("prediction-label").style.color = result.label === "Tumor" ? "var(--red)" : "var(--green)";
  $("probability-value").textContent = `${fmt(result.probability_tumor * 100, 1)}%`;
  $("probability-bar").style.width = `${Math.min(100, Math.max(0, result.probability_tumor * 100))}%`;
  $("confidence-value").textContent = fmt(result.confidence, 3);
  $("threshold-value").textContent = fmt(result.threshold, 4);
  $("supplied-value").textContent = result.supplied_features;
  $("missing-value").textContent = result.missing_features;
  renderContributions(result.top_contributions);
}

async function loadDemo() {
  const sample = await api("/api/demo-sample?split=test&index=0");
  inputScale = sample.input_scale;
  document.querySelectorAll(".segmented button").forEach((b) => b.classList.toggle("selected", b.dataset.scale === inputScale));
  const lines = Object.entries(sample.expression).slice(0, 2000).map(([gene, value]) => `${gene},${value}`);
  $("expression-input").value = lines.join("\n");
  await predict();
}

async function askChat() {
  const question = $("chat-question").value.trim();
  if (!question) return;
  $("chat-answer").innerHTML = `<div class="chat-loading"><span></span><span></span><span></span>Retrieving project knowledge...</div>`;
  const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ question, limit: 4 }) });
  const sources = data.sources.map((s) => `<span>${s.source}${s.chunk_id ? `#${s.chunk_id}` : ""}${s.title ? ` | ${s.title}` : ""}</span>`).join("");
  $("chat-answer").innerHTML = `
    <div class="chat-message user"><small>You</small><p>${escapeHtml(question)}</p></div>
    <div class="chat-message bot"><small>Project chatbot ${data.mode ? `| ${escapeHtml(data.mode)}` : ""}</small><p>${escapeHtml(data.answer)}</p></div>
    <div class="source-chips">${sources || "<span>No retrieved source</span>"}</div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function compareGenes() {
  const genes = $("compare-input").value.trim();
  if (!genes) return;
  const data = await api(`/api/compare?genes=${encodeURIComponent(genes)}`);
  renderCompareChips(data.items);
  renderTable($("compare-table"), data.items, [
    { key: "protein_target", label: "Protein target" },
    { key: "encoded_by_gene", label: "Encoded gene" },
    { key: "integrated_evidence_rank", label: "Evidence rank" },
    { key: "integrated_evidence_score", label: "Evidence", format: (v) => fmt(v, 3) },
    { key: "target_rank", label: "Target rank" },
    { key: "target_score", label: "Target", format: (v) => fmt(v, 3) },
    { key: "protein_ml_priority_score", label: "ML priority", format: (v) => fmt(v, 3) },
    { key: "protein_target_cluster", label: "Cluster" },
    { key: "druggability_class", label: "Druggability" },
    { key: "drug_class", label: "Class" },
    { key: "known_drugs", label: "Known drugs" },
    { key: "survival_time_fdr", label: "Survival FDR", format: (v) => fmt(v, 3) },
  ]);
}

function renderCompareChips(items) {
  $("compare-chips").innerHTML = items.map((item) => `
    <button type="button" data-gene="${item.encoded_by_gene}">
      <strong>${item.encoded_by_gene}</strong>
      <span>${fmt(item.target_score, 3)} target | ${fmt(item.protein_ml_priority_score, 3)} ML</span>
    </button>
  `).join("");
  $("compare-chips").querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => openGeneDrawer(btn.dataset.gene)));
}

function setInitialLoadingStates() {
  ["target-table", "pathway-table", "importance-table", "compare-table"].forEach((id) => setLoading(id));
  $("evidence-chart").innerHTML = `<div class="skeleton-state"><span></span><span></span><span></span><strong>Loading evidence decomposition</strong></div>`;
}

function bindEvents() {
  const revealItems = document.querySelectorAll("main > section, .kpi-card, .fabric-step");
  revealItems.forEach((el) => el.classList.add("reveal"));
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  revealItems.forEach((el) => revealObserver.observe(el));

  document.querySelectorAll("nav a[href^='#']").forEach((link) => link.addEventListener("click", () => {
    userNavigated = true;
    document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a === link));
  }));
  document.querySelectorAll(".segmented button").forEach((btn) => btn.addEventListener("click", () => {
    inputScale = btn.dataset.scale;
    document.querySelectorAll(".segmented button").forEach((b) => b.classList.toggle("selected", b === btn));
  }));
  $("predict-button").addEventListener("click", predict);
  $("load-demo").addEventListener("click", loadDemo);
  $("clear-input").addEventListener("click", () => { $("expression-input").value = ""; });
  $("target-search").addEventListener("input", (e) => loadTargets(e.target.value));
  $("evidence-filter").addEventListener("change", renderTargets);
  $("score-filter").addEventListener("input", renderTargets);
  $("chat-send").addEventListener("click", askChat);
  $("chat-question").addEventListener("keydown", (e) => { if (e.key === "Enter") askChat(); });
  document.querySelectorAll(".chat-prompts button").forEach((btn) => btn.addEventListener("click", () => {
    $("chat-question").value = btn.dataset.question || "";
    askChat();
  }));
  $("compare-run").addEventListener("click", compareGenes);
  $("compare-input").addEventListener("keydown", (e) => { if (e.key === "Enter") compareGenes(); });
  document.querySelectorAll(".compare-presets button").forEach((btn) => btn.addEventListener("click", () => {
    $("compare-input").value = btn.dataset.preset || "";
    compareGenes();
  }));
  $("selected-clear").addEventListener("click", () => { selectedGene = null; $("gene-drawer").classList.remove("open"); updateSelectionContext(); renderTargets(); renderImportanceHighlight(); drawVolcano(); drawHeatmap(); drawNetwork(); });
  $("selected-ask").addEventListener("click", () => {
    if (!selectedGene) return;
    $("chat-question").value = `Summarize the artifact evidence for ${selectedGene} as a candidate LUAD protein target.`;
    location.hash = "assistant";
    askChat();
  });
  $("selected-report").addEventListener("click", () => { if (selectedGene) window.open(`/api/gene/${selectedGene}/report`, "_blank"); });
  $("drawer-close").addEventListener("click", () => { selectedGene = null; $("gene-drawer").classList.remove("open"); updateSelectionContext(); renderTargets(); renderImportanceHighlight(); drawVolcano(); drawHeatmap(); drawNetwork(); });
  bindChartInteractions("volcano", {
    hover: showVolcanoTooltip,
    leave: hideVolcanoTooltip,
    click: (evt) => { const p = nearestVolcanoPoint(evt); if (p) openGeneDrawer(p.gene_name_norm); },
  });
  $("network-reset").addEventListener("click", () => { networkFocusTop20 = false; drawNetwork(); });
  $("network-top20").addEventListener("click", () => { networkFocusTop20 = true; drawNetwork(); });
  $("heatmap-more").addEventListener("click", () => { heatmapSamples = Math.min(200, heatmapSamples + 40); loadHeatmap(); });
  $("heatmap-less").addEventListener("click", () => { heatmapSamples = 60; loadHeatmap(); });
  bindChartInteractions("heatmap", {
    hover: showHeatmapTooltip,
    leave: hideHeatmapTooltip,
  });
  bindChartInteractions("network", {
    click: (evt) => { const node = nearestNetworkNode(evt); if (node) openGeneDrawer(node.id); },
  });
  document.querySelectorAll(".chart-toolbar button").forEach((btn) => btn.addEventListener("click", () => {
    const chart = btn.closest(".chart-toolbar")?.dataset.chart;
    const action = btn.dataset.action;
    if (!chart) return;
    if (action === "zoom-in") zoomChart(chart, 1.22);
    if (action === "zoom-out") zoomChart(chart, 0.82);
    if (action === "reset") resetChart(chart);
    if (action === "fullscreen") fullscreenChart(chart);
  }));
  document.addEventListener("fullscreenchange", () => {
    drawVolcano();
    drawHeatmap();
    drawNetwork();
  });
  $("open-command").addEventListener("click", openCommand);
  $("command-modal").addEventListener("click", (e) => { if (e.target.id === "command-modal") $("command-modal").classList.remove("open"); });
  $("command-input").addEventListener("input", (e) => renderCommandResults(e.target.value));
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCommand();
    }
    if (e.key === "Escape") {
      $("command-modal").classList.remove("open");
      $("gene-drawer").classList.remove("open");
    }
  });
}

async function init() {
  bindEvents();
  setInitialLoadingStates();
  if (!location.hash) {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }
  try {
    await loadModel();
    await Promise.all([loadTargets(), loadImportance(), loadEnrichment(), loadVolcano(), loadNetwork(), loadHeatmap()]);
    await compareGenes();
    if (!location.hash && !userNavigated) {
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    }
  } catch (error) {
    if ($("health-status")) $("health-status").textContent = "API error";
    if ($("model-chip")) $("model-chip").textContent = error.message;
    console.error(error);
  }
}

init();
