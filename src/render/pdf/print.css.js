// src/render/pdf/print.css.js
function makePrintCss() {
  return `
  @page { size: A4; margin: 18mm 14mm 18mm 14mm; }
  * { box-sizing: border-box !important; }
  html, body {
    margin:0 !important; padding:0 !important;
    background:#ffffff !important; color:#0b0f16 !important;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
  }
  /* Neutraliza fondos oscuros del bundle */
  body, .card, .panel, .box, .bg, .bg-slate-900, .bg-slate-800, .bg-slate-700, .chart-card {
    background:#ffffff !important; color:#0b0f16 !important;
  }

  /* ===== PORTADA (oscura) ===== */
  .cover-page {
    page-break-after: always !important;
    background:#0b0f16 !important; color:#e5e7eb !important;
    min-height:100vh; padding:24mm 18mm !important; position: relative;
  }
  .cover-top{ display:flex; justify-content:space-between; align-items:flex-start; }
  .cover-brand img{ max-height:52px; }
  .cover-meta{ text-align:right; color:#9ca3af; font-size:12px; }
  .cover-meta-ts{ font-weight:600; }
  .cover-title{ margin-top:40mm; }
  .cover-title .line1{ font-size:22px; font-weight:700; margin:0 0 6px 0; }
  .cover-title .line2{ font-size:18px; color:#cbd5e1; }

  /* Tarjetas Base/Head: corrige corte y wrap de SHA largo */
  .cover-cards{
    position:absolute; left:18mm; right:18mm; bottom:18mm;
    display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px;
  }
  .card-dark{ border:1px solid #1f2937; border-radius:10px; padding:12px; background:#111827; width:100%; }
  .card-dark .card-title{ font-weight:700; margin-bottom:6px; color:#e5e7eb; }
  .card-dark .kv{ display:grid; grid-template-columns:120px 1fr; gap:6px 12px; font-size:13px; line-height:1.38; }
  .wrap { word-break: break-word; overflow-wrap: anywhere; }

  /* ===== PÁGINAS ===== */
  .page { page-break-before: always !important; background:#fff !important; }
  .section-wrap{ padding:6mm 0 !important; }
  .section-title{ font-size:20px !important; margin:0 0 8px 0 !important; }

  /* TOC: más grande y con más interlineado */
  .toc h2{ font-size:22px !important; margin-bottom:14px !important; }
  .toc ol{ font-size:15px !important; line-height:1.9 !important; padding-left:20px !important; }
  .toc li{ margin:6px 0 !important; }

  /* Subtítulos */
  .subsection-title{ font-weight:700; margin:12px 0 4px 0; padding-bottom:4px; border-bottom:2px solid #0b0f16; }

  /* Tablas */
  table{ width:100% !important; border-collapse: collapse !important; }
  th,td{ text-align:left !important; padding:6px 8px !important; border-bottom:1px solid #e5e7eb !important; vertical-align: top; }
  thead th{ background:#f3f4f6 !important; font-weight:600 !important; }

  /* Dashboard */
  .print-dash-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .print-dash-card{ border:1px solid #e5e7eb; border-radius:10px; padding:8px; }
  .print-dash-card h4{ margin:0 0 6px 0; font-size:14px; }
  .print-dash-card canvas{ width:100% !important; height:200px !important; }
  .print-dash-span2{ grid-column:1 / span 2; }
  .module-tables { margin-top:10px; }
  .module-tables h4 { margin:12px 0 6px 0; }
  .module-tables table { margin-bottom:8px; }

  /* Oculta UI interactiva del bundle */
  #app-menu, #app-header, nav, .controls, .filters, .btn, button{ display:none !important; }

  /* Links & code */
  a{ color:#1d4ed8 !important; text-decoration:none !important; }
  a:hover{ text-decoration:underline !important; }
  code{ background:#eef2ff !important; padding:2px 6px !important; border-radius:6px !important; }

  /* Dependency Paths */
  #Paths, .paths-filter, .filter, .filter-box, .search, .search-box, input[type="search"] { display: none !important; }
  .dep-paths-table, .dep-paths-table thead, .dep-paths-table tbody, .dep-paths-table tr, .dep-paths-table td, .dep-paths-table th { page-break-inside: avoid !important; }
  .dep-paths .subsection-title { margin-top: 10px; }
  .dep-paths-table th, .dep-paths-table td { font-size: 13px; }

  /* Fix Insights totals box */
  .fix-totals { border:1px solid #e5e7eb; border-radius:8px; padding:8px; margin:8px 0 12px; }
  `.trim();
}

module.exports = { makePrintCss };
