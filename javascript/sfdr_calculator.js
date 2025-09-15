// javascript/sfdr_calculator.js
// Calculateur SFDR / MDS — logique principale
// Conserve les mêmes ids que dans le HTML refactorisé.

(() => {
  'use strict';

  /* ---------- constantes ---------- */
  const kB = 1.380649e-23; // J/K

  /* ---------- utilitaires ---------- */
  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  function isFiniteNumber(x) { return typeof x === 'number' && isFinite(x); }
  function log10(x) { return Math.log(x) / Math.LN10; }
  function fmt(x, d = 2) { return (isFiniteNumber(x) ? x.toFixed(d) : '—'); }
  function nowISO() { return (new Date()).toISOString().replace(/[:.]/g, '-'); }

  /* ---------- DOM refs (match HTML) ---------- */
  const bwEl     = document.getElementById('bw');
  const tempEl   = document.getElementById('temp');
  const gainEl   = document.getElementById('gain');
  const nfEl     = document.getElementById('nf');
  const ip1El    = document.getElementById('ip1');
  const deltaEl  = document.getElementById('delta');
  const modeEls  = document.getElementsByName('mode'); // radio list
  const iip3Row  = document.getElementById('iip3row');
  const iip3El   = document.getElementById('iip3');
  const ip1IsOutputEl = document.getElementById('ip1_is_output');

  const iip3UsedEl = document.getElementById('iip3_used');
  const mdsPowEl   = document.getElementById('mds_pow');
  const mdsExprEl  = document.getElementById('mds_expr');
  const sfdrEl     = document.getElementById('sfdr');

  // Buttons (there are two possible places: topbar and aside)
  const resetBtn       = document.getElementById('resetBtn');
  const copyBtnTop     = document.getElementById('copyBtn');       // topbar
  const downloadBtnTop = document.getElementById('downloadBtn');   // topbar
  const copyResultsBtn = document.getElementById('copyResults');   // aside
  const downloadResultsBtn = document.getElementById('downloadResults'); // aside

  /* ---------- UI helpers ---------- */
  function getMode() {
    const checked = Array.from(modeEls).find(r => r.checked);
    return checked ? checked.value : 'ip1';
  }

  function refreshModeUI() {
    const mode = getMode();
    if (mode === 'iip3') {
      iip3Row.style.display = 'flex';
      ip1El.disabled = true;
      deltaEl.disabled = true;
      ip1IsOutputEl.disabled = true;
    } else {
      iip3Row.style.display = 'none';
      ip1El.disabled = false;
      deltaEl.disabled = false;
      ip1IsOutputEl.disabled = false;
    }
  }

  /* ---------- calcul principal ---------- */
  function compute() {
    // lecture inputs
    const bw   = toNum(bwEl.value);       // Hz
    const tempC= toNum(tempEl.value);     // °C
    const gain = toNum(gainEl.value);     // dB
    const nf   = toNum(nfEl.value);       // dB
    const mode = getMode();

    let iip3_used = NaN;

    if (mode === 'iip3') {
      iip3_used = toNum(iip3El.value);
    } else {
      // IP1 mode
      let ip1 = toNum(ip1El.value);
      if (ip1IsOutputEl && ip1IsOutputEl.checked && isFiniteNumber(gain)) {
        // OP1 (output) -> IP1 (input)
        ip1 = ip1 - gain;
      }
      const delta = toNum(deltaEl.value);
      const delta_use = Number.isFinite(delta) ? delta : 10.0;
      if (Number.isFinite(ip1)) iip3_used = ip1 + delta_use;
    }

    // temperature to Kelvin
    let Tkelvin = NaN;
    if (Number.isFinite(tempC)) Tkelvin = tempC + 273.15;

    // MDS = 10*log10(k*T*BW) + 30 + NF
    let mds = NaN;
    if (Number.isFinite(bw) && bw > 0 && Number.isFinite(nf) && Number.isFinite(Tkelvin) && Tkelvin > 0) {
      const prod = kB * Tkelvin * bw; // W
      mds = 10 * log10(prod) + 30 + nf;
    }

    // SFDR = (2/3)*(IIP3 - MDS)
    let sfdr = NaN;
    if (Number.isFinite(iip3_used) && Number.isFinite(mds)) {
      sfdr = (2.0 / 3.0) * (iip3_used - mds);
    }

    // affichage
    iip3UsedEl.textContent = Number.isFinite(iip3_used) ? `${iip3_used.toFixed(2)} dBm` : '—';
    mdsPowEl.textContent   = Number.isFinite(mds) ? `${mds.toFixed(2)} dBm` : '—';
    sfdrEl.textContent     = Number.isFinite(sfdr) ? `${sfdr.toFixed(2)} dB` : '—';

    // détail expression MDS (si possible)
    if (Number.isFinite(bw) && Number.isFinite(nf) && Number.isFinite(Tkelvin) && Tkelvin > 0) {
      mdsExprEl.textContent = `MDS = 10·log10(${kB}·${Tkelvin.toFixed(3)}·${bw}) + 30 + ${nf} = ${mds.toFixed(2)} dBm`;
    } else {
      mdsExprEl.textContent = '';
    }
  }

  /* ---------- reset to defaults ---------- */
  function resetDefaults() {
    bwEl.value = 1000000;
    tempEl.value = 20.0;
    gainEl.value = 30;
    nfEl.value = 3.0;
    document.querySelector('input[name="mode"][value="ip1"]').checked = true;
    ip1El.value = 18.0;
    iip3El.value = 28.0;
    deltaEl.value = 10.0;
    if (ip1IsOutputEl) ip1IsOutputEl.checked = false;
    refreshModeUI();
    compute();
  }

  /* ---------- copy & download helpers ---------- */
  function buildResultsText() {
    return [
      `--- SFDR & MDS results ---`,
      `Date: ${new Date().toLocaleString()}`,
      `BW (Hz): ${bwEl.value}`,
      `Temp (°C): ${tempEl.value}`,
      `Gain (dB): ${gainEl.value}`,
      `NF (dB): ${nfEl.value}`,
      `Mode: ${getMode()}`,
      `IIP3 utilisé: ${iip3UsedEl.textContent}`,
      `MDS (dBm): ${mdsPowEl.textContent}`,
      `SFDR (dB): ${sfdrEl.textContent}`,
      ``
    ].join('\n');
  }

  async function copyResults() {
    const txt = buildResultsText();
    if (!navigator.clipboard) {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        alert('Résultats copiés dans le presse-papier (fallback).');
      } catch (e) {
        alert('Impossible de copier.');
      } finally {
        ta.remove();
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(txt);
      // simple non-intrusive feedback
      showTransientMessage('Résultats copiés');
    } catch (e) {
      alert('Impossible de copier (autorisations).');
    }
  }

  function downloadResults() {
    const txt = buildResultsText();
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fname = `sfdr_mds_${nowISO()}.txt`;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
    showTransientMessage(`Téléchargé ${fname}`);
  }

  /* ---------- small transient message (non-blocking) ---------- */
  function showTransientMessage(msg, ms = 1400) {
    // create small toast at bottom-right of page
    const id = 'sfdr-toast';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.position = 'fixed';
      el.style.right = '16px';
      el.style.bottom = '18px';
      el.style.padding = '10px 12px';
      el.style.background = 'linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0.45))';
      el.style.color = 'white';
      el.style.borderRadius = '8px';
      el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.5)';
      el.style.fontSize = '0.95rem';
      el.style.zIndex = 9999;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(showTransientMessage._t);
    showTransientMessage._t = setTimeout(() => {
      el.style.transition = 'opacity 300ms';
      el.style.opacity = '0';
      setTimeout(() => { if (el) el.remove(); }, 350);
    }, ms);
  }

  /* ---------- event wiring ---------- */
  // input changes -> compute
  [bwEl, tempEl, gainEl, nfEl, ip1El, deltaEl, iip3El, ip1IsOutputEl].forEach(el => {
    if (!el) return;
    el.addEventListener('input', compute);
  });

  // radios
  Array.from(modeEls).forEach(r => {
    r.addEventListener('change', () => {
      refreshModeUI();
      compute();
    });
  });

  // reset button (topbar)
  if (resetBtn) resetBtn.addEventListener('click', () => { resetDefaults(); });

  // copy / download handlers (both locations)
  if (copyBtnTop) copyBtnTop.addEventListener('click', copyResults);
  if (downloadBtnTop) downloadBtnTop.addEventListener('click', downloadResults);
  if (copyResultsBtn) copyResultsBtn.addEventListener('click', copyResults);
  if (downloadResultsBtn) downloadResultsBtn.addEventListener('click', downloadResults);

  // keyboard shortcut: Ctrl+Enter => compute
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key === 'Enter') {
      ev.preventDefault();
      compute();
      showTransientMessage('Calcul mis à jour');
    }
  });

  /* ---------- init ---------- */
  refreshModeUI();
  compute();

  // expose for debugging (optional)
  window.sfdrCalculator = {
    compute, resetDefaults, copyResults, downloadResults
  };

})();
