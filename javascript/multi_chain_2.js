// multi_chain_2.js (corrigé)
// Module de calcul pour Multi-Chain — calcule Gain / NF / OP1 / IP1 en fonction de la fréquence
// Améliorations : tolérance distance librairie, interpolation entre points voisins, cache stable.

(function () {
  'use strict';

  // ---------- Utils ----------
  function isFiniteNumber(x) { return typeof x === 'number' && isFinite(x); }
  function clampNum(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

  function dbToLin(db) {
    if (!isFiniteNumber(db)) return 1e300;
    if (db > 500) return 1e300;
    return Math.pow(10, db / 10);
  }
  function linToDb(lin) {
    if (!isFiniteNumber(lin) || lin <= 0) return -Infinity;
    return 10 * Math.log10(lin);
  }

  // ---------- Library API wrapper (safe) ----------
  const LibraryAPI = {
    list: () => {
      try {
        if (window.MultiLibrary && typeof window.MultiLibrary.listEntries === 'function') return window.MultiLibrary.listEntries();
        if (window.MultiLibrary && typeof window.MultiLibrary._entriesInternal === 'function') return window.MultiLibrary._entriesInternal();
      } catch (e) { /* ignore */ }
      return [];
    },
    getClosest: async (libId, freqHz) => {
      try {
        if (window.MultiLibrary && typeof window.MultiLibrary.getClosestValue === 'function') {
          return await window.MultiLibrary.getClosestValue(libId, freqHz);
        }
      } catch (e) { console.warn('Library getClosest error', e); }
      return null;
    },
    exportData: () => {
      try {
        if (window.MultiLibrary && typeof window.MultiLibrary.exportData === 'function') return window.MultiLibrary.exportData();
        if (window.MultiLibrary && typeof window.MultiLibrary._entriesInternal === 'function') return window.MultiLibrary._entriesInternal();
      } catch (e) { /* ignore */ }
      return [];
    },
    onChange: (cb) => {
      try {
        if (window.MultiLibrary && typeof window.MultiLibrary.onChange === 'function') {
          return window.MultiLibrary.onChange(cb);
        }
      } catch (e) { /* ignore */ }
      return () => {};
    }
  };

  // ---------- cache pour résolutions bibliothèque ----------
  // clé: `${libId}@${freq}` -> { freq, s21_dB, interpolated(boolean) }
  const libCache = new Map();

  // ---------- cancellation / request sequencing ----------
  let _lastRequestId = 0;
  let _runningRequestId = 0;

  // debounce helper (short)
  let _debounceTimer = null;
  const DEBOUNCE_MS = 80;

  // tolerance default (Hz) : configurable via window.MultiIO.libMatchToleranceHz
  function getLibToleranceHz() {
    try {
      if (window.MultiIO && Number.isFinite(Number(window.MultiIO.libMatchToleranceHz))) {
        return Number(window.MultiIO.libMatchToleranceHz);
      }
    } catch (e) {}
    return 50e6; // 50 MHz default
  }

  // ---------- helpers pour interpolation et recherche dans une librairie ----------
  // cherche l'entrée de la librairie (exportData / internal); retourne { id, name, points:[{freq,s21_dB}] } ou null
  function getLibEntry(libIdOrName) {
    const all = LibraryAPI.exportData() || [];
    const key = String(libIdOrName || '').toLowerCase();
    for (const e of all) {
      if (!e) continue;
      // match by id or name (case-insensitive). Some entries may not have id.
      if ((e.id && String(e.id).toLowerCase() === key) || (e.name && String(e.name).toLowerCase() === key) || (String(e.name || '').toLowerCase() === key)) {
        // ensure points are numbers and sorted asc
        const pts = Array.isArray(e.points) ? e.points.map(p => ({ freq: Number(p.freq), s21_dB: Number(p.s21_dB) })).filter(p => isFiniteNumber(p.freq) && isFiniteNumber(p.s21_dB)) : [];
        pts.sort((a,b) => a.freq - b.freq);
        return { id: e.id, name: e.name, points: pts };
      }
    }
    // second attempt: try name match loosely
    if (key) {
      for (const e of all) {
        if (!e) continue;
        const nm = String(e.name || '').toLowerCase();
        if (nm.includes(key) || key.includes(nm)) {
          const pts = Array.isArray(e.points) ? e.points.map(p => ({ freq: Number(p.freq), s21_dB: Number(p.s21_dB) })).filter(p => isFiniteNumber(p.freq) && isFiniteNumber(p.s21_dB)) : [];
          pts.sort((a,b) => a.freq - b.freq);
          return { id: e.id, name: e.name, points: pts };
        }
      }
    }
    return null;
  }

  // retourne { loIndex, hiIndex } indices autour de freq dans points[] (sorted asc)
  function findNeighborIndices(points, freq) {
    if (!Array.isArray(points) || points.length === 0) return { lo: -1, hi: -1 };
    if (freq <= points[0].freq) return { lo: 0, hi: 0 };
    const n = points.length;
    if (freq >= points[n-1].freq) return { lo: n-1, hi: n-1 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = Math.floor((hi + lo) / 2);
      if (points[mid].freq === freq) return { lo: mid, hi: mid };
      if (points[mid].freq < freq) lo = mid; else hi = mid;
    }
    return { lo, hi };
  }

  function linearInterpolate(x0, y0, x1, y1, x) {
    if (!isFiniteNumber(x0) || !isFiniteNumber(y0) || !isFiniteNumber(x1) || !isFiniteNumber(y1)) return null;
    if (x1 === x0) return y0;
    const t = (x - x0) / (x1 - x0);
    return y0 + t * (y1 - y0);
  }

  // ---------- résolution d'un champ (gain/insertion/nf/op1) ----------
  // retourne Number (dB) ou null/undefined if not resolvable (we fall back to heuristics upstream)
  async function resolveField(stage, fieldName, freq) {
    const src = (stage && stage.sources && stage.sources[fieldName]) ? stage.sources[fieldName] : { type: 'manual' };
    const tol = getLibToleranceHz();

    if (src && src.type === 'library' && src.libId) {
      const key = `${String(src.libId)}@${Number(freq)}`;
      if (libCache.has(key)) {
        const v = libCache.get(key);
        return (v && typeof v.s21_dB === 'number') ? Number(v.s21_dB) : null;
      }

      // try getClosest (fast path)
      try {
        const val = await LibraryAPI.getClosest(src.libId, freq);
        if (val && typeof val.s21_dB === 'number' && isFiniteNumber(Number(val.freq))) {
          const valFreq = Number(val.freq);
          const distance = Math.abs(valFreq - Number(freq));
          if (distance <= tol) {
            const res = Number(val.s21_dB);
            libCache.set(key, { freq: valFreq, s21_dB: res, interpolated: false });
            return res;
          }
          // if too far, try interpolation using the full library points (if available)
        }
      } catch (e) {
        console.warn('Error resolving library value via getClosest', e);
      }

      // attempt to get full library points and interpolate between neighbors
      try {
        const libEntry = getLibEntry(src.libId);
        if (libEntry && Array.isArray(libEntry.points) && libEntry.points.length) {
          const pts = libEntry.points;
          const { lo, hi } = findNeighborIndices(pts, freq);
          if (lo >= 0 && hi >= 0) {
            const pLo = pts[lo], pHi = pts[hi];
            // If exact point exists
            if (pLo.freq === pHi.freq && pLo.freq === freq) {
              libCache.set(key, { freq: Number(pLo.freq), s21_dB: Number(pLo.s21_dB), interpolated: false });
              return Number(pLo.s21_dB);
            }
            // If both neighbors exist and are different indices -> interpolate
            if (lo !== hi) {
              // optionally: reject interpolation if neighbors too far apart compared to tolerance
              const maxNeighborSpan = Math.abs(pHi.freq - pLo.freq);
              // Accept interpolation if at least one neighbor within 2*tol OR entire span reasonably small (e.g., < 5*tol)
              if ((Math.abs(pLo.freq - freq) <= 2 * tol) || (Math.abs(pHi.freq - freq) <= 2 * tol) || (maxNeighborSpan <= 5 * tol)) {
                const interp = linearInterpolate(pLo.freq, pLo.s21_dB, pHi.freq, pHi.s21_dB, freq);
                if (interp !== null) {
                  libCache.set(key, { freq: Number(freq), s21_dB: Number(interp), interpolated: true, sourceLib: libEntry.name || libEntry.id });
                  return Number(interp);
                }
              }
            } else {
              // only one neighbor available (edge), accept it only if within tolerance
              const p = pLo;
              if (Math.abs(p.freq - freq) <= tol) {
                libCache.set(key, { freq: Number(p.freq), s21_dB: Number(p.s21_dB), interpolated: false });
                return Number(p.s21_dB);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Error interpolating library points', e);
      }

      // if we reach here, we couldn't find a suitable library value
      // fallthrough to manual heuristics below
    }

    // manual fallback heuristics
    if (fieldName === 'gain') return (stage.gain_dB !== undefined && stage.gain_dB !== null) ? Number(stage.gain_dB) : 0;
    if (fieldName === 'insertion') return (stage.insertion_loss_dB !== undefined && stage.insertion_loss_dB !== null) ? Number(stage.insertion_loss_dB) : 0;
    if (fieldName === 'nf') return (stage.nf_dB !== undefined && stage.nf_dB !== null) ? Number(stage.nf_dB) : undefined;
    if (fieldName === 'op1') return (stage.op1db_dBm !== undefined && stage.op1db_dBm !== null) ? Number(stage.op1db_dBm) : 1000;
    return null;
  }

  // ---------- helpers de calcul (NF / P1) ----------
  function calcNF_from_chain(chain) {
    if (!Array.isArray(chain) || chain.length === 0) return NaN;
    // Friis: F_total = F1 + (F2 - 1)/G1 + (F3 - 1)/(G1*G2) + ...
    let Ftot = chain[0].nf_lin;
    let Gprod = chain[0].gain_lin;
    for (let i = 1; i < chain.length; i++) {
      const Fi = chain[i].nf_lin;
      if (!isFiniteNumber(Fi) || Fi <= 0) { Gprod *= chain[i].gain_lin; continue; }
      Ftot += (Fi - 1) / (Gprod || 1e-300);
      Gprod *= chain[i].gain_lin;
    }
    return linToDb(Ftot);
  }

  function calcP1db_from_chain(chain) {
    const N = chain.length;
    if (N === 0) return -Infinity;
    const gain_after = new Array(N).fill(1.0);
    let prod = 1.0;
    for (let idx = N - 1; idx >= 0; --idx) {
      gain_after[idx] = prod;
      prod *= chain[idx].gain_lin;
    }
    let inv_sum = 0;
    for (let i = 0; i < N; i++) {
      const p = chain[i].p1_lin;
      if (!isFiniteNumber(p) || p <= 0) continue;
      const denom = p * (isFiniteNumber(gain_after[i]) ? gain_after[i] : 1);
      inv_sum += 1 / (denom || 1e-300);
    }
    if (inv_sum === 0) return Infinity;
    const Ptot = 1 / inv_sum;
    return linToDb(Ptot);
  }

  // ---------- main compute logic ----------
  async function _computeRangeInternal(requestId, freqs) {
    if (!Array.isArray(freqs) || freqs.length === 0) {
      const empty = { freqs: [], gain: [], nf: [], op1: [], ip1: [] };
      if (window.ChainUI && typeof window.ChainUI.updateUIAfterCompute === 'function') {
        try { window.ChainUI.updateUIAfterCompute(empty); } catch (e) { console.warn(e); }
      }
      return empty;
    }

    // copy stages snapshot
    const stagesLocal = Array.isArray(window.stages) ? JSON.parse(JSON.stringify(window.stages)) : [];

    const Nf = freqs.length;
    const gainArr = new Array(Nf).fill(NaN);
    const nfArr = new Array(Nf).fill(NaN);
    const op1Arr = new Array(Nf).fill(NaN);
    const ip1Arr = new Array(Nf).fill(NaN);

    for (let fi = 0; fi < Nf; fi++) {
      if (requestId !== _runningRequestId) return null; // abort if superseded

      const f = Number(freqs[fi]);
      if (!isFiniteNumber(f)) {
        gainArr[fi] = NaN; nfArr[fi] = NaN; op1Arr[fi] = NaN; ip1Arr[fi] = NaN;
        continue;
      }

      const chainForNF = [];
      const chainForP1 = [];

      for (let si = 0; si < stagesLocal.length; si++) {
        const s = stagesLocal[si] || {};
        let gain_dB = 0;
        let nf_dB = undefined;
        let p1_dbm = (s.op1db_dBm !== undefined && s.op1db_dBm !== null) ? Number(s.op1db_dBm) : 1000;

        try {
          if (s.type === 'filter' || s.type === 'switch') {
            const insVal = await resolveField(s, 'insertion', f);
            if (insVal !== undefined && insVal !== null && insVal !== '') {
              const ins = Math.abs(Number(insVal));
              gain_dB = -ins;
              const nfVal = await resolveField(s, 'nf', f);
              nf_dB = (nfVal !== undefined && nfVal !== null && nfVal !== '') ? Number(nfVal) : ins;
            } else {
              const insM = Number(s.insertion_loss_dB || 0);
              gain_dB = -insM;
              nf_dB = (s.nf_dB !== undefined && s.nf_dB !== null) ? Number(s.nf_dB) : insM;
            }
          } else if (s.type === 'atten') {
            const insVal = await resolveField(s, 'insertion', f);
            const gainVal = await resolveField(s, 'gain', f);
            let att = null;
            if (insVal !== undefined && insVal !== null && insVal !== '') att = Math.abs(Number(insVal));
            else if (gainVal !== undefined && gainVal !== null && gainVal !== '') att = Math.abs(Number(gainVal));
            else att = Math.abs(Number(s.gain_dB || s.insertion_loss_dB || 0));
            gain_dB = -att;
            const nfVal = await resolveField(s, 'nf', f);
            nf_dB = (nfVal !== undefined && nfVal !== null && nfVal !== '') ? Number(nfVal) : att;
          } else if (s.type === 'mixer') {
            const convVal = await resolveField(s, 'insertion', f);
            if (convVal !== undefined && convVal !== null && convVal !== '') {
              const conv = Math.abs(Number(convVal));
              gain_dB = -conv;
              const nfVal = await resolveField(s, 'nf', f);
              nf_dB = (nfVal !== undefined && nfVal !== null && nfVal !== '') ? Number(nfVal) : conv;
            } else {
              const gVal = await resolveField(s, 'gain', f);
              gain_dB = (gVal !== undefined && gVal !== null && gVal !== '') ? Number(gVal) : Number(s.gain_dB || 0);
              nf_dB = (s.nf_dB !== undefined && s.nf_dB !== null) ? Number(s.nf_dB) : Math.abs(gain_dB);
            }
          } else {
            const gVal = await resolveField(s, 'gain', f);
            gain_dB = (gVal !== undefined && gVal !== null && gVal !== '') ? Number(gVal) : Number(s.gain_dB || 0);
            const nfVal = await resolveField(s, 'nf', f);
            nf_dB = (nfVal !== undefined && nfVal !== null && nfVal !== '') ? Number(nfVal) : (s.nf_dB !== undefined && s.nf_dB !== null ? Number(s.nf_dB) : Math.abs(gain_dB));
          }

          const op1Val = await resolveField(s, 'op1', f);
          if (op1Val !== undefined && op1Val !== null && op1Val !== '') p1_dbm = Number(op1Val);
          else p1_dbm = (s.op1db_dBm !== undefined && s.op1db_dBm !== null) ? Number(s.op1db_dBm) : 1000;
        } catch (e) {
          console.warn('Erreur résolution stage', e);
        }

        const gain_lin = dbToLin(gain_dB);
        const nf_lin = dbToLin(nf_dB !== undefined && nf_dB !== null ? nf_dB : 0);
        const p1_lin = (p1_dbm > 500) ? 1e300 : Math.pow(10, p1_dbm / 10);

        chainForNF.push({ gain_lin: isFiniteNumber(gain_lin) ? gain_lin : 1.0, nf_lin: isFiniteNumber(nf_lin) ? nf_lin : 1.0, name: s.name });
        chainForP1.push({ gain_lin: isFiniteNumber(gain_lin) ? gain_lin : 1.0, p1_lin: isFiniteNumber(p1_lin) ? p1_lin : 1e300, name: s.name, op1_dbm: p1_dbm });
      } // end stages loop

      // compute totals for this frequency
      let gprod_lin = 1.0;
      for (const c of chainForNF) gprod_lin *= (isFiniteNumber(c.gain_lin) ? c.gain_lin : 1.0);
      const gainTotal_dB = linToDb(gprod_lin);
      const nfTotal_dB = calcNF_from_chain(chainForNF);
      const p1_out_dBm = calcP1db_from_chain(chainForP1);
      const ip1_in_dBm = p1_out_dBm - gainTotal_dB;

      gainArr[fi] = isFiniteNumber(gainTotal_dB) ? gainTotal_dB : NaN;
      nfArr[fi] = isFiniteNumber(nfTotal_dB) ? nfTotal_dB : NaN;
      op1Arr[fi] = isFiniteNumber(p1_out_dBm) ? p1_out_dBm : NaN;
      ip1Arr[fi] = isFiniteNumber(ip1_in_dBm) ? ip1_in_dBm : NaN;
    } // end freq loop

    const result = { freqs: freqs.slice(), gain: gainArr, nf: nfArr, op1: op1Arr, ip1: ip1Arr };

    if (requestId !== _runningRequestId) return null;

    if (window.ChainUI && typeof window.ChainUI.updateUIAfterCompute === 'function') {
      try { window.ChainUI.updateUIAfterCompute(result); } catch (e) { console.warn('updateUIAfterCompute failed', e); }
      if (window.ChainUI) window.ChainUI.lastComputed = result;
    }

    return result;
  }

  // ---------- public computeRange (debounced + cancellable) ----------
  window.ChainCompute = window.ChainCompute || {};

  window.ChainCompute.computeRange = function (freqs) {
    const arr = Array.isArray(freqs) ? freqs.map(x => Number(x)).filter(x => isFiniteNumber(x)) : [];
    _lastRequestId++;
    const thisRequestId = _lastRequestId;

    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }

    return new Promise((resolve, reject) => {
      _debounceTimer = setTimeout(async () => {
        _runningRequestId = thisRequestId;
        try {
          const res = await _computeRangeInternal(thisRequestId, arr);
          if (res === null) { resolve(null); return; }
          resolve(res);
        } catch (e) {
          console.error('computeRange error', e);
          if (window.ChainUI && typeof window.ChainUI.updateUIAfterCompute === 'function') {
            try { window.ChainUI.updateUIAfterCompute({ freqs:[], gain:[], nf:[], op1:[], ip1:[] }); } catch (ee) {}
          }
          reject(e);
        }
      }, DEBOUNCE_MS);
    });
  };

  // notify UI that compute module is ready and subscribe to lib changes
  window.ChainCompute._notifyUIReady = function () {
    try {
      LibraryAPI.onChange(() => {
        libCache.clear();
        if (window.ChainUI && typeof window.ChainUI.requestCompute === 'function') {
          try { window.ChainUI.requestCompute(); } catch (e) { console.warn('requestCompute failed', e); }
        } else if (window.ChainUI && Array.isArray(window.ChainUI._pendingRequest) && window.ChainUI._pendingRequest.length) {
          try { window.ChainCompute.computeRange(window.ChainUI._pendingRequest); } catch (e) {}
        }
      });
    } catch (e) { /* ignore */ }

    try {
      if (window.ChainUI && Array.isArray(window.ChainUI._pendingRequest) && window.ChainUI._pendingRequest.length) {
        window.ChainCompute.computeRange(window.ChainUI._pendingRequest).catch(e => console.warn('pending compute failed', e));
        window.ChainUI._pendingRequest = null;
      }
    } catch (e) { /* ignore */ }
  };

  // expose internals
  window.ChainCompute._internal = {
    libCache,
    resolveField,
    calcNF_from_chain,
    calcP1db_from_chain,
    getLibToleranceHz
  };

  console.log('multi_chain_2 (compute) initialisé (corrigé).');
})();
