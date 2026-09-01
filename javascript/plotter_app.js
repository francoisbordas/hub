/* plotter_app.js — Plotter : état unique + câblage DOM + exports.
   Dépend de plotter_parse.js (window.plotterParse) et plotter_chart.js (window.plotterChart).
   Chaque contrôle écrit dans `state`, puis scheduleRender() -> buildPlotData(state) -> render.
   Les exports lisent `lastPD` (données tracées), jamais le DOM.
*/
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = window.plotterParse, C = window.plotterChart;

  const state = {
    text: '', source: 'table', table: null, touchstone: null,
    x: 0,
    series: [],   // {col, name0, label, color, colorAuto, k, on}
    axes: { title: '', x: { title: '', min: null, max: null, step: null, unitIn: 1, unitOut: 1 }, y: { title: '', min: null, max: null, step: null, scale: 1 } },
    ann: [],      // {id, kind:'v'|'h'|'m', x, y, series, label, color}
    palette: 'pastel', latexMaxPoints: 2000
  };
  let annSeq = 0, lastPD = null, chart = null;
  const UNIT_LABEL = { HZ: 'Hz', KHZ: 'kHz', MHZ: 'MHz', GHZ: 'GHz', THZ: 'THz' };
  const touched = { xTitle: false, yTitle: false };

  /* ---------- helpers ---------- */
  function setStatus(msg, ms = 2500) {
    const s = $('status'); if (!s) return;
    s.textContent = msg || ''; clearTimeout(setStatus._t);
    if (ms && msg) setStatus._t = setTimeout(() => { s.textContent = ''; }, ms);
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined) e.append(c);
    return e;
  }
  function download(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = el('a', { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((res, rej) => {
      const ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(new Error('copy')); } catch (e) { rej(e); }
      ta.remove();
    });
  }
  const baseName = () => (state.axes.title || 'plot').trim().replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'plot';
  const fmt6 = v => Number.isFinite(v) ? +v.toPrecision(6) : null;

  /* ---------- rendu graphe ---------- */
  function renderNow() {
    lastPD = C.buildPlotData(state);
    $('chartEmpty').hidden = lastPD.series.length > 0;
    if (!window.Chart) { setStatus('Chart.js non chargé (CDN) — CSV et LaTeX restent disponibles', 6000); return; }
    chart = C.render(lastPD, $('chartCanvas'), { onRangeChange: setAxisRange });
  }
  const scheduleRender = debounce(renderNow, 100);

  // appelé après zoom/pan : la vue devient les limites d'axes (donc celles des exports)
  function setAxisRange(r) {
    state.axes.x.min = fmt6(r.xMin); state.axes.x.max = fmt6(r.xMax);
    state.axes.y.min = fmt6(r.yMin); state.axes.y.max = fmt6(r.yMax);
    $('xMin').value = state.axes.x.min ?? ''; $('xMax').value = state.axes.x.max ?? '';
    $('yMin').value = state.axes.y.min ?? ''; $('yMax').value = state.axes.y.max ?? '';
  }
  function resetZoom() {
    state.axes.x.min = state.axes.x.max = state.axes.y.min = state.axes.y.max = null;
    ['xMin', 'xMax', 'yMin', 'yMax'].forEach(id => { $(id).value = ''; });
    scheduleRender(); setStatus('Échelle automatique');
  }

  /* ---------- données ---------- */
  function setChip(msg, err) { const c = $('infoChip'); c.textContent = msg; c.classList.toggle('err', !!err); }

  function parseNow() {
    const text = $('inputText').value; state.text = text;
    if (!text.trim()) { state.touchstone = null; $('tsBanner').hidden = true; clearTable(); return; }
    const ts = P.detectTouchstone(text);
    state.touchstone = ts;
    $('tsBanner').hidden = !ts;
    if (ts) { const u = (ts.options && ts.options.freqUnit) || 'HZ'; $('tsInfo').textContent = `${ts.nPorts} port${ts.nPorts > 1 ? 's' : ''}, ${ts.format}, ${UNIT_LABEL[u] || u}, ${ts.rows.length} points`; }
    else state.source = 'table';
    if (ts && state.source === 'touchstone') { const r = P.touchstoneToTable(ts); applyTable(r.table, r.suggest); return; }
    const sepSel = $('sepSelect').value;
    const sep = sepSel === 'custom' ? ($('customSep').value || 'auto') : sepSel;
    const t = P.parseTable(text, { sep, header: $('headerMode').value });
    if (!t.ok) { setChip(t.message, true); clearTable(false); return; }
    applyTable(t, null);
  }
  const parseSoon = debounce(parseNow, 250);

  function showSParams() {
    if (!state.touchstone) return;
    state.source = 'touchstone';
    const r = P.touchstoneToTable(state.touchstone);
    applyTable(r.table, r.suggest);
    setStatus('Paramètres S affichés');
  }

  function clearTable(resetChip = true) {
    state.table = null; state.series = [];
    renderXSelect(); renderSeriesList(); renderAnnList(); renderPreview();
    if (resetChip) setChip('— colle des données pour commencer —');
    scheduleRender();
  }

  function applyTable(t, suggest) {
    const old = new Map(state.series.map(s => [s.name0, s]));
    const sameHeader = old.size === t.names.length && t.names.every(n => old.has(n)); // même fichier ré-analysé : on garde les réglages
    const pal = C.palettes[state.palette] || C.palettes.pastel;
    state.table = t;
    state.series = t.names.map((name, i) => {
      const o = sameHeader ? old.get(name) : null;
      return o ? Object.assign(o, { col: i })
               : { col: i, name0: name, label: name, color: pal[Math.max(0, i - 1) % pal.length], colorAuto: true, k: 0, on: false };
    });
    if (suggest) { state.x = suggest.x; suggest.on.forEach(i => { if (state.series[i]) state.series[i].on = true; }); }
    else if (!sameHeader || state.x >= t.nCols) state.x = 0;
    if (!state.series.some(s => s.on && s.col !== state.x)) { const f = state.series.find(s => s.col !== state.x); if (f) f.on = true; }
    if (suggest) {
      const ax = state.axes.x;
      ax.unitIn = suggest.unitIn; ax.unitOut = suggest.unitOut;
      $('unitIn').value = String(suggest.unitIn); $('unitOut').value = String(suggest.unitOut);
      if (!touched.xTitle || !ax.title) { ax.title = suggest.xTitle; $('xTitle').value = ax.title; }
      if (!touched.yTitle || !state.axes.y.title) { state.axes.y.title = suggest.yTitle; $('yTitle').value = suggest.yTitle; }
    }
    // une annotation accrochée à une série disparue redevient libre
    for (const a of state.ann) if (a.series !== null && !state.series.some(s => s.col === a.series)) a.series = null;
    setChip('✔ ' + t.info);
    renderXSelect(); renderSeriesList(); renderAnnList(); renderPreview(); scheduleRender();
  }

  /* ---------- panneaux ---------- */
  function renderXSelect() {
    const sel = $('xSelect'); sel.innerHTML = '';
    if (!state.table) { sel.append(el('option', { text: '—' })); sel.disabled = true; return; }
    sel.disabled = false;
    state.table.names.forEach((n, i) => sel.append(el('option', { value: String(i), text: n })));
    sel.value = String(state.x);
  }

  function renderSeriesList() {
    const list = $('seriesList'); list.innerHTML = '';
    if (!state.table) { list.append(el('div', { class: 'muted', text: 'Aucune donnée' })); return; }
    for (const s of state.series) {
      if (s.col === state.x) continue;
      const cb = el('input', { type: 'checkbox', title: 'Tracer cette colonne' }); cb.checked = s.on;
      cb.addEventListener('change', () => { s.on = cb.checked; renderAnnList(); scheduleRender(); });
      const color = el('input', { type: 'color', value: s.color, title: 'Couleur' });
      color.addEventListener('input', () => { s.color = color.value; s.colorAuto = false; scheduleRender(); });
      const label = el('input', { type: 'text', value: s.label, title: 'Nom (légende et exports)' });
      label.addEventListener('input', () => { s.label = label.value; scheduleRender(); });
      const range = el('input', { type: 'range', min: 0, max: 50, step: 1, value: s.k, title: 'Lissage : moyenne glissante sur ±k points' });
      const kLab = el('span', { class: 'small val', text: s.k ? `±${s.k} pts` : 'brut' });
      range.addEventListener('input', () => { s.k = Number(range.value); kLab.textContent = s.k ? `±${s.k} pts` : 'brut'; scheduleRender(); });
      list.append(el('div', { class: 'item' }, cb, color, label, el('span', { class: 'break' }), el('span', { class: 'small', text: 'lissage' }), range, kLab));
    }
  }

  function seriesSelect(a) {
    const sel = el('select', { title: 'Accrocher le marqueur à une série (y calculé)' });
    sel.append(el('option', { value: '', text: '— libre —' }));
    for (const s of state.series) if (s.on && s.col !== state.x) sel.append(el('option', { value: String(s.col), text: s.label }));
    sel.value = a.series === null ? '' : String(a.series);
    if (sel.value === '' && a.series !== null) a.series = null;
    return sel;
  }
  function renderAnnList() {
    const list = $('annList'); list.innerHTML = '';
    if (!state.ann.length) { list.append(el('div', { class: 'muted', text: 'Aucune ligne ni marqueur' })); return; }
    const KIND = { v: ['│', 'Ligne verticale'], h: ['─', 'Ligne horizontale'], m: ['●', 'Marqueur'] };
    for (const a of state.ann) {
      const numIn = (key, ph) => {
        const i = el('input', { type: 'number', step: 'any', placeholder: ph, title: ph, value: a[key] ?? '' });
        i.addEventListener('input', () => { a[key] = i.value === '' ? null : Number(i.value); scheduleRender(); });
        return i;
      };
      const parts = [el('span', { class: 'kind', text: KIND[a.kind][0], title: KIND[a.kind][1] })];
      if (a.kind === 'v') parts.push(numIn('x', 'x'));
      else if (a.kind === 'h') parts.push(numIn('y', 'y'));
      else {
        const xi = numIn('x', 'x'), sel = seriesSelect(a), yi = numIn('y', 'y');
        yi.disabled = a.series !== null;
        sel.addEventListener('change', () => { a.series = sel.value === '' ? null : Number(sel.value); yi.disabled = a.series !== null; scheduleRender(); });
        parts.push(xi, sel, yi);
      }
      const label = el('input', { type: 'text', placeholder: 'texte', title: 'Texte affiché', value: a.label || '' });
      label.addEventListener('input', () => { a.label = label.value; scheduleRender(); });
      const color = el('input', { type: 'color', value: a.color || '#e11d48', title: 'Couleur' });
      color.addEventListener('input', () => { a.color = color.value; scheduleRender(); });
      const del = el('button', { type: 'button', class: 'btn ghost icon', title: 'Supprimer', text: '✕' });
      del.addEventListener('click', () => { state.ann = state.ann.filter(z => z !== a); renderAnnList(); scheduleRender(); });
      list.append(el('div', { class: 'item' }, ...parts, label, color, del));
    }
  }
  function currentRange() {
    if (chart && chart.scales && chart.scales.x) return { x0: chart.scales.x.min, x1: chart.scales.x.max, y0: chart.scales.y.min, y1: chart.scales.y.max };
    return { x0: 0, x1: 1, y0: 0, y1: 1 };
  }
  function addAnn(kind) {
    const r = currentRange(); const mid = (a, b) => +((a + b) / 2).toPrecision(4);
    const first = state.series.find(s => s.on && s.col !== state.x);
    const onSeries = kind === 'm' && !!first;
    state.ann.push({
      id: ++annSeq, kind,
      x: kind === 'h' ? null : mid(r.x0, r.x1),
      y: (kind === 'v' || onSeries) ? null : mid(r.y0, r.y1),
      series: onSeries ? first.col : null,
      label: '', color: onSeries ? first.color : '#e11d48'
    });
    renderAnnList(); scheduleRender();
  }

  function renderPreview() {
    const wrap = $('previewWrap'), t = state.table;
    $('previewMeta').textContent = t ? `(${t.nRows} lignes × ${t.nCols} colonnes)` : '';
    wrap.innerHTML = '';
    if (!t || !$('previewDetails').open) return;
    const tbl = el('table', { class: 'preview-table' });
    tbl.append(el('thead', null, el('tr', null, ...t.names.map(n => el('th', { text: n })))));
    const tb = el('tbody'); const max = Math.min(200, t.rows.length);
    for (let r = 0; r < max; r++) tb.append(el('tr', null, ...t.rows[r].map(c => el('td', { text: c }))));
    tbl.append(tb); wrap.append(tbl);
    if (t.rows.length > max) wrap.append(el('div', { class: 'muted', text: `… ${t.rows.length - max} lignes non affichées` }));
  }

  /* ---------- exports (toujours sur les données tracées) ---------- */
  function ensurePlot() { renderNow(); if (!lastPD || !lastPD.series.length) { setStatus('Rien à exporter — coche au moins une série'); return false; } return true; }
  function exportPNG() {
    if (!ensurePlot()) return;
    if (!chart) { setStatus('PNG indisponible sans Chart.js'); return; }
    const a = el('a', { href: C.toPNG(chart, 2), download: baseName() + '.png' });
    document.body.appendChild(a); a.click(); a.remove(); setStatus('PNG téléchargé');
  }
  function exportLatex() {
    if (!ensurePlot()) return;
    const tex = C.toLaTeX(lastPD, { maxPoints: state.latexMaxPoints });
    download(baseName() + '.tex', tex, 'text/x-tex;charset=utf-8');
    copyText(tex).then(() => setStatus('LaTeX copié et téléchargé'), () => setStatus('LaTeX téléchargé'));
  }
  function exportCSV() { if (!ensurePlot()) return; download(baseName() + '.csv', C.toCSV(lastPD, ','), 'text/csv;charset=utf-8'); setStatus('CSV téléchargé'); }
  function copyTSV() { if (!ensurePlot()) return; copyText(C.toCSV(lastPD, '\t')).then(() => setStatus('Données copiées (TSV)'), () => setStatus('Échec de la copie')); }

  /* ---------- câblage ---------- */
  function bindAxis(id, obj, key, isNum) {
    const e = $(id);
    e.addEventListener('input', () => {
      obj[key] = isNum ? (e.value === '' ? null : Number(e.value)) : e.value;
      if (id === 'xTitle') touched.xTitle = true;
      if (id === 'yTitle') touched.yTitle = true;
      scheduleRender();
    });
  }
  bindAxis('chartTitle', state.axes, 'title', false);
  bindAxis('xTitle', state.axes.x, 'title', false); bindAxis('xMin', state.axes.x, 'min', true); bindAxis('xMax', state.axes.x, 'max', true); bindAxis('xStep', state.axes.x, 'step', true);
  bindAxis('yTitle', state.axes.y, 'title', false); bindAxis('yMin', state.axes.y, 'min', true); bindAxis('yMax', state.axes.y, 'max', true); bindAxis('yStep', state.axes.y, 'step', true);
  $('unitIn').addEventListener('change', e => { state.axes.x.unitIn = Number(e.target.value); scheduleRender(); });
  $('unitOut').addEventListener('change', e => { state.axes.x.unitOut = Number(e.target.value); scheduleRender(); });
  $('yScale').addEventListener('change', e => { state.axes.y.scale = Number(e.target.value); scheduleRender(); });
  $('latexMaxPoints').addEventListener('input', e => { state.latexMaxPoints = Number(e.target.value) || 2000; });
  $('paletteSelect').addEventListener('change', e => {
    state.palette = e.target.value;
    const pal = C.palettes[state.palette] || C.palettes.pastel;
    for (const s of state.series) if (s.colorAuto) s.color = pal[Math.max(0, s.col - 1) % pal.length];
    renderSeriesList(); renderAnnList(); scheduleRender();
  });

  $('inputText').addEventListener('input', parseSoon);
  $('inputText').addEventListener('keydown', e => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); parseNow(); } });
  $('sepSelect').addEventListener('change', () => { $('customSep').hidden = $('sepSelect').value !== 'custom'; parseNow(); });
  $('customSep').addEventListener('input', parseSoon);
  $('headerMode').addEventListener('change', parseNow);
  $('btnShowS').addEventListener('click', showSParams);
  $('btnClear').addEventListener('click', () => {
    $('inputText').value = ''; state.ann = []; state.touchstone = null; state.source = 'table'; $('tsBanner').hidden = true;
    clearTable(); setStatus('Effacé');
  });
  $('xSelect').addEventListener('change', e => {
    state.x = Number(e.target.value);
    if (!state.series.some(s => s.on && s.col !== state.x)) { const f = state.series.find(s => s.col !== state.x); if (f) f.on = true; }
    renderSeriesList(); renderAnnList(); scheduleRender();
  });
  $('btnAddV').addEventListener('click', () => addAnn('v'));
  $('btnAddH').addEventListener('click', () => addAnn('h'));
  $('btnAddM').addEventListener('click', () => addAnn('m'));
  $('btnResetZoom').addEventListener('click', resetZoom);
  $('btnPNG').addEventListener('click', exportPNG);
  $('btnLatex').addEventListener('click', exportLatex);
  $('btnCSV').addEventListener('click', exportCSV);
  $('btnCopy').addEventListener('click', copyTSV);
  $('previewDetails').addEventListener('toggle', renderPreview);

  /* ---------- init ---------- */
  renderXSelect(); renderSeriesList(); renderAnnList(); renderPreview();
  if (!window.Chart) setStatus('Chart.js non chargé (CDN) — CSV et LaTeX restent disponibles', 6000);
  if ($('inputText').value.trim()) parseNow();   // contenu restauré par le navigateur après rechargement

  window.plotterApp = { state, parseNow, renderNow, showSParams, addAnn, setAxisRange, resetZoom, exportPNG, exportLatex, exportCSV, copyTSV, getPlotData: () => lastPD };
})();
