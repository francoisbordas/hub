// plotter_1.js
// Parsing / détection / construction du tableau / preview
// Expose window.plotterCore API used by plotter_2.js and plotter_3.js

(function () {
  'use strict';

  /* ---------- small DOM helper ---------- */
  function getEl(id) {
    if (!id) return null;
    if (typeof id === 'string') return document.getElementById(id);
    return id;
  }

  /* ---------- status helper (affiche dans #status si présent) ---------- */
  function setStatus(msg, t = 3000) {
    const s = getEl('status');
    if (!s) return;
    s.textContent = msg || '';
    if (t && msg) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => { if (s) s.textContent = ''; }, t);
    }
  }

  /* ---------- basic text utilities ---------- */
  function parseLines(txt) { return txt.replace(/\r/g, '').split('\n'); }
  function isBlankOrComment(l) {
    if (!l) return true;
    const t = l.trim();
    if (!t) return true;
    return t.startsWith('#') || t.startsWith('!') || t.startsWith(';') || t.startsWith('//') || t.startsWith('*');
  }
  function isNumericString(tok) {
    if (tok === undefined || tok === null) return false;
    tok = String(tok).trim().replace(',', '.');
    return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(tok);
  }

  /* ---------- splitting/parsing (respect quotes) ---------- */
  function splitRespectingQuotes(line, sep) {
    if (sep === '\\t') sep = '\t';
    if (sep === ' ') return line.trim().split(/\s+/);
    const out = []; let cur = ''; let inQ = false; let q = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (!inQ && (ch === '"' || ch === "'")) { inQ = true; q = ch; continue; }
      if (inQ && ch === q) { inQ = false; q = null; continue; }
      if (!inQ && ch === sep) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim());
  }
  function splitByString(line, sepStr) {
    if (sepStr === '\\t') return line.split('\t');
    if (sepStr === ' ') return line.trim().split(/\s+/);
    return line.split(sepStr).map(x => x.trim());
  }
  function trySplitLine(line, sep) {
    if (!sep) return [line];
    if (sep.length === 1) return splitRespectingQuotes(line, sep);
    return splitByString(line, sep);
  }

  /* ---------- score candidate separators to auto-detect ---------- */
  function scoreSeparator(lines, sep) {
    const counts = []; const sampleSize = Math.min(200, lines.length);
    for (let i = 0, seen = 0; i < lines.length && seen < sampleSize; i++) {
      const l = lines[i];
      if (isBlankOrComment(l)) continue;
      seen++;
      let toks;
      try { toks = trySplitLine(l, sep); } catch (e) { toks = [l]; }
      counts.push(toks.length);
    }
    if (!counts.length) return { score: 0, mean: 0, std: 0 };
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length;
    const std = Math.sqrt(variance);
    const score = mean > 1 ? mean * (1 / (1 + std)) : 0;
    return { score, mean, std };
  }

  function detectSeparator(text) {
    const lines = parseLines(text).filter(l => !isBlankOrComment(l));
    if (!lines.length) return { sep: null, reason: 'Aucune donnée' };
    // sensible candidates (order not important)
    const candidates = [',',';','\t','|',' ',':','/','\\t'];
    const results = candidates.map(c => Object.assign({ sep: c }, scoreSeparator(lines, c) ));
    // penalize '.' if many decimals (likely decimal separator)
    const decimalDots = lines.slice(0,50).reduce((acc,l)=> acc + ((l.match(/\d+\.\d+/g)||[]).length), 0);
    if (decimalDots > 10) results.forEach(r=>{ if (r.sep === '.') r.score *= 0.2; });
    results.sort((a,b)=> b.score - a.score);
    if (!results[0] || results[0].score < 1) return { sep: null, reason: 'Aucun séparateur clair' };
    return { sep: results[0].sep, reason: 'détecté' };
  }

  /* ---------- build table: rows[][] and maxCols ---------- */
  function buildTable(lines, sepChar) {
    const rows = []; let maxCols = 0;
    for (const raw of lines) {
      if (isBlankOrComment(raw)) continue;
      const l = raw.trim();
      if (!l) continue;
      const toks = trySplitLine(l, sepChar || ',');
      rows.push(toks);
      if (toks.length > maxCols) maxCols = toks.length;
    }
    // pad rows to maxCols
    for (let i=0;i<rows.length;i++) while (rows[i].length < maxCols) rows[i].push('');
    return { rows, maxCols };
  }

  /* ---------- header detection ---------- */
  function looksLikeHeader(row) {
    if (!row || !row.length) return false;
    let nonNum = 0; let total = 0;
    for (const t of row) {
      if (t === undefined || t === null) continue;
      const s = String(t).trim();
      if (!s) { total++; continue; }
      total++;
      // letters or other non-simple-numeric tokens count as non-numeric
      if (/[A-Za-z_\-]/.test(s)) nonNum++;
      else if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) nonNum++;
    }
    if (!total) return false;
    return (nonNum/total) > 0.5;
  }

  /* ---------- preview rendering (creates small HTML table) ---------- */
  function renderPreviewTo(wrapperOrId, tableObj, headerFlag) {
    const wrapper = getEl(wrapperOrId) || getEl('tableWrapper');
    if (!wrapper) return { colNames: [], maxCols: 0, startIndex: 0 };
    wrapper.innerHTML = '';
    if (!tableObj || !tableObj.rows || !tableObj.rows.length) {
      wrapper.innerHTML = '<div class="empty small-muted">Aucune donnée</div>';
      return { colNames: [], maxCols: 0, startIndex: 0 };
    }
    const { rows, maxCols } = tableObj;
    const tbl = document.createElement('table');
    tbl.className = 'table-preview';
    tbl.style.width = 'max-content';
    // header
    const thead = document.createElement('thead');
    const thr = document.createElement('tr');
    const headerRow = headerFlag ? rows[0] : null;
    const colNamesLocal = [];
    for (let c=0;c<maxCols;c++){
      const th = document.createElement('th');
      th.textContent = headerRow ? (headerRow[c]||`Colonne ${c+1}`) : `Colonne ${c+1}`;
      th.style.padding = '6px';
      thr.appendChild(th);
      colNamesLocal.push(th.textContent);
    }
    thead.appendChild(thr);
    tbl.appendChild(thead);
    // body
    const tbody = document.createElement('tbody');
    const start = headerFlag ? 1 : 0;
    const maxPreview = 200;
    for (let r=start; r<rows.length && r<start+maxPreview; r++){
      const tr = document.createElement('tr');
      for (let c=0;c<maxCols;c++){
        const td = document.createElement('td');
        td.textContent = rows[r][c] || '';
        td.style.padding = '4px';
        td.style.whiteSpace = 'nowrap';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    wrapper.appendChild(tbl);
    return { colNames: colNamesLocal, maxCols, startIndex: start };
  }

  /* ---------- populate column controls (simple implementations) ----------
     options may contain:
       columnsListId, xSelectId, yMultiId, xContainerId, yContainerId
     If elements are missing, function silently fills what it can.
  ---------------------------------------------------------------------- */
  function populateColumnControlsFrom(colNamesLocal, maxCols, options = {}) {
    const {
      columnsListId = 'columnsList',
      xSelectId = 'xColumnSelect',
      yMultiId = 'yColumnsMulti',
      xContainerId = 'xColContainer',
      yContainerId = 'yColsContainer'
    } = options;

    const colNames = colNamesLocal && colNamesLocal.length ? colNamesLocal : Array.from({length:maxCols},(_,i)=>`Colonne ${i+1}`);

    // textual list
    const columnsList = getEl(columnsListId);
    if (columnsList) columnsList.textContent = colNames.join(', ');

    // optional <select> elements
    const xSelect = getEl(xSelectId);
    if (xSelect) {
      xSelect.innerHTML = '';
      for (let i=0;i<maxCols;i++){
        const o = document.createElement('option'); o.value = i; o.textContent = colNames[i]||`Col ${i+1}`; xSelect.appendChild(o);
      }
    }

    const yMulti = getEl(yMultiId);
    if (yMulti) {
      yMulti.innerHTML = '';
      for (let i=0;i<maxCols;i++){
        const o = document.createElement('option'); o.value = i; o.textContent = colNames[i]||`Col ${i+1}`; if (i===1) o.selected=true;
        yMulti.appendChild(o);
      }
    }

    // radio container for X
    const xContainer = getEl(xContainerId);
    if (xContainer) {
      xContainer.innerHTML = '';
      for (let i=0;i<maxCols;i++){
        const id = `fl_x_${i}`;
        const lbl = document.createElement('label'); lbl.style.marginRight='8px';
        const r = document.createElement('input'); r.type='radio'; r.name='fl_x'; r.value=i; r.id=id; if(i===0) r.checked=true;
        const span = document.createElement('span'); span.textContent = colNames[i] || `Col ${i+1}`;
        lbl.appendChild(r); lbl.appendChild(span);
        xContainer.appendChild(lbl);
      }
    }

    // checkbox container for Y
    const yContainer = getEl(yContainerId);
    if (yContainer) {
      yContainer.innerHTML = '';
      for (let i=0;i<maxCols;i++){
        const id = `fl_y_${i}`;
        const lbl = document.createElement('label'); lbl.style.marginRight='8px';
        const cb = document.createElement('input'); cb.type='checkbox'; cb.value=i; cb.id=id; if(i===1) cb.checked=true;
        const span = document.createElement('span'); span.textContent = colNames[i] || `Col ${i+1}`;
        lbl.appendChild(cb); lbl.appendChild(span);
        yContainer.appendChild(lbl);
      }
    }
  }

  /* ---------- state kept by this module ---------- */
  let lastTable = null;     // { rows: [[...]], maxCols, startIndex }
  let lastHasHeader = false;
  let colNames = [];

  /* ---------- public parse function: parseText(text, sep) ----------
     - text: raw pasted text
     - sep: separator string or 'auto' or null. If 'auto' or null, auto-detection is performed.
     Returns an object { ok: true/false, tableObj, colNames, headerDetected, sepUsed, message }
  ------------------------------------------------------------------ */
  function parseText(text, sep = 'auto', options = {}) {
    if (!text || !String(text).trim()) {
      setStatus('Rien à analyser');
      return { ok: false, message: 'empty' };
    }
    let usedSep = sep;
    const raw = String(text);
    if (!usedSep || usedSep === 'auto') {
      const det = detectSeparator(raw);
      usedSep = det.sep || ',';
      if (!det.sep) setStatus('Aucun séparateur clair — virgule par défaut', 4000);
    } else if (usedSep === 'custom') {
      // caller must pass the custom sep as options.customSep
      const cs = options.customSep || getEl('customSep') && getEl('customSep').value;
      if (!cs) { setStatus('Séparateur personnalisé manquant'); return { ok: false, message: 'custom missing' }; }
      usedSep = cs;
    }

    const lines = parseLines(raw);
    const tableObj = buildTable(lines, usedSep);
    const firstRow = tableObj.rows.length ? tableObj.rows[0] : [];
    lastHasHeader = looksLikeHeader(firstRow);

    // build colNames
    colNames = [];
    if (lastHasHeader) {
      for (let i=0;i<tableObj.maxCols;i++) colNames.push(tableObj.rows[0][i]||`Col ${i+1}`);
      tableObj.startIndex = 1;
    } else {
      for (let i=0;i<tableObj.maxCols;i++) colNames.push(`Col ${i+1}`);
      tableObj.startIndex = 0;
    }

    lastTable = tableObj;
    setStatus('Analyse OK');
    return { ok: true, tableObj, colNames: colNames.slice(), headerDetected: lastHasHeader, sepUsed: usedSep };
  }

  /* ---------- getters ---------- */
  function getLastTable() { return lastTable; }
  function getColNames() { return colNames.slice(); }
  function lastHasHeaderFlag() { return !!lastHasHeader; }

  /* ---------- convenience: parse textarea content and auto-update preview + controls ----------
     renderOptions may include: previewElement (id|el), columnsListId, xSelectId, yMultiId, xContainerId, yContainerId
     This is handy for plotter_3 which will call parseFromTextarea() on click.
  ------------------------------------------------------------------------------ */
  function parseFromTextarea(sep = 'auto', renderOptions = {}) {
    const ta = getEl('inputLeft');
    if (!ta) { setStatus('Zone d\'entrée introuvable'); return { ok:false, message:'no textarea' }; }
    const txt = (ta.value || '').trim();
    if (!txt) { setStatus('Rien à analyser'); return { ok:false, message:'empty' }; }
    const customSep = (sep === 'custom') ? (getEl('customSep') && getEl('customSep').value) : undefined;
    const res = parseText(txt, sep, { customSep });
    if (res.ok) {
      // render preview if requested
      const previewEl = renderOptions.previewElement || 'tableWrapper';
      const preview = renderPreviewTo(previewEl, res.tableObj, res.headerDetected);
      // populate controls
      populateColumnControlsFrom(preview.colNames && preview.colNames.length ? preview.colNames : res.colNames, preview.maxCols, renderOptions);
      return Object.assign({}, res, { preview });
    }
    return res;
  }

  /* ---------- expose API ---------- */
  window.plotterCore = {
    // parsing / detection
    detectSeparator,
    parseText,
    parseFromTextarea,
    // table accessors
    getLastTable,
    getColNames,
    lastHasHeaderFlag,
    // preview / UI helpers
    renderPreviewTo,
    populateColumnControls: populateColumnControlsFrom,
    // status helper
    setStatus
  };

})();
