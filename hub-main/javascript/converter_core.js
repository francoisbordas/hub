/* converter_core.js — parser Touchstone multi-port (Keysight order by default)
   - Default ordering = 'col' (Keysight / column-major)
   - Supports arbitrary N (expects 2*N*N numeric tokens per record after freq)
   - Handles continuation lines (indented)
   - Exposed API:
       window.ConverterCore.convertTouchstoneToS2P(text, nPorts, portA, portB, opts)
     opts: {
       ordering: 'col'|'row'|'auto'   // default 'col'
       format: 'RI'|'MA'|'DB'         // optional override of detected format
       returnBoth?: boolean           // if true returns matrices for both orders for diagnostics
     }
*/

(function(){
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
  // ordering === 'col' -> column-major (Keysight standard)
  // ordering === 'row' -> row-major (non standard)
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

  // --- Main conversion function ---
  function convertTouchstoneToS2P(text, nPorts, portA, portB, opts) {
    opts = opts || {};
    const orderingPref = opts.ordering || 'col'; // default to Keysight 'col'
    const overrideFormat = opts.format ? opts.format.toUpperCase() : null;
    const returnBoth = !!opts.returnBoth;

    if (!text || typeof text !== 'string') throw new Error('Aucune donnée fournie.');
    const rawLines = text.split(/\r?\n/);
    const headerComments = [];
    let options = null;
    const records = []; // {freqToken, tokensAfterFreq, rawStart, rawEnd}

    // scan file and form records by concatenating continuation lines (indentation)
    let i = 0;
    const N = Number.isFinite(nPorts) ? nPorts : 2;
    const expectedPerRow = 2 * N * N;

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
        } else {
          break;
        }
      }
      records.push({ freqToken, tokensAfterFreq: rest, rawStart: i, rawEnd: j });
      i = j + 1;
    }

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

    // build rows using chosenOrdering
    const rows = records.map(rec => {
      const S = buildMatrixFromTokens(rec.tokensAfterFreq, N, inputFormat, chosenOrdering);
      return { freqToken: rec.freqToken, S };
    });

    // If returnBoth requested, build both column and row for first record (diagnostic)
    let both = null;
    if (returnBoth) {
      try {
        const rec0 = records.find(r => r.tokensAfterFreq.length >= expectedPerRow);
        if (rec0) {
          both = {
            col: buildMatrixFromTokens(rec0.tokensAfterFreq, N, inputFormat, 'col'),
            row: buildMatrixFromTokens(rec0.tokensAfterFreq, N, inputFormat, 'row')
          };
        }
      } catch(e) { /* ignore */ }
    }

    const s2pText = buildS2PText(headerComments, options, rows, portA, portB);
    return {
      s2pText,
      previewText: `Ordering chosen: ${chosenOrdering} (requested: ${orderingPref}) — format: ${inputFormat} — points: ${rows.length}`,
      dataPoints: rows.length,
      chosenOrdering,
      diagnostic: both
    };
  }

  // expose
  window.ConverterCore = {
    convertTouchstoneToS2P
  };
})();
