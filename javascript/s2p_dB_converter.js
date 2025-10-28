/* s2p_to_db.js
   Convertit un .s2p en format RI/MA/DB (entrée) -> sortie en S DB (dB + deg)
   - Gère lignes 'continuation' indentées (comme dans les fichiers Keysight)
   - Détecte automatiquement le format si entête '# ...'
   - UI: drag&drop, copie, téléchargement
*/

document.addEventListener('DOMContentLoaded', () => {
  const inputArea = document.getElementById('inputArea');
  const btnConvert = document.getElementById('btnConvert');
  const btnClear = document.getElementById('btnClear');
  const btnCopy = document.getElementById('btnCopy');
  const btnDownload = document.getElementById('btnDownload');
  const previewBox = document.getElementById('previewBox');
  const outputBox = document.getElementById('outputBox');
  const status = document.getElementById('status');
  const inputFormatHint = document.getElementById('inputFormatHint');

  /* Utilitaires math */
  function magFromReIm(re, im) { return Math.sqrt(re*re + im*im); }
  function angleDegFromReIm(re, im) { return Math.atan2(im, re) * 180.0 / Math.PI; }
  function dbFromMag(m) { if (m <= 0) return -300.0; return 20.0 * Math.log10(m); }
  function toFixedSafe(x, n=6) { if (!isFinite(x)) return (x < 0 ? '-inf' : '0.0'); return Number.parseFloat(x).toFixed(n); }

  /* Regex pour nombres (inclue exponentielle) */
  const reNum = /^[+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?$/;

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

  function numericTokensFromLine(line) {
    const s = line.split('!')[0].trim();
    if (!s) return [];
    const tokens = s.split(/\s+/).filter(t => t.length);
    return tokens.filter(t => reNum.test(t));
  }

  function pairToReIm(aStr, bStr, format) {
    const a = Number(aStr);
    const b = Number(bStr);
    if (format === 'RI') return { re: a, im: b };
    if (format === 'MA') {
      const mag = Number(a);
      const angDeg = Number(b);
      const rad = angDeg * Math.PI / 180.0;
      return { re: mag * Math.cos(rad), im: mag * Math.sin(rad) };
    }
    if (format === 'DB') {
      const db = Number(a);
      const mag = Math.pow(10, db / 20.0);
      const angDeg = Number(b);
      const rad = angDeg * Math.PI / 180.0;
      return { re: mag * Math.cos(rad), im: mag * Math.sin(rad) };
    }
    // fallback
    return { re: a, im: b };
  }

  /* Joindre lignes de continuation indentées et extraire enregistrements */
  function parseDataRows(lines, expectedPairsCount, inputFormat) {
    const rows = [];
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      if (!raw || raw.trim() === '') { i++; continue; }
      const t = raw.trim();
      if (t.startsWith('!') || t.startsWith('#')) { i++; continue; }

      const nums = numericTokensFromLine(raw);
      if (nums.length === 0) { i++; continue; }
      const freqToken = nums[0];
      let rest = nums.slice(1);

      // collect continuation lines that are indented (start with whitespace)
      let j = i;
      while (rest.length < expectedPairsCount * 2 && (j + 1) < lines.length) {
        const nextLine = lines[j + 1];
        if (!nextLine) break;
        const nextTrim = nextLine.trim();
        if (nextTrim.startsWith('!') || nextTrim.startsWith('#')) break;
        // heuristique: continuation if next line starts with whitespace
        if (/^\s/.test(nextLine)) {
          const more = numericTokensFromLine(nextLine);
          if (more.length) rest = rest.concat(more);
          j++;
          continue;
        } else {
          break;
        }
      }

      if (rest.length < expectedPairsCount * 2) {
        throw new Error(`Ligne fréquence ${freqToken} incomplète: attendu ${expectedPairsCount*2} nombres, trouvé ${rest.length}.`);
      }

      // for S2P expectedPairsCount == 4 (S11,S21,S12,S22) each pair = 2 numbers
      // build order as Touchstone: column-major (S11, S21, S12, S22) if N=2
      rows.push({ freqToken, tokensAfterFreq: rest.slice(0, expectedPairsCount * 2) });
      i = j + 1;
    }
    return rows;
  }

  /* Construction du texte de sortie en DB (mag[dB], angle[deg]) */
  function buildS2P_DB_text(headerComments, rows, inputFormat, R='50', freqUnit='Hz') {
    // header
    const outLines = [];
    if (headerComments && headerComments.length) {
      headerComments.forEach(c => outLines.push(c));
    } else {
      outLines.push('! Converted by s2p RI->DB converter');
    }
    outLines.push(`# ${freqUnit} S DB R ${R}`);
    outLines.push('! Columns: freq S11(dB) S11deg S21(dB) S21deg S12(dB) S12deg S22(dB) S22deg');

    for (const row of rows) {
      const f = row.freqToken;
      const t = row.tokensAfterFreq;
      // ordering: t[0]=Re(S11), t[1]=Im(S11), t[2]=Re(S21), t[3]=Im(S21), t[4]=Re(S12), t[5]=Im(S12), t[6]=Re(S22), t[7]=Im(S22)
      const s11 = pairToReIm(t[0], t[1], inputFormat);
      const s21 = pairToReIm(t[2], t[3], inputFormat);
      const s12 = pairToReIm(t[4], t[5], inputFormat);
      const s22 = pairToReIm(t[6], t[7], inputFormat);

      const m11 = magFromReIm(s11.re, s11.im); const a11 = angleDegFromReIm(s11.re, s11.im);
      const m21 = magFromReIm(s21.re, s21.im); const a21 = angleDegFromReIm(s21.re, s21.im);
      const m12 = magFromReIm(s12.re, s12.im); const a12 = angleDegFromReIm(s12.re, s12.im);
      const m22 = magFromReIm(s22.re, s22.im); const a22 = angleDegFromReIm(s22.re, s22.im);

      const d11 = dbFromMag(m11); const d21 = dbFromMag(m21); const d12 = dbFromMag(m12); const d22 = dbFromMag(m22);

      const line = [
        f,
        toFixedSafe(d11), toFixedSafe(a11),
        toFixedSafe(d21), toFixedSafe(a21),
        toFixedSafe(d12), toFixedSafe(a12),
        toFixedSafe(d22), toFixedSafe(a22)
      ].join(' ');
      outLines.push(line);
    }
    return outLines.join('\n');
  }

  /* Main conversion function */
  function convertTextToS2P_DB(text, hintFormat) {
    if (!text || text.trim() === '') throw new Error('Aucune donnée fournie.');
    const rawLines = text.split(/\r?\n/);
    const headerComments = [];
    let options = null;
    // find header (# ...) and collect comments
    for (const l of rawLines) {
      const t = l.trim();
      if (t === '') continue;
      if (t.startsWith('!')) { headerComments.push(t); continue; }
      if (t.startsWith('#')) { options = parseOptionsLine(t); break; }
      // if non-comment non-#, break: maybe no header
      if (!t.startsWith('#')) break;
    }

    // decide input format
    let inputFormat = 'RI';
    if (options && options.format) inputFormat = options.format.toUpperCase();
    if (hintFormat && hintFormat !== 'auto') inputFormat = hintFormat;

    // For s2p expected pairs = 4 (S11,S21,S12,S22)
    const expectedPairs = 4;

    // parse data rows (starting after header line index)
    // find index of header line position to start parsing data from there
    let startIdx = 0;
    for (let i=0;i<rawLines.length;i++){
      const t = rawLines[i].trim();
      if (t.startsWith('#')) { startIdx = i + 1; break; }
      if (t.startsWith('!')) { startIdx = i + 1; continue; }
    }
    const dataLines = rawLines.slice(startIdx);

    const rows = parseDataRows(dataLines, expectedPairs, inputFormat);

    // if input format is not RI/MA/DB recognized, try to warn/fallback
    if (!['RI','MA','DB'].includes(inputFormat)) {
      // fallback to RI
      inputFormat = 'RI';
    }

    // build output text
    const outText = buildS2P_DB_text(headerComments, rows, inputFormat, (options && options.R) ? options.R : '50', (options && options.freqUnit) ? options.freqUnit : 'Hz');
    return { outText, rowsCount: rows.length, detectedFormat: inputFormat, headerOptions: options };
  }

  /* UI wiring */
  // drag & drop
  ['dragenter','dragover'].forEach(ev => {
    inputArea.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); inputArea.classList.add('dragover'); });
  });
  ['dragleave','drop'].forEach(ev => {
    inputArea.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); inputArea.classList.remove('dragover'); });
  });
  inputArea.addEventListener('drop', async (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length) {
      const f = files[0];
      const txt = await f.text();
      inputArea.value = txt;
      status.textContent = `Fichier collé : ${f.name}`;
    }
  });

  // Convert button
  btnConvert.addEventListener('click', () => {
    const raw = inputArea.value;
    if (!raw || raw.trim() === '') {
      status.textContent = 'Erreur : aucune donnée en entrée.';
      return;
    }
    status.textContent = 'Conversion en cours...';
    try {
      const hint = inputFormatHint.value;
      const res = convertTextToS2P_DB(raw, hint);
      // preview
      const previewLines = [
        `Format détecté: ${res.detectedFormat}`,
        `Points: ${res.rowsCount}`,
        '--- aperçu (premières lignes) ---'
      ];
      const outFirstLines = res.outText.split(/\r?\n/).slice(0, 12);
      previewLines.push(...outFirstLines);
      previewBox.innerHTML = `<pre>${previewLines.join('\n')}</pre>`;
      outputBox.innerHTML = `<pre id="outputPre">${res.outText}</pre>`;
      status.textContent = `Conversion OK — ${res.rowsCount} points`;
    } catch (err) {
      console.error(err);
      status.textContent = `Erreur : ${err.message || err}`;
      previewBox.innerHTML = `<div class="empty small-muted">Erreur lors de l'analyse</div>`;
      outputBox.innerHTML = `<div class="empty small-muted">Aucun fichier converti</div>`;
    }
  });

  // Clear
  btnClear.addEventListener('click', () => {
    inputArea.value = '';
    previewBox.innerHTML = '<div class="empty small-muted">Aucun fichier analysé</div>';
    outputBox.innerHTML = '<div class="empty small-muted">Aucun fichier converti</div>';
    status.textContent = '— prêt —';
  });

  // Copy
  btnCopy.addEventListener('click', async () => {
    const pre = document.getElementById('outputPre');
    if (!pre) { status.textContent = 'Rien à copier.'; return; }
    const text = pre.textContent;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copié dans le presse-papier ✔';
    } catch (e) {
      console.warn('clipboard failed', e);
      // fallback
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); status.textContent = 'Copié (fallback)'; } catch (ex) { status.textContent = 'Échec du copier — utilise la sélection manuelle.'; window.prompt('Copie le texte ci-dessous', text); }
      document.body.removeChild(ta);
    }
  });

  // Download
  btnDownload.addEventListener('click', () => {
    const pre = document.getElementById('outputPre');
    if (!pre) { status.textContent = 'Rien à télécharger.'; return; }
    const text = pre.textContent;
    const blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const filename = `converted_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}.s2p`;
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
    status.textContent = `Téléchargement lancé (${filename})`;
  });

});
