import React, { useState } from 'react';
import ReactPlotly from 'react-plotly.js';
import type { Data } from 'plotly.js';
import CytoscapeComponent from 'react-cytoscapejs';
import { mockVolcanoData, mockHeatmapData, mockNetworkElements } from './mockData';

const Plot = (ReactPlotly as any).default || ReactPlotly;

function App() {
  const [showProjectInfo, setShowProjectInfo] = useState(false);

  const upRegulated = mockVolcanoData.filter(d => d.status === "Up-regulated");
  const downRegulated = mockVolcanoData.filter(d => d.status === "Down-regulated");
  const notSignificant = mockVolcanoData.filter(d => d.status === "Not Significant");

  const volcanoTraces: Data[] = [
    { x: upRegulated.map(d => d.log2fc), y: upRegulated.map(d => d.neg_log10_p), text: upRegulated.map(d => `Gene: <b>${d.gene}</b><br>Log2FC: ${d.log2fc.toFixed(2)}<br>P-val: ${d.p_value.toFixed(4)}`), mode: 'markers', type: 'scatter', name: 'Tăng biểu hiện (Up)', marker: { color: '#ef4444', size: 10, line: { color: 'white', width: 1 } } },
    { x: downRegulated.map(d => d.log2fc), y: downRegulated.map(d => d.neg_log10_p), text: downRegulated.map(d => `Gene: <b>${d.gene}</b><br>Log2FC: ${d.log2fc.toFixed(2)}`), mode: 'markers', type: 'scatter', name: 'Giảm biểu hiện (Down)', marker: { color: '#3b82f6', size: 10, line: { color: 'white', width: 1 } } },
    { x: notSignificant.map(d => d.log2fc), y: notSignificant.map(d => d.neg_log10_p), text: notSignificant.map(d => d.gene), mode: 'markers', type: 'scatter', name: 'Không ý nghĩa', marker: { color: '#cbd5e1', size: 6, opacity: 0.5 } }
  ];

  const cytoscapeStylesheet: any[] = [
    { selector: 'node', style: { 'label': 'data(label)', 'width': 'mapData(pagerank, 0, 1, 30, 90)' as any, 'height': 'mapData(pagerank, 0, 1, 30, 90)' as any, 'background-color': '#10b981', 'color': '#0f172a', 'font-weight': 'bold', 'font-size': '14px', 'text-valign': 'center', 'text-halign': 'center', 'border-width': 3, 'border-color': '#ffffff' } },
    { selector: 'edge', style: { 'width': 'mapData(weight, 0, 1, 2, 8)' as any, 'line-color': '#e2e8f0', 'curve-style': 'bezier', 'opacity': 0.8 } },
    { selector: 'node[pagerank > 0.8]', style: { 'background-color': '#f59e0b', 'color': '#ffffff', 'border-color': '#b45309' } }
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-blue-200">
      
      {/* HEADER */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm px-6 py-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all duration-300">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
            LUAD <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-emerald-500">Drug Target</span> Identification
          </h1>
          <p className="text-slate-500 mt-1 text-xs md:text-sm font-medium">
            Phân tích tin sinh học từ dữ liệu TCGA & STRING-DB
          </p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => setShowProjectInfo(!showProjectInfo)}
            className="flex items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-blue-600 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300 active:scale-95"
          >
            {showProjectInfo ? 'Đóng thông tin' : 'Về dự án này'}
            <svg className={`w-4 h-4 transition-transform duration-300 ${showProjectInfo ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          
          <button className="bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md hover:bg-blue-600 hover:shadow-lg transition-all duration-300 active:scale-95">
            Xuất Báo Cáo
          </button>
        </div>
      </header>

      <main className="p-4 md:p-8 max-w-7xl mx-auto">
        
        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${showProjectInfo ? 'max-h-[500px] opacity-100 mb-8' : 'max-h-0 opacity-0'}`}>
          <div className="bg-gradient-to-br from-blue-50 to-emerald-50 border border-blue-100 p-6 md:p-8 rounded-2xl shadow-inner">
            <h3 className="text-xl font-bold text-slate-800 mb-3">Tóm tắt Dự án: Nhận diện Mục tiêu Thuốc Ung thư</h3>
            <p className="text-slate-600 mb-4 leading-relaxed">
              Cơ thể người sở hữu khoảng 20,000 "bánh răng" (Gene/Protein). Khi ung thư phổi (LUAD) xảy ra, một nhóm bánh răng đã bị hỏng. Thay vì sử dụng hóa trị phá hủy toàn bộ hệ thống, dự án này ứng dụng <strong>Big Data (Apache Spark)</strong> để xử lý hàng triệu bản ghi từ hồ sơ bệnh nhân thực tế.
            </p>
            <ul className="list-disc pl-5 text-slate-600 space-y-2">
              <li><strong>Bước 1 (Thống kê):</strong> Trích xuất các Gene biểu hiện dị thường (Differential Expression).</li>
              <li><strong>Bước 2 (Đồ thị):</strong> Dựng mạng lưới tương tác để tìm ra "Trùm cuối" (Hub Proteins) bằng PageRank.</li>
              <li><strong>Mục tiêu:</strong> Cung cấp danh sách Ứng viên Mục tiêu Thuốc chuẩn xác nhất cho các nhà khoa học.</li>
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Bệnh nhân phân tích", value: "542", sub: "Khối u & Đối chứng", color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Gene được sàng lọc", value: "20,531", sub: "RNA-Seq TPM", color: "text-indigo-600", bg: "bg-indigo-50" },
            { label: "Nghi phạm đột biến", value: "128", sub: "|Log2FC| > 1.5", color: "text-red-500", bg: "bg-red-50" },
            { label: "Drug Target Đề xuất", value: "Top 5", sub: "Dựa trên PageRank", color: "text-emerald-600", bg: "bg-emerald-50" }
          ].map((kpi, index) => (
            <div key={index} className="group bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-default flex items-center gap-4">
              <div className={`w-12 h-12 rounded-full ${kpi.bg} flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
                <div className={`w-4 h-4 rounded-full ${kpi.bg.replace('50', '400')}`}></div>
              </div>
              <div>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">{kpi.label}</p>
                <h3 className={`text-2xl font-extrabold mt-1 ${kpi.color}`}>{kpi.value}</h3>
                <p className="text-xs text-slate-500 mt-1">{kpi.sub}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Box 1: Volcano Plot */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-300 flex flex-col group">
            <h2 className="text-lg font-bold mb-1 flex items-center gap-2 text-slate-800">
              <span className="w-3 h-3 rounded-full bg-red-500 group-hover:animate-pulse"></span>
              1. Sàng lọc Gene bất thường (Volcano)
            </h2>
            <p className="text-sm text-slate-500 mb-4">Các điểm phân tán xa trung tâm thể hiện sự thay đổi mạnh mẽ.</p>
            <div className="flex-1 w-full h-[380px] bg-slate-50/50 rounded-xl border border-slate-100 p-2">
              <Plot data={volcanoTraces} layout={{ autosize: true, margin: { l: 50, r: 20, t: 20, b: 40 }, xaxis: { title: { text: 'Log2 Fold Change', font: {size: 12} }, zeroline: true, gridcolor: '#f1f5f9' }, yaxis: { title: { text: '-Log10(P-value)', font: {size: 12} }, zeroline: true, gridcolor: '#f1f5f9' }, hovermode: 'closest', plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)', legend: { orientation: "h", y: -0.2 } }} useResizeHandler={true} style={{ width: "100%", height: "100%" }} />
            </div>
          </div>

          {/* Box 2: Heatmap */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-300 flex flex-col group">
            <h2 className="text-lg font-bold mb-1 flex items-center gap-2 text-slate-800">
              <span className="w-3 h-3 rounded-full bg-blue-500 group-hover:animate-pulse"></span>
              2. Đối chiếu thực tế Lâm sàng (Heatmap)
            </h2>
            <p className="text-sm text-slate-500 mb-4">So sánh nồng độ biểu hiện (TPM) giữa bệnh nhân Khỏe và Ung thư.</p>
            <div className="flex-1 w-full h-[380px] bg-slate-50/50 rounded-xl border border-slate-100 p-2">
              <Plot data={[{ z: mockHeatmapData.z_values, x: mockHeatmapData.patients, y: mockHeatmapData.genes, type: 'heatmap', colorscale: 'RdBu', reversescale: true, hovertemplate: 'Gene: %{y}<br>Bệnh nhân: %{x}<br>TPM: %{z}<extra></extra>' }]} layout={{ autosize: true, margin: { l: 60, r: 20, t: 20, b: 40 }, plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)' }} useResizeHandler={true} style={{ width: "100%", height: "100%" }} />
            </div>
          </div>

          {/* Box 3: Network Graph */}
          <div className="col-span-1 lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-300 group">
            <div className="flex justify-between items-end mb-4">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800">
                  <span className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] group-hover:animate-pulse"></span>
                  3. Nhận diện "Trùm cuối" - Mạng lưới Protein (PPI)
                </h2>
                <p className="text-sm text-slate-500 mt-1">Sử dụng GraphX PageRank. Các nút màu CAM khổng lồ (Hubs) là các mục tiêu thuốc (Drug Targets) tiềm năng nhất.</p>
              </div>
              <div className="hidden md:flex gap-2 text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-md">
                <span>🖱️ Cuộn để Zoom</span> | <span>✋ Kéo để di chuyển</span>
              </div>
            </div>
            
            <div className="h-[500px] w-full bg-slate-800 rounded-xl overflow-hidden shadow-inner relative border-4 border-slate-700 transition-colors duration-300 hover:border-slate-600">
              <CytoscapeComponent elements={mockNetworkElements} stylesheet={cytoscapeStylesheet} layout={{ name: 'cose', padding: 50, nodeRepulsion: 400000, idealEdgeLength: 100 } as any} style={{ width: '100%', height: '100%' }} minZoom={0.5} maxZoom={2} />
              <div className="absolute bottom-4 left-4 text-slate-400 text-xs font-mono bg-slate-900/60 px-3 py-1.5 rounded backdrop-blur-sm">Source: STRING-DB v12.0</div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;