// plotter_2.js
// Plotting + Chart.js glue, unit conversion, limits/zoom, PNG export, PGFPlots/CSV generation
// Depends on: plotterCore (plotter_1.js)
// Exposes: window.plotterPlot API

(function () {
  'use strict';

  // DOM helpers
  function $id(id) { return document.getElementById(id); }
  function safeNum(v, fallback = NaN) { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : fallback; }

  // state
  let chartInst = null;
  let canvasEl = null;
  let lastDatasets = null;

  // small status helper (delegates to plotterCore.setStatus if available)
  function setStatus(msg, t = 3000) {
    if (window.plotterCore && typeof window.plotterCore.setStatus === 'function') {
      window.plotterCore.setStatus(msg, t);
    } else {
      const s = $id('status'); if (s) { s.textContent = msg || ''; if (t && msg) { clearTimeout(setStatus._t); setStatus._t = setTimeout(()=>s.textContent='','3000'); } }
    }
  }

  // ensure Chart.js available
  function ensureChartJsLoaded(cb) {
    if (window.Chart) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.async = true;
    s.onload = cb;
    s.onerror = () => { setStatus('Impossible de charger Chart.js (CDN)'); console.error('Chart.js load failed'); };
    document.head.appendChild(s);
  }

  // HiDPI canvas creation in #chartArea
  function createCanvasHiDPI(container) {
    if (!container) container = $id('chartArea');
    container.innerHTML = '';
    const c = document.createElement('canvas');
    c.style.width = '100%';
    c.style.height = '100%';
    container.appendChild(c);
    // pixel size
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(300, Math.floor(rect.width * dpr));
    c.height = Math.max(200, Math.floor(rect.height * dpr));
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  // numeric check
  function isNumericString(s) {
    if (s === undefined || s === null) return false;
    s = String(s).trim().replace(',', '.');
    return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s);
  }

  // palette helper
  function palette(name) {
    const p = {
      pastel: ['#2b8cc4','#f2a541','#9b5de5','#4cc9f0','#52b788'],
      vives:  ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6'],
      sombres:['#0b1228','#1f2937','#374151','#4b5563','#64748b'],
      claires:['#f8fafc','#eef2ff','#f0fdf4','#fff7ed','#fff1f2'],
      mono:   ['#111827','#374151','#6b7280','#9ca3af']
    };
    return p[name] || p.pastel;
  }

  // buildDatasets(tableObj, xCol, yCols, labels)
  function buildDatasets(tableObj, xCol, yCols, labels) {
    if (!tableObj || !tableObj.rows) return [];
    const rows = tableObj.rows;
    const start = tableObj.startIndex || 0;

    const freqUnitEl = $id('freqUnitSelect');
    const inputUnitMult = freqUnitEl ? safeNum(freqUnitEl.value, 1) : 1;
    const xScaleEl = $id('xScaleSelect'); const xScale = xScaleEl ? safeNum(xScaleEl.value, 1) : 1;
    const yScaleEl = $id('yScaleSelect'); const yScale = yScaleEl ? safeNum(yScaleEl.value, 1) : 1;

    const palKey = ($id('paletteSelect') && $id('paletteSelect').value) ? $id('paletteSelect').value : 'pastel';
    const pal = palette(palKey);

    const datasets = [];

    for (let i = 0; i < yCols.length; i++) {
      const col = yCols[i];
      const pts = [];
      for (let r = start; r < rows.length; r++) {
        const xr = rows[r][xCol]; const yr = rows[r][col];
        if (xr === undefined || yr === undefined) continue;
        const xs = String(xr).trim().replace(',', '.');
        const ys = String(yr).trim().replace(',', '.');
        if (!isNumericString(xs) || !isNumericString(ys)) continue;
        const xBase = Number(xs) * inputUnitMult;
        if (!Number.isFinite(xBase)) continue;
        const xPlot = xBase / xScale;
        const yPlot = Number(ys) / yScale;
        if (!Number.isFinite(yPlot)) continue;
        pts.push({ x: xPlot, y: yPlot });
      }
      pts.sort((a,b)=> a.x - b.x);
      const labelText = (labels && labels[i]) ? String(labels[i]) : ((window.plotterCore && window.plotterCore.getColNames) ? (window.plotterCore.getColNames()[col] || `Col ${col+1}`) : `Col ${col+1}`);
      datasets.push({
        label: labelText,
        data: pts,
        borderColor: pal[i % pal.length],
        backgroundColor: pal[i % pal.length],
        tension: 0.06,
        pointRadius: 1.2,
        borderWidth: 2,
        fill: false,
        parsing: false
      });
    }

    lastDatasets = datasets;
    return datasets;
  }

  // Create or update Chart.js instance with datasets
  // options: { replace: true|false, xLabel, yLabel, chartTitle, xMin, xMax, yMin, yMax }
  function plotDatasets(datasets, options = {}) {
    ensureChartJsLoaded(() => {
      const container = $id('chartArea');
      if (!container) { setStatus('Zone graphique introuvable'); return; }
      // always replace for real-time behaviour (simpler)
      try { if (chartInst) { chartInst.destroy(); chartInst = null; } } catch (e) { console.warn(e); }
      canvasEl = createCanvasHiDPI(container);

      const ctx = canvasEl.getContext('2d');
      container.style.background = '#ffffff';

      const xLabel = options.xLabel || ($id('xTitle') && $id('xTitle').value) || '';
      const yLabel = options.yLabel || ($id('yTitle') && $id('yTitle').value) || '';
      const chartTitle = options.chartTitle || ($id('chartTitle') && $id('chartTitle').value) || '';

      const config = {
        type: 'line',
        data: { datasets: datasets },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: !!chartTitle, text: chartTitle, color: '#000', font: { weight: '700' } },
            legend: { position: 'top', labels: { color: '#000' } },
            tooltip: { mode: 'nearest', intersect: false }
          },
          scales: {
            x: {
              type: 'linear',
              title: { display: !!xLabel, text: xLabel, color: '#000' },
              ticks: { color: '#000' },
              grid: { color: 'rgba(0,0,0,0.06)' }
            },
            y: {
              title: { display: !!yLabel, text: yLabel, color: '#000' },
              ticks: { color: '#000' },
              grid: { color: 'rgba(0,0,0,0.06)' }
            }
          }
        }
      };

      try {
        chartInst = new Chart(ctx, config);
        setStatus('Tracé effectué');
        updateLegend();
        // apply limits if provided
        if (options.xMin !== undefined || options.xMax !== undefined || options.yMin !== undefined || options.yMax !== undefined) {
          applyLimits(options.xMin, options.xMax, options.yMin, options.yMax);
        }
      } catch (err) {
        console.error(err);
        setStatus('Erreur création du graphe (voir console)', 6000);
      }
    });
  }

  // update legend area (right panel) from chartInst
  function updateLegend() {
    const legendArea = $id('legendArea');
    if (!legendArea) return;
    if (!chartInst) { legendArea.innerHTML = '—'; return; }
    legendArea.innerHTML = chartInst.data.datasets.map((d, i) => {
      const color = d.borderColor || '#999';
      const label = d.label || `Série ${i+1}`;
      return `<div class="legend-entry"><span class="legend-color" style="background:${color}"></span><strong>${label}</strong></div>`;
    }).join('');
  }

  // apply axis limits (values are already in display units)
  function applyLimits(xMin, xMax, yMin, yMax) {
    if (!chartInst) return;
    const xScale = chartInst.options.scales.x;
    const yScale = chartInst.options.scales.y;
    xScale.min = (xMin !== undefined && xMin !== '') ? safeNum(xMin) : undefined;
    xScale.max = (xMax !== undefined && xMax !== '') ? safeNum(xMax) : undefined;
    yScale.min = (yMin !== undefined && yMin !== '') ? safeNum(yMin) : undefined;
    yScale.max = (yMax !== undefined && yMax !== '') ? safeNum(yMax) : undefined;
    chartInst.update();
    setStatus('Limites appliquées');
  }

  // reset zoom (clear min/max)
  function resetZoom() {
    if (!chartInst) return;
    const xScale = chartInst.options.scales.x;
    const yScale = chartInst.options.scales.y;
    xScale.min = undefined; xScale.max = undefined;
    yScale.min = undefined; yScale.max = undefined;
    chartInst.update();
    setStatus('Zoom réinitialisé');
  }

  // Export PNG: create image from canvas and trigger download
  function exportPNG(filename = 'plot.png') {
    if (!canvasEl) return setStatus('Aucun canvas à exporter');
    try {
      const dataUrl = canvasEl.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus('PNG téléchargé');
    } catch (e) {
      console.error(e);
      setStatus('Échec export PNG (voir console)', 6000);
    }
  }

  // helper: escape CSV cell
  function escapeCsv(cell, sep) {
    if (cell === undefined || cell === null) return '';
    const s = String(cell);
    if (s.indexOf(sep) !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // Build CSV (x + yCols) with headerLabels optionally provided
  // buildCSV(tableObj, xCol, yCols, sep = ',', headerLabels = null)
  function buildCSV(tableObj, xCol, yCols, sep = ',', headerLabels = null) {
    if (!tableObj) return '';
    const rows = tableObj.rows;
    const start = tableObj.startIndex || 0;
    const colNames = (window.plotterCore && window.plotterCore.getColNames) ? window.plotterCore.getColNames() : [];

    const headerParts = [];
    const xHeader = (headerLabels && headerLabels[0]) ? headerLabels[0] : (colNames[xCol] || `X_col${xCol+1}`);
    headerParts.push(escapeCsv(xHeader, sep));
    for (let i=0;i<yCols.length;i++) {
      const c = yCols[i];
      const label = (headerLabels && headerLabels[i+1]) ? headerLabels[i+1] : (colNames[c] || `col${c+1}`);
      headerParts.push(escapeCsv(label, sep));
    }
    const lines = [ headerParts.join(sep) ];

    for (let r = start; r < rows.length; r++) {
      const parts = [];
      const xv = rows[r][xCol] || '';
      parts.push(escapeCsv(String(xv), sep));
      for (let i=0;i<yCols.length;i++){
        const c = yCols[i];
        const v = rows[r][c] || '';
        parts.push(escapeCsv(String(v), sep));
      }
      lines.push(parts.join(sep));
    }
    return lines.join('\n');
  }

  // Generate PGFPlots document (simple template) from tableObj and selected columns
  function generatePGFPlots(tableObj, xCol, yCols) {
    if (!tableObj) return '';
    const rows = tableObj.rows;
    const start = tableObj.startIndex || 0;
    const freqUnitEl = $id('freqUnitSelect');
    const inputUnitMult = freqUnitEl ? safeNum(freqUnitEl.value, 1) : 1;
    const xScaleEl = $id('xScaleSelect'); const xScale = xScaleEl ? safeNum(xScaleEl.value, 1) : 1;
    const yScaleEl = $id('yScaleSelect'); const yScale = yScaleEl ? safeNum(yScaleEl.value, 1) : 1;
    const palKey = ($id('paletteSelect') && $id('paletteSelect').value) ? $id('paletteSelect').value : 'pastel';
    const pal = palette(palKey);

    const header = [
      '\\documentclass[tikz,border=3.14mm]{standalone}',
      '\\usepackage{pgfplots}',
      '\\pgfplotsset{compat=1.17}',
      '\\begin{document}',
      '\\begin{tikzpicture}',
      '\\begin{axis}[',
      `    title={${($id('chartTitle') && $id('chartTitle').value) || ''}},`,
      `    xlabel={${($id('xTitle') && $id('xTitle').value) || ''}},`,
      `    ylabel={${($id('yTitle') && $id('yTitle').value) || ''}},`,
      '    grid=both,',
      '    width=10cm,',
      '    height=8cm,',
      '    major grid style={dashed, gray!30},',
      '    minor grid style={dotted, gray!50},',
      '    legend style={at={(0.5,-0.2)}, anchor=north, legend columns=2}',
      ']'
    ].join('\n');

    const blocks = [];

    if (!yCols || !yCols.length) {
      blocks.push('\\addplot[only marks, mark=triangle, mark size=0.8, color=blue] table {', 'x y', '% données ici', '};', '\\addlegendentry{ }');
    } else {
      for (let si = 0; si < yCols.length; si++) {
        const yi = yCols[si];
        const colorHex = pal[si % pal.length] || '#2b8cc4';
        const rgb = (hex) => {
          const h = hex.replace('#','');
          if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
          return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
        };
        const [r,g,b] = rgb(colorHex);
        const blockLines = [];
        blockLines.push(`\\addplot[only marks, mark=triangle, mark size=0.8, color={rgb,255:red,${r};green,${g};blue,${b}}] table {`);
        blockLines.push('x y');
        for (let rIdx = start; rIdx < rows.length; rIdx++) {
          const xr = (rows[rIdx][xCol] || '').toString().trim();
          const yr = (rows[rIdx][yi] || '').toString().trim();
          if (!xr || !yr) continue;
          const xrClean = xr.replace(',', '.');
          const yrClean = yr.replace(',', '.');
          if (!isNumericString(xrClean) || !isNumericString(yrClean)) continue;
          const xBase = Number(xrClean) * inputUnitMult;
          if (!Number.isFinite(xBase)) continue;
          const xOut = xBase / xScale;
          const yOut = Number(yrClean) / yScale;
          if (!Number.isFinite(yOut)) continue;
          blockLines.push(`    ${xOut} ${yOut}`);
        }
        blockLines.push('};');
        const legendLabel = (window.plotterCore && window.plotterCore.getColNames) ? (window.plotterCore.getColNames()[yi] || `Col ${yi+1}`) : `Col ${yi+1}`;
        blockLines.push(`\\addlegendentry{${legendLabel.replace(/\}/g,'\\}').replace(/\{/g,'\\{')}}`);
        blocks.push(blockLines.join('\n'));
      }
    }

    const footer = [
      '\\end{axis}',
      '\\end{tikzpicture}',
      '\\end{document}'
    ].join('\n');

    return [header, ...blocks, footer].join('\n\n');
  }

  // expose API
  window.plotterPlot = {
    buildDatasets,
    plotDatasets,
    applyLimitsFromInputs: function() {
      const xMin = $id('xMin') && $id('xMin').value;
      const xMax = $id('xMax') && $id('xMax').value;
      const yMin = $id('yMin') && $id('yMin').value;
      const yMax = $id('yMax') && $id('yMax').value;
      applyLimits(xMin, xMax, yMin, yMax);
    },
    applyLimits,
    resetZoom,
    exportPNG,
    generatePGFPlots,
    buildCSV,
    getChartInstance: () => chartInst,
    getLastDatasets: () => lastDatasets
  };

  setStatus('Plotter (module 2) prêt', 1200);

})();
