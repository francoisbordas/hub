// javascript/s2p_converter.js
// Convertisseur S2P -> "freq(Hz) Sxx(dB)"
// Version refaite : robuste, préserve la précision d'origine, détection d'en-tête, protections DOM.

(function () {
  'use strict';

  /* ---------------- DOM (defensive) ---------------- */
  const ta = document.getElementById('s2pInput');
  const unitSel = document.getElementById('unitSelect');
  const paramSel = document.getElementById('paramSelect');
  const outFreqLabel = document.getElementById('outputFreqLabel');
  const outHeader = document.getElementById('outputHeader');
  const btnConvert = document.getElementById('btnConvert');
  const btnCopy = document.getElementById('btnCopy');
  const btnDownload = document.getElementById('btnDownload');
  const out = document.getElementById('outputArea');
  const status = document.getElementById('status');

  function safeId(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`Element with id "${id}" not found in DOM.`);
    return el;
  }

  // if critical elements missing, stop but log
  if (!ta || !paramSel || !out) {
    console.error('s2p_converter: éléments DOM manquants (s2pInput, paramSelect, outputArea sont requis).');
    // avoid throwing — but do nothing
    return;
  }

  /* ---------------- Helpers ---------------- */
  const setStatus = (s, timeout = 2500) => {
    if (!status) return;
    status.textContent = s || '';
    if (timeout && s) {
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(()=> status.textContent = '', timeout);
    }
  };

  function toHz(freq, unit) {
    if (!isFinite(Number(freq))) return NaN;
    const f = Number(freq);
    switch ((unit || 'MHz').toString().toLowerCase()) {
      case 'ghz': return f * 1e9;
      case 'mhz': return f * 1e6;
      case 'hz':  return f;
      default: return f * 1e6;
    }
  }

  function parseLines(txt) {
    return txt.replace(/\r/g,'').split('\n');
  }

  function isCommentLine(line) {
    if (!line) return false;
    const t = line.trim();
    return t.startsWith('!') || t.startsWith('//') || t.startsWith(';') || t.startsWith('*');
  }

  function findHeaderUnit(lines) {
    for (const raw of lines) {
      if (!raw) continue;
      const l = raw.trim();
      if (!l) continue;
      if (l.startsWith('#')) {
        const s = l.toUpperCase();
        if (s.includes('GHZ')) return 'GHz';
        if (s.includes('MHZ')) return 'MHz';
        if (s.includes('HZ'))  return 'Hz';
      }
    }
    return null;
  }

  function findFirstDataLineIndex(lines) {
    for (let i = 0; i < lines.length; i++) {
      const l = (lines[i] || '').trim();
      if (!l) continue;
      if (isCommentLine(l)) continue;
      if (/^[\d\-\.+]/.test(l)) {
        const toks = l.split(/\s+/);
        const numericCount = toks.reduce((c,t)=> c + (isNumericString(t)?1:0), 0);
        if (numericCount >= 2) return i;
      }
    }
    return -1;
  }

  function buildMappingFromTokens(tokens) {
    // tokens is array of strings from a header line containing S11 S21 etc
    const map = {};
    map.freq = 0; // assume freq first
    // find tokens that contain S11/S21/S12/S22 (case-insensitive)
    const up = tokens.map(t => t.toUpperCase());
    for (let i=0;i<up.length;i++){
      const t = up[i].replace(/[^A-Z0-9]/g,''); // clean punctuation
      if (t.includes('S11') && map.S11===undefined) map.S11 = i;
      if (t.includes('S21') && map.S21===undefined) map.S21 = i;
      if (t.includes('S12') && map.S12===undefined) map.S12 = i;
      if (t.includes('S22') && map.S22===undefined) map.S22 = i;
      // also look for patterns like 'S11DB' or 'S21(DB)'
      if (t.includes('DB') && (t.includes('S11') || t.includes('S21') || t.includes('S12') || t.includes('S22'))) {
        // already handled
      }
    }
    return map;
  }

  function buildMapping(tokensLength) {
    // conservative default mappings for standard S2P numeric lines
    const map = {};
    if (tokensLength >= 9) {
      map.freq = 0; map.S11 = 1; map.S21 = 3; map.S12 = 5; map.S22 = 7;
    } else if (tokensLength === 8) {
      map.freq = 0; map.S11 = 1; map.S21 = 2; map.S12 = 3; map.S22 = 4;
    } else if (tokensLength === 5) {
      map.freq = 0; map.S11 = 1; map.S21 = 2; map.S12 = 3; map.S22 = 4;
    } else if (tokensLength === 3) {
      map.freq = 0; map.S21 = 1; map.S11 = 1; map.S12 = 1; map.S22 = 1;
    } else {
      map.freq = 0; map.S11 = 1; map.S21 = 1; map.S12 = 1; map.S22 = 1;
    }
    return map;
  }

  function normalizeTokenString(tok) {
    if (tok === undefined || tok === null) return '';
    return String(tok).trim().replace(',', '.');
  }

  function isNumericString(tok) {
    if (tok === undefined || tok === null) return false;
    tok = String(tok).trim().replace(',', '.');
    // allow scientific notation, leading +/-
    return /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(tok);
  }

  /* ---------------- core : buildOutputText ---------------- */
  function buildOutputText(lines, chosenParam, unitChoice, freqLabel, headerLabel) {
    const firstDataIdx = findFirstDataLineIndex(lines);
    if (firstDataIdx < 0) throw new Error('Aucune ligne de données détectée.');

    // attempt to find a textual header line (not # but labels like "Frequency S11 dB S11 DEG ...")
    let colHeaderTokens = null;
    for (let i = 0; i < firstDataIdx; i++) {
      const l = lines[i] ? lines[i].trim() : '';
      if (!l) continue;
      if (isCommentLine(l)) {
        // line starting with ! might still include "Frequency ..." in some files -> check content after !
        const content = l.replace(/^!+/, '').trim();
        if (content.toLowerCase().includes('frequency') && /s11|s21|s12|s22/i.test(content)) {
          colHeaderTokens = content.split(/\s+/);
          break;
        }
        continue;
      }
      // also check non-comment label lines (rare)
      if (/frequency/i.test(l) && /s11|s21|s12|s22/i.test(l)) {
        colHeaderTokens = l.split(/\s+/);
        break;
      }
    }

    // sample data tokens length
    const sampleTokens = lines[firstDataIdx].trim().split(/\s+/).map(t=> t.replace(',', '.'));
    const tokensLen = sampleTokens.length;

    // mapping: prefer header-based mapping if available
    let mapping = null;
    if (colHeaderTokens) {
      mapping = buildMappingFromTokens(colHeaderTokens);
      // if mapping only contains freq but no S21 etc, fallback below
      if (!mapping.S11 && !mapping.S21 && !mapping.S12 && !mapping.S22) mapping = null;
    }
    if (!mapping) mapping = buildMapping(tokensLen);

    // If chosenParam not in mapping (or index out of range), try to find param index by scanning sampleTokens labels (rare)
    if (!(chosenParam in mapping) || mapping[chosenParam] === undefined) {
      // attempt to guess: find token positions that look like S21 dB (i.e., token is numeric but next token is numeric = phase)
      // fallback to mapping above
      mapping = mapping || buildMapping(tokensLen);
    }

    const colIndex = mapping[chosenParam];
    if (colIndex === undefined) throw new Error(`Impossible de déterminer la colonne pour ${chosenParam}.`);

    const outLines = [];
    outLines.push(`${freqLabel} ${headerLabel}`);

    for (let i = firstDataIdx; i < lines.length; i++) {
      const raw = (lines[i] || '').trim();
      if (!raw) continue;
      if (isCommentLine(raw)) continue;

      const toksRaw = raw.split(/\s+/);
      if (toksRaw.length <= colIndex) {
        // skip
        continue;
      }

      const freqRawStr = normalizeTokenString(toksRaw[0]);
      const valRawStr = normalizeTokenString(toksRaw[colIndex]);

      if (!isNumericString(freqRawStr) || !isNumericString(valRawStr)) {
        // skip non-numeric
        continue;
      }

      const freqNum = Number(freqRawStr);
      const hz = toHz(freqNum, unitChoice);
      if (!isFinite(hz)) continue;

      // Frequency formatting:
      let freqOut;
      if (Math.abs(hz - Math.round(hz)) < 1e-9) {
        // integer Hz
        freqOut = String(Math.round(hz));
      } else {
        // preserve decimals as JS shows them (avoid forcing an arbitrary rounding)
        // if hz is in reasonable range, use toString(); else use toPrecision(12) to avoid E notation
        const absHz = Math.abs(hz);
        if (absHz > 1e-6 && absHz < 1e21) {
          freqOut = hz.toString();
        } else {
          freqOut = Number(hz).toPrecision(12).replace(/\.?0+$/,'');
        }
      }

      // Value formatting: preserve the original token string (comma already replaced by dot)
      // Remove leading plus signs to keep it clean
      const valOut = valRawStr.replace(/^\+/, '');

      outLines.push(`${freqOut} ${valOut}`);
    }

    if (outLines.length === 1) throw new Error('Aucune donnée valide extraite après parsing.');

    return outLines.join('\n');
  }

  /* ---------------- UI actions ---------------- */

  // Convert
  if (btnConvert) {
    btnConvert.addEventListener('click', () => {
      setStatus('');
      const txt = (ta.value || '').trim();
      if (!txt) { setStatus("Colle le contenu du fichier .s2p d'abord"); out.textContent = '— résultat ici —'; return; }

      const lines = parseLines(txt);
      const headerUnitDetected = findHeaderUnit(lines);
      const chosenUnit = (unitSel && unitSel.value) ? unitSel.value : 'MHz';
      if (headerUnitDetected && headerUnitDetected.toLowerCase() !== chosenUnit.toLowerCase()) {
        setStatus(`Entête indique "${headerUnitDetected}" — j'utilise "${chosenUnit}" (manuel).`, 5000);
      }
      const chosenParam = (paramSel && paramSel.value) ? paramSel.value : 'S21';
      const freqLabel = (outFreqLabel && outFreqLabel.value) ? outFreqLabel.value : 'freq(Hz)';
      const headerLabel = (outHeader && outHeader.value) ? outHeader.value : `${chosenParam}(dB)`;

      try {
        const result = buildOutputText(lines, chosenParam, chosenUnit, freqLabel, headerLabel);
        out.textContent = result;
        setStatus('Conversion terminée');
      } catch (e) {
        console.error(e);
        out.textContent = '— résultat ici —';
        setStatus('Erreur: ' + (e && e.message ? e.message : String(e)), 6000);
      }
    });
  }

  // Copy
  if (btnCopy) {
    btnCopy.addEventListener('click', async () => {
      const text = out.textContent || '';
      if (!text || text.trim() === '' || text.includes('— résultat ici —')) { setStatus('Rien à copier'); return; }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          setStatus('Copié dans le presse-papier');
        } else {
          const taFake = document.createElement('textarea');
          taFake.value = text;
          document.body.appendChild(taFake);
          taFake.select();
          document.execCommand('copy');
          taFake.remove();
          setStatus('Copié (fallback)');
        }
      } catch (err) {
        console.error(err);
        setStatus('Échec du copier', 3000);
      }
    });
  }

  // Download
  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      const text = out.textContent || '';
      if (!text || text.trim() === '' || text.includes('— résultat ici —')) { setStatus('Rien à télécharger'); return; }
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fn = `${(paramSel && paramSel.value ? paramSel.value : 'S21')}_export.txt`;
      a.download = fn;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Téléchargé ${fn}`);
    });
  }

  // Ctrl+Enter shortcut
  ta.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key === 'Enter') {
      ev.preventDefault();
      if (btnConvert) btnConvert.click();
    }
  });

  // initial placeholder hint
  (function initHint(){
    if (!ta.value.trim()) {
      ta.placeholder = `# MHz S DB R 50
!Frequency S11 dB S11 DEG S21 dB S21 DEG S12 dB S12 DEG S22 dB S22 DEG
10 -0.08 178.842 -97.777 -63.708 -79.667 -24.617 -0.099 178.634
...`;
    }
  })();

})();
