/* converter_core.js — parseur Touchstone multi-port (ordre Keysight / colonne par défaut)
   API (window.ConverterCore ; aussi globalThis pour un test sous node) :
     parseTouchstone(text, {nPorts?, ordering?:'col'|'row'|'auto', format?:'RI'|'MA'|'DB', returnBoth?})
       -> { options, nPorts, format, ordering, rows:[{freqToken, freq, S[N][N]{re,im}}], headerComments, diagnostic }
       nPorts absent : inféré (1..9) = premier N pour lequel chaque record a exactement 2N² valeurs
       et les fréquences sont croissantes.
     convertTouchstoneToS2P(text, nPorts, portA, portB, opts)
       -> { s2pText, previewText, dataPoints, chosenOrdering, diagnostic }   (comportement historique)
     freqUnitMultiplier(unit) -> 1 | 1e3 | 1e6 | 1e9 | 1e12
     parseOptionsLine(line)   -> { freqUnit, dataType, format, R }
   Utilisé par html/sNp_converter.html et html/plotter.html.
   Lignes de continuation = lignes indentées (convention Keysight) ; les lignes '!' sont hissées en en-tête.
*/

(function(){
  'use strict';

  // --- Math / util ---
  function polarToRect(mag, deg) {
    const rad = deg * Math.PI / 180.0;
    return { re: mag * Math.cos(rad), im: mag * Math.sin(rad) };
  }
  function dbToMag(db) { return Math.pow(10, db / 20.0); }
  function fmt(x) { if (!isFinite(x)) return '0.0'; return Number.parseFloat(x).toFixed(6); }

  const reNum = /^[+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?$/;

  // --- parse header options line (# ...) ---
  function parseOptionsLine(line) {
    const tokens = line.replace(/\s+/g,' ').trim().substring(1).trim().split(' ');
    const opt = { freqUnit: 'Hz', dataType: 'S', format: 'RI', R: '50' };
    if (tokens.length >= 1 && tokens[0]) opt.freqUnit = tokens[0].toUpperCase();
    for (let i=1;i<tokens.length;i++){
      const t = tokens[i].toUpperCase();
      if (['S','Y','Z','G','H'].includes(t)) opt.dataType = t;
      if (['DB','MA','RI'].includes(t)) opt.format = t;
      if (t === 'R' && tokens[i+1]) { opt.R = tokens[i+1]; i++; }
    }
    return opt;
  }

  // --- extract numeric tokens from a line (ignore comments after '!') ---
  function numericTokensFromLine(line) {
    const s = line.split('!')[0].trim();
    if (!s) return [];
    const toks = s.split(/\s+/).filter(t => t.length);
    return toks.filter(t => reNum.test(t));
  }

  // --- convert a pair (a,b) according to format -> complex {re,im} ---
  function pairToComplex(aStr, bStr, format) {
    const a = Number(aStr), b = Number(bStr);
    if (format === 'RI') return { re: a, im: b };
    if (format === 'MA') return polarToRect(a, b);
    if (format === 'DB') return polarToRect(dbToMag(a), b);
    return { re: a, im: b };
  }

  // --- Build NxN matrix from tokens according to ordering ---
  // ordering === 'col' -> column-major (Keysight standard) ; 'row' -> row-major
  function buildMatrixFromTokens(tokensAfterFreq, N, format, ordering='col') {
    const expected = 2 * N * N;
    if (tokensAfterFreq.length < expected) {
      throw new Error(`Donnée incomplète (attendu ${expected} nombres, trouvé ${tokensAfterFreq.length})`);
    }
    const S = Array.from({length:N}, () => Array.from({length:N}, () => ({re:0,im:0})));
    let p = 0;
    if (ordering === 'col') {
      for (let col = 0; col < N; col++) {
        for (let row = 0; row < N; row++) {
          const a = tokensAfterFreq[p++], b = tokensAfterFreq[p++];
          S[row][col] = pairToComplex(a, b, format);
        }
      }
    } else {
      for (let row = 0; row < N; row++) {
        for (let col = 0; col < N; col++) {
          const a = tokensAfterFreq[p++], b = tokensAfterFreq[p++];
          S[row][col] = pairToComplex(a, b, format);
        }
      }
    }
    return S;
  }

  // --- small metric to test reciprocity: sum |Sij - Sji| for i<j ---
  function complexAbsDiff(a, b) {
    const dr = (a.re||0) - (b.re||0);
    const di = (a.im||0) - (b.im||0);
    return Math.sqrt(dr*dr + di*di);
  }
  function asymmetryMetric(S) {
    const N = S.length;
    let sum = 0;
    for (let i=0;i<N;i++){
      for (let j=i+1;j<N;j++){
        sum += complexAbsDiff(S[i][j], S[j][i]);
      }
    }
    return sum;
  }

  // --- Build output S2P text in RI (we keep output RI for safety) ---
  function buildS2PText(headerComments, originalOptions, rows, portA, portB) {
    const freqUnit = originalOptions ? originalOptions.freqUnit : 'Hz';
    const optionsLine = `# ${freqUnit} S RI R ${originalOptions && originalOptions.R ? originalOptions.R : '50'}`;
    const lines = [];
    if (headerComments && headerComments.length) {
      for (const c of headerComments) lines.push(c);
    } else {
      lines.push('! Converted by converter_core (Keysight ordering default)');
    }
    lines.push(optionsLine);
    lines.push('! Columns: freq Re(S11) Im(S11) Re(S21) Im(S21) Re(S12) Im(S12) Re(S22) Im(S22)');
    for (const r of rows) {
      const freqToken = r.freqToken;
      const S = r.S;
      const a = portA - 1;
      const b = portB - 1;
      const s11 = S[a][a];
      const s21 = S[b][a];
      const s12 = S[a][b];
      const s22 = S[b][b];
      const line = [
        freqToken,
        fmt(s11.re), fmt(s11.im),
        fmt(s21.re), fmt(s21.im),
        fmt(s12.re), fmt(s12.im),
        fmt(s22.re), fmt(s22.im)
      ].join(' ');
      lines.push(line);
    }
    return lines.join('\n');
  }

  // --- Scan : assemble les records (freq + tokens) ; une ligne indentée est une continuation
  //     tant que expectedPerRow n'est pas atteint. Lignes '!' hissées en commentaires d'en-tête.
  function scanRecords(rawLines, expectedPerRow) {
    const headerComments = [];
    let options = null;
    const records = []; // {freqToken, tokensAfterFreq, rawStart, rawEnd}
    let i = 0;
    while (i < rawLines.length) {
      const rawLine = rawLines[i];
      if (!rawLine || rawLine.trim() === '') { i++; continue; }
      const t = rawLine.trim();
      if (t.startsWith('!')) { headerComments.push(t); i++; continue; }
      if (t.startsWith('#')) { options = parseOptionsLine(t); i++; continue; }
      const nums = numericTokensFromLine(rawLine);
      if (nums.length === 0) { i++; continue; }
      const freqToken = nums[0];
      let rest = nums.slice(1);
      let j = i;
      while (rest.length < expectedPerRow && (j+1) < rawLines.length) {
        const nextRaw = rawLines[j+1];
        if (!nextRaw) break;
        const nt = nextRaw.trim();
        if (nt.startsWith('!') || nt.startsWith('#')) break;
        if (/^\s/.test(nextRaw)) {
          const more = numericTokensFromLine(nextRaw);
          if (more.length) rest = rest.concat(more);
          j++;
          continue;
        }
        break;
      }
      records.push({ freqToken, tokensAfterFreq: rest, rawStart: i, rawEnd: j });
      i = j + 1;
    }
    return { headerComments, options, records };
  }

  // --- Inférence du nombre de ports : premier N (1..9) tel que chaque record ait exactement 2N²
  //     valeurs et que les fréquences soient croissantes (un mauvais N produit des records
  //     incomplets, surnuméraires ou des "fréquences" qui sont en fait des valeurs S).
  function inferPorts(rawLines) {
    for (let n = 1; n <= 9; n++) {
      const exp = 2 * n * n;
      const s = scanRecords(rawLines, exp);
      if (!s.records.length) continue;
      let ok = s.records.every(r => r.tokensAfterFreq.length === exp);
      for (let k = 1; ok && k < s.records.length; k++) {
        if (!(Number(s.records[k].freqToken) >= Number(s.records[k-1].freqToken))) ok = false;
      }
      if (ok) return { nPorts: n, scan: s };
    }
    return null;
  }

  // --- Parse complet : texte -> matrices S par fréquence ---
  function parseTouchstone(text, opts) {
    opts = opts || {};
    if (!text || typeof text !== 'string') throw new Error('Aucune donnée fournie.');
    const rawLines = text.split(/\r?\n/);
    const orderingPref = opts.ordering || 'col'; // default to Keysight 'col'
    const overrideFormat = opts.format ? String(opts.format).toUpperCase() : null;

    let N, scan;
    if (Number.isFinite(opts.nPorts) && opts.nPorts > 0) {
      N = opts.nPorts;
      scan = scanRecords(rawLines, 2 * N * N);
    } else {
      const inf = inferPorts(rawLines);
      if (!inf) throw new Error('Nombre de ports indéterminable (fichier Touchstone incomplet ou non standard).');
      N = inf.nPorts; scan = inf.scan;
    }
    const { headerComments, options, records } = scan;
    const expectedPerRow = 2 * N * N;
    if (records.length === 0) throw new Error('Aucun point de données détecté.');

    // determine input format (prefer header unless override)
    let inputFormat = (options && options.format) ? options.format.toUpperCase() : 'RI';
    if (overrideFormat) inputFormat = overrideFormat;

    // If orderingPref == 'auto', attempt detection using asymmetry metric
    let chosenOrdering = orderingPref;
    if (orderingPref === 'auto') {
      const good = records.filter(r => r.tokensAfterFreq.length >= expectedPerRow);
      if (good.length === 0) throw new Error('Aucune ligne complète pour détection de l\'ordre.');
      const sample = good.slice(0, Math.min(6, good.length));
      let sumCol = 0, sumRow = 0;
      for (const rec of sample) {
        try {
          const Sc = buildMatrixFromTokens(rec.tokensAfterFreq, N, inputFormat, 'col');
          const Sr = buildMatrixFromTokens(rec.tokensAfterFreq, N, inputFormat, 'row');
          sumCol += asymmetryMetric(Sc);
          sumRow += asymmetryMetric(Sr);
        } catch (e) {
          // ignore malformed rec
        }
      }
      chosenOrdering = (sumCol <= sumRow) ? 'col' : 'row';
    }

    // Validate records completeness under chosen ordering
    for (const rec of records) {
      if (rec.tokensAfterFreq.length < expectedPerRow) {
        throw new Error(`Ligne fréquence ${rec.freqToken} incomplète: attendu ${expectedPerRow} valeurs d'éléments S, trouvé ${rec.tokensAfterFreq.length}.`);
      }
    }

    const rows = records.map(rec => ({
      freqToken: rec.freqToken,
      freq: Number(rec.freqToken),
      S: buildMatrixFromTokens(rec.tokensAfterFreq, N, inputFormat, chosenOrdering)
    }));

    // If returnBoth requested, build both column and row for first record (diagnostic)
    let diagnostic = null;
    if (opts.returnBoth) {
      try {
        const rec0 = records.find(r => r.tokensAfterFreq.length >= expectedPerRow);
        if (rec0) {
          diagnostic = {
            col: buildMatrixFromTokens(rec0.tokensAfterFreq, N, inputFormat, 'col'),
            row: buildMatrixFromTokens(rec0.tokensAfterFreq, N, inputFormat, 'row')
          };
        }
      } catch(e) { /* ignore */ }
    }

    return { options, nPorts: N, format: inputFormat, ordering: chosenOrdering, rows, headerComments, diagnostic };
  }

  // --- Main conversion function (API historique du sNp Converter) ---
  function convertTouchstoneToS2P(text, nPorts, portA, portB, opts) {
    opts = opts || {};
    const p = parseTouchstone(text, {
      nPorts: Number.isFinite(nPorts) ? nPorts : 2,
      ordering: opts.ordering,
      format: opts.format,
      returnBoth: !!opts.returnBoth
    });
    const s2pText = buildS2PText(p.headerComments, p.options, p.rows, portA, portB);
    return {
      s2pText,
      previewText: `Ordering chosen: ${p.ordering} (requested: ${opts.ordering || 'col'}) — format: ${p.format} — points: ${p.rows.length}`,
      dataPoints: p.rows.length,
      chosenOrdering: p.ordering,
      diagnostic: p.diagnostic
    };
  }

  const UNIT_MULT = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9, THZ: 1e12 };
  function freqUnitMultiplier(unit) { return UNIT_MULT[String(unit || 'HZ').toUpperCase()] || 1; }

  // expose (window dans le navigateur, globalThis sous node pour le self-test du plotter)
  const root = (typeof window !== 'undefined') ? window : globalThis;
  root.ConverterCore = {
    convertTouchstoneToS2P,
    parseTouchstone,
    freqUnitMultiplier,
    parseOptionsLine
  };
})();
