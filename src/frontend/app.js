const state = {
  currentTarget: null,
  networkHit: [],
  hits: {},
  data: {},
  volcanoView: { centerX: 0, minY: 0 },
  networkView: { panX: 0, panY: 0 },
  mlView: { centerX: 0, centerY: 0 },
  drag: null,
  suppressNetworkClick: false
};

const colors = {
  green: "#2ca66f",
  cyan: "#257e9c",
  amber: "#c98721",
  red: "#c94b5b",
  blue: "#3d6eb3",
  purple: "#7556a5",
  gray: "#8a9892",
  ink: "#17201d",
  line: "#dce5e0"
};
const clusterColors = ["#2ca66f", "#257e9c", "#c98721", "#c94b5b", "#7556a5", "#667085"];
const geoSupportColors = {
  "Strong GEO support": colors.green,
  "Moderate GEO support": colors.amber,
  "Limited GEO support": colors.red,
  "Not Found": colors.gray
};

function geoSupportColor(level) {
  return geoSupportColors[level] || colors.gray;
}

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
    const hit = (state.hits[canvas.id] || []).find((item) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
    if (hit) showTooltip(hit.html, event.clientX, event.clientY);
    else hideTooltip();
  });
  canvas.addEventListener("mouseleave", hideTooltip);
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
  ctx.fillStyle = "#62716b";
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
  ctx.fillStyle = "#ffffff";
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
  ctx.fillStyle = "#62716b";
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
  const filtered = filteredVolcanoRows(rows);
  const view = volcanoViewport(filtered.length ? filtered : rows);
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
    ctx.strokeStyle = `rgba(37,126,156,${Math.max(0.16, (edge.edge_weight_protein || 0.4) * 0.7)})`;
    ctx.lineWidth = Math.max(1, (edge.edge_weight_protein || 0.4) * 4);
    ctx.stroke();
  });
  const labelPoints = [];
  positioned.forEach((node) => {
    const cluster = Number(node.cluster_id || 0);
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = clusterColors[Math.abs(cluster) % clusterColors.length];
    ctx.fill();
    ctx.strokeStyle = geoSupportColor(node.geo_support_level);
    ctx.lineWidth = 2.5;
    ctx.stroke();
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
    ctx.fillStyle = "#dce5e0";
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
  setMeta(canvas, `${legend([{ label: "Raw component score", color: "#dce5e0" }, { label: "Weighted contribution", color: colors.green }])}<div class="axis-note">Weighted contribution = raw component score x configured Phase 5 weight. Final score is the sum of weighted contributions.</div>`);
}
function renderTable(container, rows, columns, clickable = false) {
  if (!rows || !rows.length) {
    container.innerHTML = "<p class=\"hint\">No rows match the current filters.</p>";
    return;
  }
  const headers = columns.map((column) => `<th data-help="${esc(column.help || help[column.key] || column.label)}">${esc(column.label)}</th>`).join("");
  const body = rows.map((row) => {
    const cells = columns.map((column) => `<td>${esc(fmt(row[column.key]))}</td>`).join("");
    const attrs = clickable && row.protein_id ? ` class="clickable" data-protein="${esc(row.protein_id)}"` : "";
    return `<tr${attrs}>${cells}</tr>`;
  }).join("");
  container.innerHTML = `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
  container.querySelectorAll("th[data-help]").forEach((th) => {
    th.addEventListener("mousemove", (event) => showTooltip(`<strong>${esc(th.textContent)}</strong>${esc(th.dataset.help)}`, event.clientX, event.clientY, 1200));
    th.addEventListener("mouseleave", hideTooltip);
  });
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

function renderOverview(data) {
  $("#overview-summary").textContent = data.summary;
  $("#overview-kpis").innerHTML = data.metrics.map((metric) => `<article class="kpi-card"><strong>${fmt(metric.metric_value)}</strong><span>${esc(metric.metric_name)}</span><small>${esc(metric.metric_unit)} - ${esc(metric.phase_name)}</small></article>`).join("");
  $("#pipeline-flow").innerHTML = data.pipeline.map((step, index) => `<div class="pipeline-step"><span>Step ${index + 1}</span><strong>${esc(step)}</strong></div>`).join("");
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
  ], true);
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
async function openTarget(proteinId) {
  const detail = await api(`/api/v1/targets/${encodeURIComponent(proteinId)}`);
  state.currentTarget = detail.identity;
  $("#chat-target").textContent = `${detail.identity.gene_name} (${detail.identity.protein_id})`;
  await renderScore(detail.identity.protein_id);
  const sections = [["Identity", detail.identity], ["Phase 2 DEG", detail.phase_2_deg], ["Phase 3 Mapping", detail.phase_3_mapping], ["Phase 4 PPI", detail.phase_4_ppi], ["Phase 5 Scoring", detail.phase_5_scoring], ["Phase 6 GEO", detail.phase_6_geo], ["Phase 7 ML", detail.phase_7_ml]];
  $("#drawer-content").innerHTML = `<h2>${esc(detail.identity.gene_name)}</h2><p class="hint">STRING protein: ${esc(detail.identity.protein_id)}</p>${sections.map(([title, payload]) => `<h3>${title}</h3><div class="detail-grid">${Object.entries(payload).map(([key, value]) => `<div class="detail-item" title="${esc(help[key] || key)}"><span>${esc(key)}</span><strong>${esc(fmt(value))}</strong></div>`).join("")}</div>`).join("")}`;
  $("#target-drawer").classList.add("open");
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
  const calls = [
    ["health", "/api/v1/health"], ["overview", "/api/v1/overview"], ["qcSamples", "/api/v1/visualizations/qc/sample-counts"], ["qcExclusions", "/api/v1/visualizations/qc/exclusions"], ["qcLibrary", "/api/v1/visualizations/qc/library-size"], ["qcZero", "/api/v1/visualizations/qc/zero-gene-rate"], ["degSummary", "/api/v1/visualizations/deg/summary"], ["topDeg", "/api/v1/visualizations/deg/top-genes?limit=50"], ["heatmap", "/api/v1/visualizations/deg/heatmap?top_n=24"], ["mappingSummary", "/api/v1/visualizations/mapping/summary"], ["mappingConfidence", "/api/v1/visualizations/mapping/confidence"], ["unmapped", "/api/v1/mapping/unmapped"], ["networkTop", "/api/v1/visualizations/network/top-proteins?limit=100"], ["networkScores", "/api/v1/visualizations/network/score-distribution"], ["geoSummary", "/api/v1/visualizations/geo/summary"], ["geoTopSupported", "/api/v1/visualizations/geo/top-supported?limit=100"], ["geoScatter", "/api/v1/visualizations/geo/gdc-vs-support"], ["geoOverlap", "/api/v1/visualizations/geo/top-candidate-overlap?limit=100"], ["geoUnmatched", "/api/v1/geo/unmatched-candidates"], ["mlK", "/api/v1/visualizations/ml/k-selection"], ["mlSummary", "/api/v1/visualizations/ml/cluster-summary"], ["mlClusters", "/api/v1/ml/clusters"]
  ];
  const entries = await Promise.all(calls.map(async ([key, path]) => [key, await api(path)]));
  state.data = Object.fromEntries(entries);
  $("#health-label").textContent = `API ready (${state.data.health.mart_source || "json"}, real data)`;
  $(".status-dot").classList.add("ok");
  $("#source-chip").textContent = "real HDFS mart snapshot";
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
    document.querySelectorAll(".nav-btn").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("active"));
    button.classList.add("active");
    $(`#tab-${button.dataset.tab}`).classList.add("active");
    setTimeout(renderAll, 30);
  }));
  $("#drawer-close").addEventListener("click", () => $("#target-drawer").classList.remove("open"));
  $("#volcano-highlight").addEventListener("change", async () => { resetVolcanoView(); await renderDeg(); });
  $("#volcano-top-only").addEventListener("change", () => { resetVolcanoView(); redrawVolcano(); });
  document.querySelectorAll(".volcano-color-filter").forEach((input) => input.addEventListener("change", () => { resetVolcanoView(); redrawVolcano(); }));
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
  bindEvents();
  addChatMessage("assistant", "AI model, RAG and finetune are not connected. The dashboard data itself is now read from real HDFS phase outputs via local mart snapshots.");
  try {
    await initializeData();
    await renderAll();
  } catch (error) {
    $("#health-label").textContent = "API/data load failed";
    addChatMessage("assistant", `Dashboard data load failed: ${error.message}`);
  }
});
