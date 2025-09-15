// javascript/split_columns.js
// Outil: scinder un texte en colonnes selon séparateur détecté / choisi
// Fonctions : détection automatique de séparateur, parsing robuste (gestion de guillemets), aperçu, sélection de colonnes, copier/télécharger.

(function(){
  'use strict';

  // ---- DOM ----
  const ta = document.getElementById('inputText');
  const sepSelect = document.getElementById('sepSelect');
  const customSepGroup = document.getElementById('customSepGroup');
  const customSepInput = document.getElementById('customSep');
  const btnDetect = document.getElementById('btnDetect');
  const btnParse = document.getElementById('btnParse');
  const btnClear = document.getElementById('btnClear');
  const tableWrapper = document.getElementById('tableWrapper');
  const detectedInfo = document.getElementById('detectedInfo');
  const columnsList = document.getElementById('columnsList');
  const btnCopyCols = document.getElementById('btnCopyCols');
  const btnDownloadCols = document.getElementById('btnDownloadCols');
  const status = document.getElementById('status');

  if (!ta || !sepSelect || !tableWrapper || !columnsList) {
    console.error('split_columns: éléments DOM manquants.');
    return;
  }

  // ---- Helpers ----
  function setStatus(msg, timeout=3000){
    if (!status) return;
    status.textContent = msg || '';
    if (timeout && msg) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(()=> status.textContent = '', timeout);
    }
  }

  function parseLines(text){
    return text.replace(/\r/g,'').split('\n').map(l=>l.replace(/\u00A0/g,' '));
  }

  function isBlankOrComment(l){
    if (!l) return true;
    const t = l.trim();
    if (!t) return true;
    return t.startsWith('#') || t.startsWith('!');
  }

  // Split respecting quotes for single-character separators (like , ; | / \t etc.)
  function splitRespectingQuotes(line, sep){
    // If sep is whitespace token (space or \t), collapse consecutive whitespace
    if (sep === '\\t') sep = '\t';
    if (sep === ' ') {
      // naive split by any whitespace sequence
      return line.trim().split(/\s+/);
    }

    // If separator is '.' treat specially? We will still split on '.' but this is risky for decimals.
    // We'll still allow user to choose '.' but auto-detection will avoid selecting '.' if decimals present.

    const tokens = [];
    let cur = '';
    let inQuote = false;
    let qChar = null;
    for (let i=0;i<line.length;i++){
      const ch = line[i];
      if (!inQuote && (ch === '"' || ch === "'")){
        inQuote = true; qChar = ch; continue;
      }
      if (inQuote && ch === qChar){
        inQuote = false; qChar = null; continue;
      }
      if (!inQuote && ch === sep){
        tokens.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    tokens.push(cur);
    return tokens.map(t=> t.trim());
  }

  // Fallback splitter that splits on sep string (for multi-char custom seps)
  function splitByString(line, sepStr){
    if (sepStr === '\\t') return line.split('\t');
    if (sepStr === ' ') return line.trim().split(/\s+/);
    return line.split(sepStr).map(t=>t.trim());
  }

  function trySplitLine(line, sep){
    // choose method based on sep length
    if (!sep) return [line];
    if (sep.length === 1) return splitRespectingQuotes(line, sep);
    return splitByString(line, sep);
  }

  // Score candidate separator by tokens per non-empty line and consistency
  function scoreSeparator(lines, sep){
    const counts = [];
    const sampleSize = Math.min(200, lines.length);
    for (let i=0, seen=0; i<lines.length && seen < sampleSize; i++){
      const l = lines[i];
      if (isBlankOrComment(l)) continue;
      seen++;
      let toks;
      try{ toks = trySplitLine(l, sep); } catch(e){ toks = [l]; }
      // ignore lines that would split into 1 token for separators that are not whitespace (likely wrong)
      counts.push(toks.length);
    }
    if (counts.length === 0) return {score:0, mean:0, std:0};
    const mean = counts.reduce((a,b)=>a+b,0)/counts.length;
    const variance = counts.reduce((a,b)=> a + Math.pow(b-mean,2),0)/counts.length;
    const std = Math.sqrt(variance);
    // score prefers higher mean (more columns) and low std (consistent columns)
    const score = mean > 1 ? mean * (1/(1+std)) : 0;
    return {score, mean, std};
  }

  function detectSeparator(text){
    const lines = parseLines(text).filter(l=>!isBlankOrComment(l));
    if (!lines.length) return {sep:null, reason:'Aucune donnée'};

    // candidates: comma, semicolon, tab, pipe, space, slash, colon, custom '.'
    const candidates = [',',';','\t','|',' ','/',';',':','.','-','\\\n'];
    const results = [];
    for (const c of candidates){
      const r = scoreSeparator(lines, c);
      results.push({sep:c, ...r});
    }

    // Also include detection for semicolon and comma combined? skip

    // Filter out '.' if lines contain decimal numbers with '.' in many tokens -> penalize
    const decimalDots = lines.slice(0,50).reduce((acc,l)=> acc + ( (l.match(/\d+\.\d+/g) || []).length ), 0);
    if (decimalDots > 10) {
      // penalize '.' heavily
      for (const r of results) if (r.sep === '.') r.score *= 0.2;
    }

    // Choose highest score
    results.sort((a,b)=> b.score - a.score);
    const best = results[0];

    // If best score is low, return auto but unknown
    if (best.score < 1) return {sep:null, reason:'Aucun séparateur clair détecté', details:results};

    // map '\t' back to actual tab char for use
    const sepOut = best.sep === '\\t' ? '\t' : best.sep;
    return {sep:sepOut, reason:'détecté automatiquement', details:best};
  }

  // Build table (2D array) with consistent column count -> pad short rows with empty strings
  function buildTable(lines, sepChar){
    const rows = [];
    let maxCols = 0;
    for (const raw of lines){
      if (isBlankOrComment(raw)) continue;
      const l = raw.trim();
      if (!l) continue;
      const toks = trySplitLine(l, sepChar || ',');
      rows.push(toks);
      if (toks.length > maxCols) maxCols = toks.length;
    }
    // pad
    for (let i=0;i<rows.length;i++){
      while (rows[i].length < maxCols) rows[i].push('');
    }
    return {rows, maxCols};
  }

  function looksLikeHeader(row){
    // consider it a header if many tokens are non-numeric or contain letters or underscores
    let nonNumeric = 0;
    let total = 0;
    for (const t of row){
      if (t === undefined || t === null) continue;
      const s = String(t).trim();
      if (!s) { total++; continue; }
      total++;
      // if token includes letters or underscores or spaces -> header-like
      if (/[A-Za-z_\-]/.test(s)) nonNumeric++;
      else if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) nonNumeric++;
    }
    if (total === 0) return false;
    return (nonNumeric/total) > 0.5; // more than half non-numeric => header
  }

  // Render preview table (first N rows)
  function renderPreview(tableObj, hasHeader){
    const {rows, maxCols} = tableObj;
    tableWrapper.innerHTML = '';
    if (!rows.length){
      tableWrapper.innerHTML = '<div class="empty-state">Aucune donnée analysée</div>';
      return;
    }

    const tbl = document.createElement('table');
    tbl.className = 'table-preview';
    const thead = document.createElement('thead');
    const thr = document.createElement('tr');

    // header row: use first row if header detected, else generic names
    const headerRow = hasHeader ? rows[0] : null;
    const colNames = [];
    for (let c=0;c<maxCols;c++){
      const th = document.createElement('th');
      const name = headerRow ? (headerRow[c] || `col${c+1}`) : `col${c+1}`;
      th.textContent = name;
      thr.appendChild(th);
      colNames.push(name);
    }
    thead.appendChild(thr);
    tbl.appendChild(thead);

    const tbody = document.createElement('tbody');
    // start from 1 if header used
    const start = hasHeader ? 1 : 0;
    const maxPreview = 200;
    for (let r = start; r < rows.length && r < start + maxPreview; r++){
      const tr = document.createElement('tr');
      for (let c=0;c<maxCols;c++){
        const td = document.createElement('td');
        td.textContent = rows[r][c] || '';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    tableWrapper.appendChild(tbl);

    return {colNames, maxCols, startIndex: start};
  }

  function renderColumnsList(colNames, maxCols){
    columnsList.innerHTML = '';
    if (!maxCols || maxCols <= 0) { columnsList.textContent = '—'; return; }

    // Controls: select all / none / invert
    const ctrlDiv = document.createElement('div');
    ctrlDiv.style.display = 'flex';
    ctrlDiv.style.gap = '8px';
    ctrlDiv.style.marginBottom = '6px';
    ctrlDiv.innerHTML = `
      <button id="selAll" class="ghost" type="button" style="padding:6px 8px;">Tout</button>
      <button id="selNone" class="ghost" type="button" style="padding:6px 8px;">Aucun</button>
      <button id="selInv" class="ghost" type="button" style="padding:6px 8px;">Inverser</button>
    `;
    columnsList.appendChild(ctrlDiv);

    const listWrap = document.createElement('div');
    listWrap.style.display = 'flex';
    listWrap.style.flexDirection = 'column';
    listWrap.style.gap = '6px';

    for (let i=0;i<maxCols;i++){
      const wrap = document.createElement('div');
      wrap.className = 'col-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.colIndex = i;
      // default behavior: if first column exists, preselect it and one other column (like 1+2)
      if (i === 0 || i === 1) cb.checked = true;
      const lbl = document.createElement('label');
      lbl.textContent = colNames && colNames[i] ? colNames[i] : `col${i+1}`;
      wrap.appendChild(cb);
      wrap.appendChild(lbl);
      listWrap.appendChild(wrap);
    }

    columnsList.appendChild(listWrap);

    // attach control buttons behavior
    const btnAll = document.getElementById('selAll');
    const btnNone = document.getElementById('selNone');
    const btnInv = document.getElementById('selInv');

    btnAll.addEventListener('click', ()=>{ listWrap.querySelectorAll('input[type=checkbox]').forEach(x=>x.checked = true); });
    btnNone.addEventListener('click', ()=>{ listWrap.querySelectorAll('input[type=checkbox]').forEach(x=>x.checked = false); });
    btnInv.addEventListener('click', ()=>{ listWrap.querySelectorAll('input[type=checkbox]').forEach(x=> x.checked = !x.checked); });
  }

  function gatherSelectedColumns(){
    const boxes = columnsList.querySelectorAll('input[type=checkbox]');
    const selected = [];
    boxes.forEach(b=>{ if (b.checked) selected.push(Number(b.dataset.colIndex)); });
    return selected;
  }

  function buildOutputFromSelection(tableObj, selectedCols, hasHeader, outSep=' '){
    if (!selectedCols || !selectedCols.length) return '';
    const rows = tableObj.rows;
    const start = tableObj.startIndex || 0;
    const lines = [];
    // include header line if exists
    if (hasHeader){
      const headerTokens = selectedCols.map(ci => rows[0][ci] || '');
      lines.push(headerTokens.join(outSep));
    }
    for (let r = start; r < rows.length; r++){
      const toks = selectedCols.map(ci => rows[r][ci] || '');
      lines.push(toks.join(outSep));
    }
    return lines.join('\n');
  }

  function downloadText(filename, text){
    const blob = new Blob([text], {type:'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'export.txt';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ---- State ----
  let lastTable = null; // {rows, maxCols}
  let lastHasHeader = false;
  let lastColNames = [];

  // ---- UI interactions ----
  sepSelect.addEventListener('change', ()=>{
    if (sepSelect.value === 'custom') customSepGroup.hidden = false;
    else customSepGroup.hidden = true;
  });

  btnClear.addEventListener('click', ()=>{
    ta.value = '';
    tableWrapper.innerHTML = '<div class="empty-state">Aucune donnée analysée</div>';
    columnsList.textContent = '—';
    detectedInfo.textContent = 'Séparateur détecté : —';
    lastTable = null;
    setStatus('Effacé');
  });

  btnDetect.addEventListener('click', ()=>{
    const txt = ta.value || '';
    if (!txt.trim()){ setStatus('Rien à analyser'); return; }
    const det = detectSeparator(txt);
    if (det.sep){
      detectedInfo.textContent = `Séparateur détecté : ${det.sep === '\t' ? 'Tabulation' : det.sep} — ${det.reason}`;
      // set the select to auto (keep custom hidden)
      sepSelect.value = 'auto';
      customSepGroup.hidden = true;
    } else {
      detectedInfo.textContent = `Séparateur détecté : — (${det.reason})`;
    }
    setStatus('Détection terminée');
  });

  btnParse.addEventListener('click', ()=>{
    const txt = ta.value || '';
    if (!txt.trim()){ setStatus('Rien à analyser'); return; }
    const lines = parseLines(txt);

    // determine separator to use
    let sepChoice = sepSelect.value;
    if (sepChoice === 'auto' || !sepChoice){
      const det = detectSeparator(txt);
      sepChoice = det.sep || ',';
      if (!det.sep) setStatus('Aucun séparateur clair détecté — utilisation de la virgule par défaut');
      detectedInfo.textContent = `Séparateur utilisé : ${sepChoice === '\t' ? 'Tabulation' : sepChoice}`;
    } else if (sepChoice === 'custom'){
      const cs = (customSepInput.value || '').trim();
      if (!cs){ setStatus('Entrez un séparateur personnalisé'); return; }
      sepChoice = cs;
      detectedInfo.textContent = `Séparateur personnalisé utilisé : ${cs}`;
    } else {
      detectedInfo.textContent = `Séparateur utilisé : ${sepChoice === '\t' ? 'Tabulation' : sepChoice}`;
    }

    // build table
    const tableObj = buildTable(lines, sepChoice);

    // detect header by examining first non-empty row
    const firstRow = tableObj.rows.length ? tableObj.rows[0] : [];
    const headerLikely = looksLikeHeader(firstRow);
    lastTable = tableObj; lastHasHeader = headerLikely;

    const previewInfo = renderPreview(tableObj, headerLikely);
    lastColNames = previewInfo.colNames || [];
    lastTable.startIndex = previewInfo.startIndex;
    renderColumnsList(lastColNames, previewInfo.maxCols);

    setStatus('Analyse terminée');
  });

  btnCopyCols.addEventListener('click', async ()=>{
    if (!lastTable){ setStatus('Aucune table analysée'); return; }
    const sel = gatherSelectedColumns();
    if (!sel.length){ setStatus('Sélectionnez au moins une colonne'); return; }
    const out = buildOutputFromSelection(lastTable, sel, lastHasHeader, '\t');
    if (!out){ setStatus('Aucune donnée à copier'); return; }
    try{
      if (navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(out);
        setStatus('Colonnes copiées dans le presse-papiers');
      } else {
        const taFake = document.createElement('textarea'); taFake.value = out; document.body.appendChild(taFake); taFake.select(); document.execCommand('copy'); taFake.remove();
        setStatus('Copié (fallback)');
      }
    }catch(e){ console.error(e); setStatus('Échec du copier'); }
  });

  btnDownloadCols.addEventListener('click', ()=>{
    if (!lastTable){ setStatus('Aucune table analysée'); return; }
    const sel = gatherSelectedColumns();
    if (!sel.length){ setStatus('Sélectionnez au moins une colonne'); return; }
    const out = buildOutputFromSelection(lastTable, sel, lastHasHeader, ',');
    if (!out){ setStatus('Aucune donnée à télécharger'); return; }
    // filename based on selected columns
    const names = sel.map(i => (lastColNames[i] || `col${i+1}`).replace(/[\s,\/\\]+/g,'_')).join('-');
    const filename = `export_${names || 'cols'}.csv`;
    downloadText(filename, out);
    setStatus(`Téléchargement: ${filename}`);
  });

  // keyboard shortcut: Ctrl+Enter to parse
  ta.addEventListener('keydown', (ev)=>{
    if (ev.ctrlKey && ev.key === 'Enter') { ev.preventDefault(); btnParse.click(); }
  });

})();
