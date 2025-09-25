// multi_io.js (corrigé & robuste)
// - Parser permissif pour fichiers 2-col (Hz, dB)
// - Import/Export YAML + library via MultiLibrary (sync/async)
// - Export propre des libraries (utilise MultiLibrary.exportData())
// - Expose tolerance matching: window.MultiIO.libMatchToleranceHz (default 50e6)

(function(){
  'use strict';

  // DOM refs (défensif)
  const yamlFileInput = (typeof document !== 'undefined') ? document.getElementById('yamlFileInput') : null;
  const btnImportYaml = (typeof document !== 'undefined') ? document.getElementById('btnImportYaml') : null;
  const btnExportYaml = (typeof document !== 'undefined') ? document.getElementById('btnExportYaml') : null;
  const btnDownloadExample = (typeof document !== 'undefined') ? document.getElementById('btnDownloadExample') : null;
  const yamlStatus = (typeof document !== 'undefined') ? document.getElementById('yamlStatus') : null;

  function setYamlStatus(text, ms = 1400) {
    if (!yamlStatus) return;
    try {
      yamlStatus.textContent = text;
      if (ms > 0) setTimeout(() => { if (yamlStatus) yamlStatus.textContent = ''; }, ms);
    } catch(e) { /* ignore */ }
  }

  function downloadText(filename, text, type='text/plain;charset=utf-8') {
    try {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('downloadText failed', e);
    }
  }

  // tolerance par défaut pour considérer une valeur 'proche' dans la librairie (Hz)
  window.MultiIO = window.MultiIO || {};
  if (window.MultiIO.libMatchToleranceHz === undefined) window.MultiIO.libMatchToleranceHz = 50e6; // 50 MHz

  /* ---------- Parser permissif pour fichiers 2-col (freq,val) ---------- */
  // Retourne tableau de {freq, s21_dB}
  function parseTwoColumnFlexible(text) {
    const lines = String(text || '').split(/\r?\n/);
    const pts = [];
    // regex pour nombres entiers/décimaux/scientific (accepte ',' comme décimal dans certains cas)
    const NUM_RE = /[-+]?(?:\d+(?:[.,]\d*)?|\d*[.,]\d+)(?:[eE][-+]?\d+)?/g;

    for (let raw of lines) {
      let line = String(raw || '').trim();
      if (!line) continue;
      if (line.startsWith('#') || line.startsWith('!') || line.startsWith('//')) continue;

      // preserve commas inside numbers for later normalization
      const normalized = line.replace(/\t/g,' ').replace(/;/g,' ').replace(/\s+/g,' ');

      const tokens = [];
      let m;
      NUM_RE.lastIndex = 0;
      while ((m = NUM_RE.exec(normalized)) !== null) {
        let tok = m[0];
        // remove thousand separators spaces (rare)
        tok = tok.replace(/\s+/g, '');
        // if only comma used as decimal separator, normalize to dot
        if (tok.indexOf(',') !== -1 && tok.indexOf('.') === -1) tok = tok.replace(',', '.');
        const v = Number(tok);
        if (Number.isFinite(v)) tokens.push(v);
      }

      if (tokens.length >= 2) {
        const f = Number(tokens[0]);
        const d = Number(tokens[1]);
        if (Number.isFinite(f) && Number.isFinite(d)) pts.push({ freq: f, s21_dB: d });
        if (pts.length >= 200000) break;
        continue;
      }

      // fallback brut: split on common delimiters
      const parts = line.split(/[,\t; ]+/).map(p => p.trim()).filter(Boolean);
      const nums = [];
      for (const p of parts) {
        let t = p.replace(/\s+/g,'');
        if (t.indexOf(',') !== -1 && t.indexOf('.') === -1) t = t.replace(',', '.');
        const v = Number(t);
        if (Number.isFinite(v)) nums.push(v);
      }
      if (nums.length >= 2) {
        const f = Number(nums[0]);
        const d = Number(nums[1]);
        if (Number.isFinite(f) && Number.isFinite(d)) pts.push({ freq: f, s21_dB: d });
      }

      if (pts.length >= 200000) break;
    } // end lines

    if (!pts.length) return [];

    // sort & dedupe by freq (keep last)
    pts.sort((a,b) => a.freq - b.freq);
    const uniq = [];
    let lastF = NaN;
    for (const p of pts) {
      if (!isFinite(p.freq) || !isFinite(p.s21_dB)) continue;
      if (p.freq === lastF) uniq[uniq.length - 1] = p;
      else { uniq.push(p); lastF = p.freq; }
    }
    return uniq;
  }

  /* ---------- YAML helpers (export/import) ---------- */
  function yamlForLibraryEntry(e) {
    const lines = [];
    lines.push(`  - name: ${e.name}`);
    lines.push(`    type: ${e.type || 'txt'}`);
    lines.push(`    points: |`);
    for (const p of e.points) {
      const freq = Number(p.freq);
      const val = Number(p.s21_dB);
      const freqStr = Number.isFinite(freq) ? freq.toString() : '';
      const valStr = Number.isFinite(val) ? ((Math.abs(val) < 1e-6) ? '0' : String(val)) : '';
      lines.push(`      ${freqStr} ${valStr}`);
    }
    return lines.join('\n');
  }

  function safeGetLibEntries() {
    // Prefer MultiLibrary.exportData()
    try {
      if (window.MultiLibrary && typeof window.MultiLibrary.exportData === 'function') {
        const d = window.MultiLibrary.exportData();
        if (Array.isArray(d)) return d;
      }
    } catch (e) { console.warn('safeGetLibEntries exportData failed', e); }

    // fallback internal
    try {
      if (window.MultiLibrary && typeof window.MultiLibrary._entriesInternal === 'function') {
        const d = window.MultiLibrary._entriesInternal();
        if (Array.isArray(d)) return d;
      }
    } catch (e) { console.warn('safeGetLibEntries _entriesInternal failed', e); }

    // fallback pending from MultiIO
    try {
      if (window.MultiIO && Array.isArray(window.MultiIO._pendingLibs)) {
        return window.MultiIO._pendingLibs.map(x => ({ id: x.id || null, name: x.name, type: x.type || 'txt', points: x.points || [] }));
      }
    } catch (e) { /* ignore */ }

    return [];
  }

  function exportFullYaml() {
    const archLines = ['architecture:'];
    const stagesLocal = (Array.isArray(window.stages) ? window.stages : []);
    const libEntries = safeGetLibEntries();

    for (const s of stagesLocal) {
      const entry = [];
      entry.push(`  - name: ${s.name || 'stage'}`);
      entry.push(`    type: ${s.type || 'custom'}`);
      if (s.type === 'filter' || s.type === 'switch') {
        entry.push(`    insertion_loss_dB: ${Number(s.insertion_loss_dB || 0)}`);
        if (s.nf_dB !== undefined) entry.push(`    nf_dB: ${Number(s.nf_dB)}`);
      } else if (s.type === 'atten') {
        entry.push(`    gain_dB: ${Number(s.gain_dB || 0)}`);
      } else {
        if (s.gain_dB !== undefined) entry.push(`    gain_dB: ${Number(s.gain_dB)}`);
        if (s.nf_dB !== undefined) entry.push(`    nf_dB: ${Number(s.nf_dB)}`);
      }
      if (s.op1db_dBm !== undefined) entry.push(`    op1db_dBm: ${Number(s.op1db_dBm)}`);

      // map file -> library name if source uses library
      if (s.sources) {
        const tryFindLibName = (libObj) => {
          if (!libObj) return null;
          const id = (typeof libObj === 'object') ? libObj.libId : libObj;
          if (!id) return null;
          const match = (libEntries || []).find(x => (x.id && String(x.id) === String(id)) || (x.name && String(x.name) === String(id)));
          return match ? match.name : null;
        };
        const insertionName = (s.sources.insertion) ? tryFindLibName(s.sources.insertion) : null;
        const gainName = (s.sources.gain) ? tryFindLibName(s.sources.gain) : null;
        if (insertionName) entry.push(`    file: ${insertionName}`);
        else if (gainName) entry.push(`    file: ${gainName}`);
      }

      archLines.push(entry.join('\n'));
    }

    const libData = safeGetLibEntries();
    const libLines = ['library:'];
    for (const e of libData) {
      if (!e || !Array.isArray(e.points) || !e.points.length) continue;
      libLines.push(yamlForLibraryEntry({ name: e.name, type: e.type || 'txt', points: e.points }));
    }

    // compute block (freq range + chart ranges)
    const computeLines = ['compute:'];
    try {
      const fmin = (typeof window !== 'undefined' && typeof freqMinInput !== 'undefined' && freqMinInput) ? Number(freqMinInput.value) : null;
      const fmax = (typeof window !== 'undefined' && typeof freqMaxInput !== 'undefined' && freqMaxInput) ? Number(freqMaxInput.value) : null;
      const fstep = (typeof window !== 'undefined' && typeof freqStepInput !== 'undefined' && freqStepInput) ? Number(freqStepInput.value) : null;
      if (Number.isFinite(fmin)) computeLines.push(`  freq_min_Hz: ${fmin}`);
      if (Number.isFinite(fmax)) computeLines.push(`  freq_max_Hz: ${fmax}`);
      if (Number.isFinite(fstep)) computeLines.push(`  freq_step_Hz: ${fstep}`);

      try {
        const ranges = (window.ChainUI && typeof window.ChainUI.getChartRanges === 'function') ? window.ChainUI.getChartRanges() : (window.ChainUI && window.ChainUI.chartRanges ? window.ChainUI.chartRanges : null);
        if (ranges && typeof ranges === 'object') {
          // only push chart_ranges if at least one value present
          const keys = ['gain','nf','op1','ip1'];
          let any = false;
          const temp = [];
          for (const k of keys) {
            const v = ranges[k];
            if (v && (Number.isFinite(Number(v.ymin)) || Number.isFinite(Number(v.ymax)))) {
              any = true;
              temp.push(`    ${k}:`);
              if (Number.isFinite(Number(v.ymin))) temp.push(`      ymin: ${Number(v.ymin)}`);
              if (Number.isFinite(Number(v.ymax))) temp.push(`      ymax: ${Number(v.ymax)}`);
            }
          }
          if (any) {
            computeLines.push('  chart_ranges:');
            computeLines.push(...temp);
          }
        }
      } catch(e) { /* ignore chart ranges */ }
    } catch (e) { /* ignore compute */ }

    // assemble final YAML string
    // ensure sections separated by blank lines for readability
    const parts = [];
    parts.push(archLines.join('\n'));
    parts.push(libLines.join('\n'));
    parts.push(computeLines.join('\n'));
    return parts.join('\n\n');
  }

  async function importYamlString(yamlText) {
    let doc;
    try { doc = jsyaml.load(yamlText); }
    catch (e) { setYamlStatus('YAML invalide'); console.error(e); return false; }
    if (!doc) { setYamlStatus('YAML vide'); return false; }

    // library
    const libsToAdd = [];
    if (Array.isArray(doc.library)) {
      for (const lib of doc.library) {
        if (!lib || !lib.name) continue;
        let pts = [];
        if (typeof lib.points === 'string') {
          pts = parseTwoColumnFlexible(lib.points);
        } else if (Array.isArray(lib.points)) {
          for (const p of lib.points) {
            if (p && isFinite(Number(p.freq)) && isFinite(Number(p.s21_dB))) pts.push({ freq: Number(p.freq), s21_dB: Number(p.s21_dB) });
          }
        }
        if (pts.length) libsToAdd.push({ name: String(lib.name), type: lib.type || 'txt', points: pts });
      }

      if (libsToAdd.length) {
        if (window.MultiLibrary && typeof window.MultiLibrary.importData === 'function') {
          try {
            const maybe = window.MultiLibrary.importData(libsToAdd);
            if (maybe && typeof maybe.then === 'function') await maybe;
          } catch (e) {
            console.warn('MultiLibrary.importData failed', e);
            window.MultiIO._pendingLibs = window.MultiIO._pendingLibs || [];
            window.MultiIO._pendingLibs.push(...libsToAdd);
          }
        } else {
          window.MultiIO._pendingLibs = window.MultiIO._pendingLibs || [];
          window.MultiIO._pendingLibs.push(...libsToAdd);
          try { if (typeof window.MultiLibrary !== 'undefined' && typeof window.MultiLibrary._notifyChange === 'function') window.MultiLibrary._notifyChange(); } catch(e){}
          try { if (typeof window.renderStages === 'function') window.renderStages(); } catch(e){}
          try { if (window.ChainUI && typeof window.ChainUI.requestCompute === 'function') window.ChainUI.requestCompute(); } catch(e){}
        }
      }
    }

    // architecture
    if (Array.isArray(doc.architecture)) {
      const newStages = [];
      const libEntries = safeGetLibEntries();
      for (const it of doc.architecture) {
        if (!it || !it.name) continue;
        const s = { name: it.name, type: it.type || 'custom', gain_dB: undefined, nf_dB: undefined, insertion_loss_dB: undefined, op1db_dBm: undefined, sources: {} };
        if (it.gain_dB !== undefined) s.gain_dB = Number(it.gain_dB);
        if (it.nf_dB !== undefined) s.nf_dB = Number(it.nf_dB);
        if (it.insertion_loss_dB !== undefined) s.insertion_loss_dB = Number(it.insertion_loss_dB);
        if (it.op1db_dBm !== undefined) s.op1db_dBm = Number(it.op1db_dBm);

        if (it.file) {
          const fn = String(it.file).trim();
          const match = (libEntries || []).find(x => (x.name && String(x.name).trim().toLowerCase() === fn.toLowerCase()) || (x.id && String(x.id).trim().toLowerCase() === fn.toLowerCase()));
          if (match) {
            if (s.type === 'filter' || s.type === 'switch' || s.type === 'atten' || s.type === 'mixer') {
              s.sources = { insertion:{type:'library', libId: match.id || match.name}, gain:{type:'manual'}, nf:{type:'manual'}, op1:{type:'manual'} };
            } else {
              s.sources = { gain:{type:'library', libId: match.id || match.name}, nf:{type:'manual'}, insertion:{type:'manual'}, op1:{type:'manual'} };
            }
          } else {
            if (s.type === 'filter' || s.type === 'switch' || s.type === 'atten' || s.type === 'mixer') {
              s.sources = { insertion:{type:'manual', file: fn}, gain:{type:'manual'}, nf:{type:'manual'}, op1:{type:'manual'} };
            } else {
              s.sources = { gain:{type:'manual', file: fn}, nf:{type:'manual'}, insertion:{type:'manual'}, op1:{type:'manual'} };
            }
          }
        }

        // heuristics defaults
        if (s.type === 'filter' || s.type === 'switch') { if (s.insertion_loss_dB===undefined) s.insertion_loss_dB = 0; if (s.nf_dB===undefined) s.nf_dB = s.insertion_loss_dB; }
        else if (s.type === 'atten') { if (s.gain_dB===undefined) s.gain_dB = 0; if (s.nf_dB===undefined) s.nf_dB = Math.abs(s.gain_dB); }
        else { if (s.gain_dB===undefined) s.gain_dB = 0; if (s.nf_dB===undefined) s.nf_dB = Math.abs(s.gain_dB); }
        if (s.op1db_dBm===undefined) s.op1db_dBm = 1000;

        newStages.push(s);
      }

      if (Array.isArray(newStages) && newStages.length) {
        window.stages = newStages;

        // restore compute range if present in YAML
        try {
          if (doc.compute) {
            if (typeof freqMinInput !== 'undefined' && freqMinInput && doc.compute.freq_min_Hz !== undefined) freqMinInput.value = Number(doc.compute.freq_min_Hz);
            if (typeof freqMaxInput !== 'undefined' && freqMaxInput && doc.compute.freq_max_Hz !== undefined) freqMaxInput.value = Number(doc.compute.freq_max_Hz);
            if (typeof freqStepInput !== 'undefined' && freqStepInput && doc.compute.freq_step_Hz !== undefined) freqStepInput.value = Number(doc.compute.freq_step_Hz);

            // restore chart ranges if present in YAML (compute.chart_ranges)
            try {
              if (doc.compute && doc.compute.chart_ranges && window.ChainUI && typeof window.ChainUI.applyChartRangesFromObject === 'function') {
                try { window.ChainUI.applyChartRangesFromObject(doc.compute.chart_ranges); }
                catch(e){ console.warn('applyChartRangesFromObject failed', e); }
              }
            } catch(e){ console.warn('restore chart_ranges failed', e); }

            // request compute with restored range
            try {
              if (window.ChainUI && typeof window.ChainUI.requestCompute === 'function') window.ChainUI.requestCompute();
              if (window.ChainUI && typeof window.ChainUI._flushPending === 'function') window.ChainUI._flushPending();
            } catch(e) { console.warn('recompute after restoring compute range failed', e); }
          }
        } catch(e){ console.warn('restore compute block failed', e); }

        // render UI (defensive)
        try {
          if (window.ChainUI && typeof window.ChainUI.renderStages === 'function') window.ChainUI.renderStages();
          else if (typeof window.renderStages === 'function') window.renderStages();
        } catch (e) { console.warn('renderStages failed', e); }

        // ask compute module to recompute and flush pending cache if exists
        try {
          if (window.ChainUI && typeof window.ChainUI.requestCompute === 'function') window.ChainUI.requestCompute();
          if (window.ChainUI && typeof window.ChainUI._flushPending === 'function') window.ChainUI._flushPending();
        } catch (e) { console.warn('requestCompute / _flushPending call failed', e); }
      } else {
        window.stages = newStages;
      }
    }

    setYamlStatus('Import YAML OK', 1200);
    return true;
  }

  function importYamlFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e){ importYamlString(e.target.result); };
    reader.onerror = function(){ setYamlStatus('Erreur lecture fichier'); };
    reader.readAsText(file,'utf-8');
  }

  /* ---------- Importer fichiers de bibliothèque (UI/backdoor) ---------- */
  async function importLibFiles(files) {
    if (!files || !files.length) return;
    const parsed = [];
    for (const f of files) {
      try {
        const txt = await readFileAsText(f);
        const pts = parseTwoColumnFlexible(txt);
        if (!pts.length) {
          throw new Error(`Aucune donnée (attendu: 2 colonnes "freq dB").`);
        }
        parsed.push({ name: f.name, type: (f.name.split('.').pop()||'txt').toLowerCase(), points: pts });
      } catch (err) {
        console.warn('Erreur import', f.name, err);
        alert(`Erreur import ${f.name}: ${err.message || err}`);
      }
    }

    if (!parsed.length) return;
    if (window.MultiLibrary && typeof window.MultiLibrary.importData === 'function') {
      try {
        const maybe = window.MultiLibrary.importData(parsed);
        if (maybe && typeof maybe.then === 'function') await maybe;
        setYamlStatus('Fichiers importés', 1200);
        try { if (typeof window.MultiLibrary._notifyChange === 'function') window.MultiLibrary._notifyChange(); } catch(e){}
        try { if (window.ChainUI && typeof window.ChainUI.renderStages === 'function') window.ChainUI.renderStages(); else if (typeof window.renderStages === 'function') window.renderStages(); } catch(e){}
        try {
          if (window.ChainUI && typeof window.ChainUI.requestCompute === 'function') window.ChainUI.requestCompute();
          if (window.ChainUI && typeof window.ChainUI._flushPending === 'function') window.ChainUI._flushPending();
        } catch(e){ console.warn('recompute after lib import failed', e); }
      } catch (e) {
        console.warn('MultiLibrary.importData failed', e);
        window.MultiIO = window.MultiIO || {}; window.MultiIO._pendingLibs = window.MultiIO._pendingLibs || [];
        window.MultiIO._pendingLibs.push(...parsed);
        setYamlStatus('Import partiel (pending)', 1400);
        try { if (typeof window.MultiLibrary._notifyChange === 'function') window.MultiLibrary._notifyChange(); } catch(e){}
        try { if (typeof window.renderStages === 'function') window.renderStages(); } catch(e){}
        try { if (window.ChainUI && typeof window.ChainUI.requestCompute === 'function') window.ChainUI.requestCompute(); } catch(e){}
      }
    } else {
      window.MultiIO = window.MultiIO || {}; window.MultiIO._pendingLibs = window.MultiIO._pendingLibs || [];
      window.MultiIO._pendingLibs.push(...parsed);
      setYamlStatus('MultiLibrary indisponible — stocké (pending)', 1600);
      try { if (typeof window.MultiLibrary._notifyChange === 'function') window.MultiLibrary._notifyChange(); } catch(e){}
      try { if (typeof window.renderStages === 'function') window.renderStages(); } catch(e){}
      try { if (window.ChainUI && typeof window.ChainUI.requestCompute === 'function') window.ChainUI.requestCompute(); } catch(e){}
    }
  }

  // helper read file
  function readFileAsText(file) {
    return new Promise((resolve,reject) => {
      const r = new FileReader();
      r.onload = (e) => resolve(String(e.target.result || ''));
      r.onerror = (e) => reject(e);
      r.readAsText(file,'utf-8');
    });
  }

  /* ---------- Example YAML ---------- */
  const exampleYamlString = `# Exemple full YAML (architecture + library)
architecture:
  - name: Input_Filter
    type: filter
    file: filter_bandpass.txt

library:
  - name: filter_bandpass.txt
    type: txt
    points: |
      80000000 -0.5
      100000000 -0.8
      150000000 -1.2
`;

  /* ---------- Wiring UI (si boutons présents) ---------- */
  if (btnImportYaml && yamlFileInput) {
    btnImportYaml.addEventListener('click', ()=> yamlFileInput.click());
    yamlFileInput.addEventListener('change', (ev) => {
      const f = ev.target.files[0]; if (f) importYamlFile(f); yamlFileInput.value = '';
    });
  }

  if (btnExportYaml) {
    btnExportYaml.addEventListener('click', ()=> {
      const text = exportFullYaml();
      downloadText('architecture_and_library_export.yaml', text, 'text/yaml;charset=utf-8');
      setYamlStatus('YAML exporté', 1200);
    });
  }

  if (btnDownloadExample) {
    btnDownloadExample.addEventListener('click', ()=> {
      downloadText('architecture_example.yaml', exampleYamlString, 'text/yaml;charset=utf-8');
      setYamlStatus('Exemple téléchargé', 1000);
    });
  }

  const libFileInput = (typeof document !== 'undefined') ? document.getElementById('libFileInput') : null;
  if (libFileInput) {
    libFileInput.addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      await importLibFiles(files);
      libFileInput.value = '';
    });
  }

  // Expose API
  window.MultiIO = Object.assign(window.MultiIO || {}, {
    exportFullYaml,
    importYamlString,
    importYamlFile,
    importLibFiles,
    _parseTwoColumnFlexible: parseTwoColumnFlexible // utile pour debug/tests
  });

  console.log('multi_io loaded (corrigé)');
})();
