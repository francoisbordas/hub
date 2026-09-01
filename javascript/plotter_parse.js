/* plotter_parse.js — Plotter : détection séparateur/en-tête, table numérique, Touchstone → table
   API (window.plotterParse ; aussi globalThis pour node) :
     parseTable(text, {sep:'auto'|'\t'|';'|','|'|'|'ws'|string, header:'auto'|'yes'|'no'})
       -> {ok, sep, header, names[], rows:string[][], cols:number[][], nRows, nCols, info, message}
     detectTouchstone(text)  -> résultat de ConverterCore.parseTouchstone, ou null
     touchstoneToTable(ts)   -> {table, suggest:{x, on[], xTitle, yTitle, unitIn, unitOut}}
     selfTest()              -> true (lève une Error sur la première fixture cassée)
   Dépend de converter_core.js (chargé avant) pour le Touchstone.
*/
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;

  const reNum = /^[+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?$/;
  const COMMENT_RE = /^\s*(#|!|\/\/|\*)/;
  const CANDIDATES = ['\t', ';', ',', '|', 'ws'];           // ordre = priorité en cas d'égalité
  const SEP_NAMES = { '\t': 'tabulation', ';': 'point-virgule', ',': 'virgule', '|': 'pipe', 'ws': 'espaces' };

  /* ---------- nombres (virgule décimale tolérée sauf si la virgule est le séparateur) ---------- */
  function normTok(tok, sep) { let t = String(tok).trim(); if (sep !== ',') t = t.replace(',', '.'); return t; }
  function isNum(tok, sep) { return reNum.test(normTok(tok, sep)); }
  function toNum(tok, sep) { const t = normTok(tok, sep); return reNum.test(t) ? Number(t) : NaN; }

  /* ---------- découpage ---------- */
  function splitRespectingQuotes(line, sep) {
    const out = []; let cur = ''; let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (!inQ && ch === sep) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }
  function splitLine(line, sep) {
    if (sep === 'ws') return line.trim().split(/\s+/);
    if (sep === '\t') return line.split('\t').map(s => s.trim());
    if (sep.length === 1) return splitRespectingQuotes(line, sep);
    return line.split(sep).map(s => s.trim());
  }

  /* ---------- détection du séparateur ----------
     score = (part des lignes ayant le nombre MODAL de tokens) × (part de tokens numériques).
     Un mode ≤ 1 (une seule colonne) élimine le candidat. */
  function scoreSep(lines, sep) {
    const counts = new Map(); let numTok = 0, totTok = 0;
    for (const l of lines) {
      const toks = splitLine(l, sep);
      counts.set(toks.length, (counts.get(toks.length) || 0) + 1);
      for (const t of toks) { if (t === '') continue; totTok++; if (isNum(t, sep)) numTok++; }
    }
    let mode = 0, modeCount = 0;
    for (const [k, v] of counts) if (v > modeCount || (v === modeCount && k > mode)) { mode = k; modeCount = v; }
    if (mode <= 1) return { score: 0, mode };
    return { score: (modeCount / lines.length) * (totTok ? numTok / totTok : 0), mode };
  }
  function detectSeparator(dataLines) {
    const sample = dataLines.slice(0, 200);
    let best = { sep: null, score: 0 };
    for (const sep of CANDIDATES) {
      const r = scoreSep(sample, sep);
      if (r.score > best.score) best = { sep, score: r.score };
    }
    return best.sep;
  }

  function looksLikeHeader(toks, sep) {
    let non = 0, tot = 0;
    for (const t of toks) { if (!t) continue; tot++; if (!isNum(t, sep)) non++; }
    return tot > 0 && non / tot > 0.5;
  }
  function stripComment(line) { return line.replace(/^\s*(#|!|\/\/|\*)+\s*/, ''); }

  /* ---------- table ---------- */
  function parseTable(text, opts) {
    opts = opts || {};
    const res = { ok: false, sep: null, header: false, names: [], rows: [], cols: [], nRows: 0, nCols: 0, info: '', message: '' };
    if (!text || !String(text).trim()) { res.message = 'Rien à analyser'; return res; }

    // lignes de données ; le dernier commentaire AVANT les données est gardé comme en-tête potentiel
    const data = []; let lastComment = null; let seenData = false;
    for (const l of String(text).replace(/\r/g, '').split('\n')) {
      if (!l.trim()) continue;
      if (COMMENT_RE.test(l)) { if (!seenData) lastComment = l; continue; }
      seenData = true; data.push(l);
    }
    if (!data.length) { res.message = 'Aucune ligne de données (tout est commentaire)'; return res; }

    let sep = (opts.sep && opts.sep !== 'auto') ? opts.sep : detectSeparator(data);
    if (sep === '\\t') sep = '\t';
    if (!sep) sep = 'ws';
    const rows = data.map(l => splitLine(l, sep));

    // nombre de colonnes = nombre modal de tokens
    const cnt = new Map(); for (const r of rows) cnt.set(r.length, (cnt.get(r.length) || 0) + 1);
    let nCols = 0, best = 0; for (const [k, v] of cnt) if (v > best || (v === best && k > nCols)) { nCols = k; best = v; }

    // en-tête : 1ʳᵉ ligne (auto si majoritairement non numérique, ou forcée), sinon commentaire précédent
    const hm = (opts.header === undefined || opts.header === null) ? 'auto' : opts.header;
    let names = null, start = 0, headerFrom = null;
    if (hm === true || hm === 'yes' || (hm === 'auto' && looksLikeHeader(rows[0], sep))) {
      names = rows[0]; start = 1; headerFrom = 'ligne 1';
    } else if (hm !== false && hm !== 'no' && lastComment) {
      const c = stripComment(lastComment);
      let toks = splitLine(c, sep);
      if (toks.length !== nCols) toks = splitLine(c, 'ws');
      if (toks.length === nCols) { names = toks; headerFrom = 'commentaire'; }
    }
    // ligne d'unités sous l'en-tête (ex. "GHz dB deg") fusionnée dans les noms
    if (start === 1 && rows.length > 1 && looksLikeHeader(rows[1], sep)) {
      const u = rows[1];
      names = names.map((n, i) => (u[i] ? `${n} (${u[i]})` : n));
      start = 2;
    }
    names = Array.from({ length: nCols }, (_, i) => (names && names[i]) ? String(names[i]).trim() : `Col ${i + 1}`);

    const dataRows = rows.slice(start).map(r => { const o = r.slice(0, nCols); while (o.length < nCols) o.push(''); return o; });
    const cols = names.map((_, c) => dataRows.map(r => toNum(r[c], sep)));
    if (nCols === 1) {                       // une seule colonne : on ajoute un index pour pouvoir tracer
      names.unshift('Index'); cols.unshift(dataRows.map((_, i) => i));
      dataRows.forEach((r, i) => r.unshift(String(i)));
      nCols = 2;
    }
    Object.assign(res, {
      ok: true, sep, header: !!headerFrom, names, rows: dataRows, cols, nRows: dataRows.length, nCols,
      info: `${SEP_NAMES[sep] || `« ${sep} »`} · ${nCols} colonnes · ${dataRows.length} lignes · titres : ${headerFrom || 'non'}`
    });
    return res;
  }

  /* ---------- Touchstone ---------- */
  function detectTouchstone(text) {
    const CC = root.ConverterCore;
    if (!CC || !CC.parseTouchstone || !text) return null;
    const m = String(text).match(/^[ \t]*#(.*)$/m);            // ligne d'options "# GHz S RI R 50"
    if (!m) return null;
    const toks = m[1].trim().split(/\s+/).map(t => t.toUpperCase());
    if (!toks.some(t => /^(HZ|KHZ|MHZ|GHZ|THZ)$/.test(t)) || !toks.some(t => /^(RI|MA|DB)$/.test(t))) return null;
    try { return CC.parseTouchstone(String(text)); } catch (e) { return null; }
  }

  const OUT_LABEL = { 1: 'Hz', 1e3: 'kHz', 1e6: 'MHz', 1e9: 'GHz', 1e12: 'THz' };
  function touchstoneToTable(ts) {
    const CC = root.ConverterCore;
    const N = ts.nPorts;
    const unitIn = CC.freqUnitMultiplier(ts.options && ts.options.freqUnit);
    const inLabel = OUT_LABEL[unitIn] || 'Hz';
    const names = [`Freq (${inLabel})`];
    const pairs = [];
    if (N <= 2) { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pairs.push([i, j]); } // S11 S21 S12 S22
    else { for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) pairs.push([i, j]); }
    for (const [i, j] of pairs) names.push(`S${i + 1}${j + 1} (dB)`, `S${i + 1}${j + 1} (deg)`);

    const n = ts.rows.length;
    const cols = names.map(() => new Array(n));
    let fmax = 0;
    ts.rows.forEach((r, k) => {
      cols[0][k] = r.freq; if (r.freq > fmax) fmax = r.freq;
      pairs.forEach(([i, j], q) => {
        const z = r.S[i][j]; const mag = Math.hypot(z.re, z.im);
        cols[1 + 2 * q][k] = mag > 0 ? 20 * Math.log10(mag) : -300;
        cols[2 + 2 * q][k] = Math.atan2(z.im, z.re) * 180 / Math.PI;
      });
    });
    const rows = Array.from({ length: n }, (_, k) => cols.map(c => String(+c[k].toPrecision(7))));
    const fHz = fmax * unitIn;
    const unitOut = fHz >= 1e12 ? 1e12 : fHz >= 1e9 ? 1e9 : fHz >= 1e6 ? 1e6 : fHz >= 1e3 ? 1e3 : 1;
    const s21 = names.indexOf('S21 (dB)');
    const table = {
      ok: true, sep: null, header: true, names, rows, cols, nRows: n, nCols: names.length, message: '',
      info: `Touchstone ${N} port${N > 1 ? 's' : ''} · ${ts.format} · ${inLabel} · ${n} points`
    };
    return { table, suggest: { x: 0, on: [s21 >= 0 ? s21 : 1], xTitle: `Fréquence (${OUT_LABEL[unitOut]})`, yTitle: 'Amplitude (dB)', unitIn, unitOut } };
  }

  /* ---------- self-test (node -e ou console) ---------- */
  function selfTest() {
    const assert = (c, m) => { if (!c) throw new Error('selfTest: ' + m); };
    let t = parseTable('Freq\tS21\n1\t-3\n2\t-4\n');
    assert(t.sep === '\t' && t.names[1] === 'S21' && t.cols[1][1] === -4 && t.nRows === 2, 'tab + en-tête');
    t = parseTable('1,5;2,3\n2,5;3,3\n');
    assert(t.sep === ';' && t.cols[0][0] === 1.5 && t.cols[1][1] === 3.3, 'CSV FR ; + virgule décimale');
    t = parseTable('# freq   S21_dB\n1e9   -3.0\n2e9    -3.5\n');
    assert(t.sep === 'ws' && t.names[0] === 'freq' && t.names[1] === 'S21_dB' && t.cols[0][1] === 2e9, 'espaces + en-tête #');
    t = parseTable('f S21\nGHz dB\n1 -3\n2 -4\n');
    assert(t.names[0] === 'f (GHz)' && t.names[1] === 'S21 (dB)' && t.nRows === 2, 'ligne d\'unités');
    t = parseTable('1.5, 2.5\n2.5, 3.5\n');
    assert(t.sep === ',' && t.cols[1][1] === 3.5, 'virgule + espace');
    t = parseTable('10\n20\n30\n');
    assert(t.nCols === 2 && t.names[0] === 'Index' && t.cols[1][2] === 30, 'colonne unique -> index');
    const s2p = '! test\n# GHz S RI R 50\n1 0.1 0.0 0.5 0.5 0.5 0.5 0.1 0.0\n2 0.1 0.0 0.0 0.5 0.0 0.5 0.1 0.0\n';
    const ts = detectTouchstone(s2p);
    assert(ts && ts.nPorts === 2 && ts.rows.length === 2, 's2p détection');
    const tt = touchstoneToTable(ts);
    assert(tt.table.names[3] === 'S21 (dB)' && Math.abs(tt.table.cols[3][0] - 20 * Math.log10(Math.hypot(0.5, 0.5))) < 1e-9 && Math.abs(tt.table.cols[4][0] - 45) < 1e-9, 's2p table S21');
    assert(tt.suggest.on[0] === 3 && tt.suggest.unitIn === 1e9 && tt.suggest.unitOut === 1e9, 's2p suggestion');
    const s1p = '# MHz S DB R 50\n100 -10 45\n200 -20 90\n';
    const t1 = detectTouchstone(s1p);
    assert(t1 && t1.nPorts === 1, 's1p détection');
    const t1t = touchstoneToTable(t1);
    assert(Math.abs(t1t.table.cols[1][1] + 20) < 1e-9 && Math.abs(t1t.table.cols[2][1] - 90) < 1e-9 && t1t.suggest.unitOut === 1e6 && t1t.suggest.on[0] === 1, 's1p table');
    const s4p = '# GHz S MA R 50\n1 1 0 0 0 0 0 0 0\n  0 0 1 0 0 0 0 0\n  0 0 0 0 1 0 0 0\n  0 0 0 0 0 0 1 0\n2 1 0 0 0 0 0 0 0\n  0 0 1 0 0 0 0 0\n  0 0 0 0 1 0 0 0\n  0 0 0 0 0 0 1 0\n';
    const t4 = detectTouchstone(s4p);
    assert(t4 && t4.nPorts === 4 && t4.rows.length === 2, 's4p (continuation indentée) -> 4 ports');
    assert(detectTouchstone('# freq S21(dB)\n1 2\n2 3\n') === null, 'pas de faux positif Touchstone');
    assert(parseTable('# freq S21(dB)\n1 2\n2 3\n').names[1] === 'S21(dB)', 'commentaire # comme en-tête');
    return true;
  }

  root.plotterParse = { parseTable, detectTouchstone, touchstoneToTable, detectSeparator, splitLine, selfTest };
})();
