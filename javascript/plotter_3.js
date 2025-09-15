// plotter_3.js
// UI wiring: automagic updates on any parameter change; connects plotterCore and plotterPlot.

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  function setStatus(msg, t = 3000) {
    if (window.plotterCore && typeof window.plotterCore.setStatus === 'function') {
      window.plotterCore.setStatus(msg, t);
    } else {
      const s = $('status'); if (s) { s.textContent = msg || ''; if (t && msg) { clearTimeout(setStatus._t); setStatus._t = setTimeout(()=>s.textContent='','3000'); } }
    }
  }

  function getSelectedX() {
    const xContainer = $('xColContainer');
    if (!xContainer) return 0;
    const r = xContainer.querySelector('input[type=radio]:checked');
    if (r) return Number(r.value);
    const first = xContainer.querySelector('input[type=radio]');
    return first ? Number(first.value) : 0;
  }

  function gatherSelectedYsOrdered() {
    const yContainer = $('yColsContainer');
    if (!yContainer) return [];
    const boxes = Array.from(yContainer.querySelectorAll('input[type=checkbox]'));
    return boxes.filter(b => b.checked).map(b => Number(b.value));
  }

  function enableWheelH(el) {
    if (!el) return;
    el.addEventListener('wheel', function(e){
      const canH = el.scrollWidth > el.clientWidth;
      if (!canH) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    }, { passive:false });
  }

  // elements
  const sepSelect = $('sepSelect');
  const customSepGroup = $('customSepGroup');
  const btnParse = $('btnParse');
  const btnClear = $('btnClear');
  const btnCopyData = $('btnCopyData');
  const btnDownloadData = $('btnDownloadData');
  const btnExportPNG = $('btnExportPNG');
  const btnExportLatex = $('btnExportLatex');
  const tableWrapper = $('tableWrapper');
  const inputTa = $('inputLeft');

  if (sepSelect && customSepGroup) {
    sepSelect.addEventListener('change', () => {
      customSepGroup.style.display = (sepSelect.value === 'custom') ? 'block' : 'none';
    });
  }

  /* ---------- Legend editor helpers ---------- */

  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }

  function updateLegendEditor() {
    const editor = $('legendEditor');
    if (!editor) return;
    editor.innerHTML = '';
    const ys = gatherSelectedYsOrdered();
    if (!ys.length) {
      editor.innerHTML = '<div class="small-muted">Aucune série sélectionnée</div>';
      refreshLegendAreaFromEditor();
      return;
    }
    const colNames = (window.plotterCore && window.plotterCore.getColNames) ? window.plotterCore.getColNames() : [];
    ys.forEach((colIndex, i) => {
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.gap = '8px'; row.style.alignItems = 'center'; row.style.marginBottom = '6px';
      const label = document.createElement('label');
      label.textContent = `Série ${i+1}`; label.style.minWidth='60px'; label.style.fontSize='13px'; label.style.color='var(--muted)';
      label.htmlFor = `legendLabel_${colIndex}`;
      const input = document.createElement('input');
      input.type = 'text'; input.id = `legendLabel_${colIndex}`; input.className = 'control';
      input.value = colNames[colIndex] || `Col ${colIndex+1}`; input.style.flex='1'; input.dataset.colIndex = String(colIndex);
      input.addEventListener('input', () => {
        refreshLegendAreaFromEditor();
        // no full replot needed — legend update handled; schedule update anyway to ensure consistency
        scheduleAutoPlot();
      });
      row.appendChild(label); row.appendChild(input); editor.appendChild(row);
    });
    refreshLegendAreaFromEditor();
  }

  function refreshLegendAreaFromEditor() {
    const legendArea = $('legendArea');
    if (!legendArea) return;
    const ys = gatherSelectedYsOrdered();
    if (!ys.length) { legendArea.innerHTML = '—'; return; }
    const lastDatasets = (window.plotterPlot && typeof window.plotterPlot.getLastDatasets === 'function') ? window.plotterPlot.getLastDatasets() : null;
    const entries = ys.map((colIndex, i) => {
      const input = document.getElementById(`legendLabel_${colIndex}`);
      const labelText = input ? input.value : ((window.plotterCore && window.plotterCore.getColNames) ? window.plotterCore.getColNames()[colIndex] : `Col ${colIndex+1}`);
      const color = (lastDatasets && lastDatasets[i] && lastDatasets[i].borderColor) ? lastDatasets[i].borderColor : '#999';
      return `<div class="legend-entry"><span class="legend-color" style="background:${color}"></span><strong>${escapeHtml(labelText)}</strong></div>`;
    });
    legendArea.innerHTML = entries.join('');

    // update chart labels if chart exists
    try {
      const chart = (window.plotterPlot && typeof window.plotterPlot.getChartInstance === 'function') ? window.plotterPlot.getChartInstance() : null;
      if (chart && chart.data && chart.data.datasets) {
        const ysOrdered = ys;
        chart.data.datasets.forEach((ds, idx) => {
          const colIndex = ysOrdered[idx];
          if (colIndex === undefined) return;
          const inp = document.getElementById(`legendLabel_${colIndex}`);
          if (inp && inp.value) ds.label = inp.value;
        });
        chart.update();
      }
    } catch (e) {}
  }

  function gatherLabelsForPlot(xCol, yCols) {
    const labels = [];
    const xTitleUi = ($('xTitle') && $('xTitle').value) || null;
    const colNames = (window.plotterCore && window.plotterCore.getColNames) ? window.plotterCore.getColNames() : [];
    labels.push(xTitleUi || (colNames[xCol] || `X_col${xCol+1}`));
    for (let i=0;i<yCols.length;i++){
      const c = yCols[i];
      const input = document.getElementById(`legendLabel_${c}`);
      const label = (input && input.value) ? input.value : (colNames[c] || `Col ${c+1}`);
      labels.push(label);
    }
    return labels;
  }

  /* ---------- Auto-plot (debounced) ---------- */

  let autoTimer = null;
  function scheduleAutoPlot(delay = 130) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { autoPlot(); }, delay);
  }

  function autoPlot() {
    const tableObj = (window.plotterCore && window.plotterCore.getLastTable) ? window.plotterCore.getLastTable() : null;
    if (!tableObj) return; // nothing to plot
    const x = getSelectedX();
    let ys = gatherSelectedYsOrdered();
    ys = ys.filter(v => v !== x);
    if (!ys.length) {
      // clear chart if none selected
      if (window.plotterPlot && typeof window.plotterPlot.getChartInstance === 'function') {
        const chart = window.plotterPlot.getChartInstance();
        if (chart) {
          try { chart.destroy(); } catch(e) {}
        }
      }
      return;
    }

    const labelsForPlot = gatherLabelsForPlot(x, ys);
    const datasets = window.plotterPlot.buildDatasets(tableObj, x, ys, labelsForPlot.slice(1));
    if (!datasets || !datasets.length) return;
    const options = {
      replace: true,
      xLabel: ($('xTitle') && $('xTitle').value) || labelsForPlot[0] || '',
      yLabel: ($('yTitle') && $('yTitle').value) || '',
      chartTitle: ($('chartTitle') && $('chartTitle').value) || ''
    };
    const xMin = $('xMin') && $('xMin').value; const xMax = $('xMax') && $('xMax').value;
    const yMin = $('yMin') && $('yMin').value; const yMax = $('yMax') && $('yMax').value;
    if (xMin !== '' || xMax !== '' || yMin !== '' || yMax !== '') {
      options.xMin = xMin !== '' ? xMin : undefined;
      options.xMax = xMax !== '' ? xMax : undefined;
      options.yMin = yMin !== '' ? yMin : undefined;
      options.yMax = yMax !== '' ? yMax : undefined;
    }
    window.plotterPlot.plotDatasets(datasets, options);
    refreshLegendAreaFromEditor();
  }

  /* ---------- Actions (parse / clear / export) ---------- */

  function onParse() {
    if (!inputTa) { setStatus('Zone d\'entrée introuvable'); return; }
    const txt = (inputTa.value || '').trim();
    if (!txt) { setStatus('Rien à analyser'); return; }
    const sel = sepSelect ? sepSelect.value : 'auto';
    const res = window.plotterCore.parseFromTextarea(sel);
    if (!res || !res.ok) return;
    enableWheelH(tableWrapper);
    updateLegendEditor();
    // attach listeners to radio/checkboxes now present
    attachColumnChangeHandlers();
    scheduleAutoPlot(80);
    setStatus('Analyse terminée');
    const xContainer = $('xColContainer');
    if (xContainer) {
      const first = xContainer.querySelector('input[type=radio]');
      if (first) first.focus();
    }
  }

  function onClear() {
    if (inputTa) inputTa.value = '';
    if (tableWrapper) tableWrapper.innerHTML = '<div class="empty small-muted">Aucune donnée</div>';
    if ($('columnsList')) $('columnsList').textContent = '—';
    if ($('legendArea')) $('legendArea').innerHTML = '—';
    if ($('legendEditor')) $('legendEditor').innerHTML = '<div class="small-muted">Aucune série sélectionnée</div>';
    if (window.plotterPlot && typeof window.plotterPlot.resetZoom === 'function') window.plotterPlot.resetZoom();
    // destroy chart if any
    if (window.plotterPlot && typeof window.plotterPlot.getChartInstance === 'function') {
      const c = window.plotterPlot.getChartInstance();
      if (c) try { c.destroy(); } catch(e) {}
    }
    setStatus('Effacé');
  }

  function onCopy() {
    const tableObj = window.plotterCore.getLastTable();
    if (!tableObj) return setStatus('Aucune table');
    const x = getSelectedX(); const ys = gatherSelectedYsOrdered();
    if (!ys.length) return setStatus('Sélectionne au moins une colonne Y');
    const headerLabels = gatherLabelsForPlot(x, ys);
    const csv = window.plotterPlot.buildCSV(tableObj, x, ys, '\t', headerLabels);
    if (!csv) return setStatus('Rien à copier');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csv).then(()=> setStatus('Copié'));
    } else {
      const ta = document.createElement('textarea'); ta.value = csv; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); setStatus('Copié (fallback)');
    }
  }

  function onDownload() {
    const tableObj = window.plotterCore.getLastTable();
    if (!tableObj) return setStatus('Aucune table');
    const x = getSelectedX(); const ys = gatherSelectedYsOrdered();
    if (!ys.length) return setStatus('Sélectionne au moins une colonne Y');
    const headerLabels = gatherLabelsForPlot(x, ys);
    const csv = window.plotterPlot.buildCSV(tableObj, x, ys, ',', headerLabels);
    if (!csv) return setStatus('Rien à télécharger');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const fileName = (($('chartTitle') && $('chartTitle').value) ? $('chartTitle').value.replace(/\s+/g,'_') + '.csv' : `export_cols_${ys.join('-')||'cols'}.csv`);
    const a = document.createElement('a'); a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus('CSV prêt');
  }

  function onLatex() {
    const tableObj = window.plotterCore.getLastTable();
    if (!tableObj) return setStatus('Aucune table');
    const x = getSelectedX(); const ys = gatherSelectedYsOrdered();
    if (!ys.length) return setStatus('Sélectionne au moins une colonne Y');
    const latex = window.plotterPlot.generatePGFPlots(tableObj, x, ys);
    if (!latex) return setStatus('Erreur génération LaTeX');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(latex).then(()=> setStatus('LaTeX copié'));
    }
    const blob = new Blob([latex], { type: 'text/x-tex;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'plot_pgfplots.tex';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setStatus('LaTeX prêt');
  }

  function onExportPNG() {
    if (!window.plotterPlot || typeof window.plotterPlot.exportPNG !== 'function') {
      setStatus('Export PNG non disponible');
      return;
    }
    const filename = (($('chartTitle') && $('chartTitle').value) ? $('chartTitle').value.replace(/\s+/g,'_') + '.png' : 'plot.png');
    window.plotterPlot.exportPNG(filename);
  }

  /* ---------- Attach generic input listeners (so changes auto-update) ---------- */

  function attachColumnChangeHandlers() {
    const xContainer = $('xColContainer');
    if (xContainer) {
      xContainer.querySelectorAll('input[type=radio]').forEach(r => {
        r.addEventListener('change', () => scheduleAutoPlot());
      });
    }
    const yContainer = $('yColsContainer');
    if (yContainer) {
      yContainer.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => { updateLegendEditor(); scheduleAutoPlot(); });
      });
    }
  }

  // listen to axis/unit/title inputs to auto update
  function attachGeneralControls() {
    ['xTitle','yTitle','chartTitle','xMin','xMax','yMin','yMax'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => scheduleAutoPlot());
    });
    ['freqUnitSelect','xScaleSelect','yScaleSelect','paletteSelect'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('change', () => scheduleAutoPlot());
    });
  }

  // delegation: if yColsContainer not filled yet, watch for future population via mutation observer
  function observeColumnContainers() {
    const yContainer = $('yColsContainer');
    const xContainer = $('xColContainer');
    if (!yContainer || !xContainer) return;
    // already attached in attachColumnChangeHandlers called after parse
  }

  /* ---------- Event wiring ---------- */

  if (btnParse) btnParse.addEventListener('click', onParse);
  if (btnClear) btnClear.addEventListener('click', onClear);
  if (btnCopyData) btnCopyData.addEventListener('click', onCopy);
  if (btnDownloadData) btnDownloadData.addEventListener('click', onDownload);
  if (btnExportLatex) btnExportLatex.addEventListener('click', onLatex);
  if (btnExportPNG) btnExportPNG.addEventListener('click', onExportPNG);

  // shortcut
  if (inputTa) {
    inputTa.addEventListener('keydown', (e) => {
      if (e.ctrlKey && (e.key === 'Enter' || e.key === 'Return')) { e.preventDefault(); onParse(); }
    });
  }

  // enable horizontal scroll in preview
  enableWheelH(tableWrapper);

  // attach general controls (titles/units/limits)
  attachGeneralControls();
  observeColumnContainers();

  // initial refresh PNG availability
  if (btnExportPNG) {
    if (window.plotterPlot && typeof window.plotterPlot.exportPNG === 'function') { btnExportPNG.disabled = false; btnExportPNG.title = 'Télécharger PNG'; }
    else { btnExportPNG.disabled = true; btnExportPNG.title = 'Export PNG désactivé'; }
  }

  // debug hooks
  window.flotterMain = {
    parse: onParse,
    clear: onClear,
    copy: onCopy,
    download: onDownload,
    exportPNG: onExportPNG,
    exportLatex: onLatex,
    autoPlot: autoPlot,
    updateLegendEditor
  };

  setStatus('UI prête', 1200);

})();
