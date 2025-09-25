// multi_library.js (corrigé)
// - empêche double-open du file picker
// - empêche double-import / race conditions (processing vs processed signatures)
// - parser robust pour fichiers 2-col (Hz, dB) : tab / espace / ; / , ; virgule décimale, notation scientifique
// - exportData / importData / API compatibles

(function(){
  'use strict';

  const entries = []; // {id,name,type,points:[{freq,s21_dB}],pointsCount,freqMin,freqMax}
  const processedFileSignatures = new Set(); // signature = `${name}|${size}|${lastModified}`
  const processingFileSignatures = new Set(); // signatures en cours de traitement
  const onChangeCallbacks = new Set();
  const MAX_POINTS_PER_FILE = 200000;

  // UI refs (may be null)
  const libFileInput = document.getElementById('libFileInput');
  const btnAddFiles = document.getElementById('btnAddFiles');
  const btnClearLibrary = document.getElementById('btnClearLibrary');
  const libraryTableBody = document.querySelector('#libraryTable tbody');

  function uid(prefix='lib'){ return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random()*1e6).toString(36)}`; }
  function notifyChange(){ try { onChangeCallbacks.forEach(cb=>{ try{cb(); } catch(e){ console.error(e); } }); } catch(e){} updateLibraryTable(); }

  // Simplified, robust numeric regex:
  // matches integers or decimals, optional exponent, e.g. 10000000 20.15 1.23e6 1,23e6
  const NUM_RE_GLOBAL = /[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?/g;

  // Robust parser: returns sorted, deduped points [{freq,s21_dB}]
  function parseFlexibleTwoCol(text) {
    const lines = String(text || '').split(/\r?\n/);
    const pts = [];
    for (let raw of lines) {
      let line = (raw || '').trim();
      if (!line) continue;
      if (line.startsWith('#') || line.startsWith('!') || line.startsWith('//')) continue;

      // Collect numeric tokens using the simpler number regex
      const tokens = [];
      let m;
      NUM_RE_GLOBAL.lastIndex = 0;
      while ((m = NUM_RE_GLOBAL.exec(line)) !== null) {
        let tok = m[0];
        // Remove spaces if any (thousand separators sometimes)
        tok = tok.replace(/\s+/g, '');
        // If token contains both '.' and ',' assume '.' is decimal and commas are thousands -> remove commas
        if (tok.indexOf('.') !== -1 && tok.indexOf(',') !== -1) tok = tok.replace(/,/g, '');
        // If token contains comma but no dot, treat comma as decimal separator
        else if (tok.indexOf(',') !== -1 && tok.indexOf('.') === -1) tok = tok.replace(',', '.');
        const v = Number(tok);
        if (Number.isFinite(v)) tokens.push(v);
      }

      if (tokens.length >= 2) {
        // first token = freq (Hz), second = value (dB)
        const f = Number(tokens[0]);
        const d = Number(tokens[1]);
        if (Number.isFinite(f) && Number.isFinite(d)) pts.push({ freq: f, s21_dB: d });
        // continue to next line
        if (pts.length >= MAX_POINTS_PER_FILE) break;
        continue;
      }

      // fallback: split on common delimiters and parse tokens
      const parts = line.split(/[,\t; ]+/).map(p=>p.trim()).filter(Boolean);
      const nums = [];
      for (const p of parts) {
        let t = p.replace(/\s+/g,'');
        if (t.indexOf(',') !== -1 && t.indexOf('.') === -1) t = t.replace(',', '.');
        const v = Number(t);
        if (Number.isFinite(v)) nums.push(v);
      }
      if (nums.length >= 2) {
        const f = Number(nums[0]), d = Number(nums[1]);
        if (Number.isFinite(f) && Number.isFinite(d)) pts.push({ freq: f, s21_dB: d });
      }

      if (pts.length >= MAX_POINTS_PER_FILE) break;
    }

    if (!pts.length) return [];

    // sort & dedupe by freq (keep last)
    pts.sort((a,b)=>a.freq - b.freq);
    const uniq = []; let lastF = NaN;
    for (const p of pts) {
      if (!isFinite(p.freq) || !isFinite(p.s21_dB)) continue;
      if (p.freq === lastF) uniq[uniq.length-1] = p;
      else { uniq.push(p); lastF = p.freq; }
    }
    return uniq;
  }

  function addRawEntry(name, points, type='raw') {
    const pts = (points||[]).slice(0, MAX_POINTS_PER_FILE).map(p => ({ freq: Number(p.freq), s21_dB: Number(p.s21_dB) }));
    pts.sort((a,b)=>a.freq-b.freq);
    const uniq = []; let lastF=NaN;
    for (const p of pts) {
      if (!isFinite(p.freq) || !isFinite(p.s21_dB)) continue;
      if (p.freq === lastF) uniq[uniq.length-1] = p;
      else { uniq.push(p); lastF = p.freq; }
    }
    const e = { id: uid(), name: name || `entry_${entries.length+1}`, type, points: uniq, pointsCount: uniq.length, freqMin: uniq.length?uniq[0].freq:0, freqMax: uniq.length?uniq[uniq.length-1].freq:0 };
    entries.push(e);
    notifyChange();
    console.info(`Library: ajouté '${e.name}' (${e.pointsCount} pts, ${e.freqMin}→${e.freqMax})`);
    return e;
  }

  function makeFileSignature(file) {
    if (!file) return null;
    return `${file.name}|${file.size}|${file.lastModified || 0}`;
  }

  function addFileEntry(file) {
    // returns Promise that resolves with entry or {skipped:...} or rejects on hard error
    const sig = makeFileSignature(file);
    if (sig && processedFileSignatures.has(sig)) {
      return Promise.resolve({ skipped: true, reason: 'dupe', name: file.name });
    }
    if (sig && processingFileSignatures.has(sig)) {
      return Promise.resolve({ skipped: true, reason: 'processing', name: file.name });
    }

    // mark processing early
    if (sig) processingFileSignatures.add(sig);

    return new Promise((resolve, reject) => {
      if (!file) { if (sig) processingFileSignatures.delete(sig); reject(new Error('Fichier invalide')); return; }
      const reader = new FileReader();
      reader.onload = function(ev) {
        try {
          const text = String(ev.target.result || '');
          const pts = parseFlexibleTwoCol(text);
          if (!pts.length) { throw new Error('Aucune donnée (attendu: 2 colonnes \"freq dB\").'); }
          const e = { id: uid(), name: file.name, type: (file.name.split('.').pop()||'txt').toLowerCase(), points: pts, pointsCount: pts.length, freqMin: pts[0].freq, freqMax: pts[pts.length-1].freq };
          if (sig) processedFileSignatures.add(sig);
          entries.push(e);
          notifyChange();
          console.info(`Library: importé '${file.name}' (${pts.length} pts).`);
          resolve(e);
        } catch (err) {
          reject(err);
        } finally {
          if (sig) processingFileSignatures.delete(sig);
        }
      };
      reader.onerror = (err) => {
        if (sig) processingFileSignatures.delete(sig);
        reject(err);
      };
      reader.readAsText(file,'utf-8');
    });
  }

  async function addFileEntries(files) {
    const arr = Array.from(files || []);
    const results = [];
    for (const f of arr) {
      try {
        const r = await addFileEntry(f);
        results.push(r);
      } catch (err) {
        results.push({ error: true, file: f.name, message: (err && err.message) ? err.message : String(err) });
      }
    }
    return results;
  }

  function removeEntry(id) {
    const i = entries.findIndex(x=>x.id===id);
    if (i>=0) { entries.splice(i,1); updateLibraryTable(); notifyChange(); return true; }
    return false;
  }

  function clearAll() {
    entries.length = 0;
    processedFileSignatures.clear();
    processingFileSignatures.clear();
    updateLibraryTable();
    notifyChange();
  }

  function listEntries() { return entries.map(e => ({ id: e.id, name: e.name, type: e.type, pointsCount: e.pointsCount, freqMin: e.freqMin, freqMax: e.freqMax })); }

  function findClosestPoint(points, targetFreq) {
    if (!points || points.length === 0) return null;
    let lo=0, hi=points.length-1;
    if (targetFreq <= points[0].freq) return points[0];
    if (targetFreq >= points[hi].freq) return points[hi];
    while (hi - lo > 1) {
      const mid = Math.floor((lo+hi)/2);
      if (points[mid].freq === targetFreq) return points[mid];
      if (points[mid].freq < targetFreq) lo = mid; else hi = mid;
    }
    const a = points[lo], b = points[hi];
    return (Math.abs(a.freq - targetFreq) <= Math.abs(b.freq - targetFreq)) ? a : b;
  }

  async function getClosestValue(libIdOrName, freqHz) {
    freqHz = Number(freqHz);
    if (!isFinite(freqHz)) return null;
    // find entry by id or name (case-insensitive)
    let e = entries.find(x => x.id === libIdOrName);
    if (!e) {
      const keyLower = String(libIdOrName || '').toLowerCase();
      e = entries.find(x => (x.name && x.name.toString().toLowerCase() === keyLower));
    }
    if (!e || !e.points || !e.points.length) return null;
    const p = findClosestPoint(e.points, freqHz);
    if (!p) return null;
    return { freq: p.freq, s21_dB: p.s21_dB };
  }

  function exportData() {
    // return a deep-copy with canonical numeric values
    return entries.map(e => ({ id: e.id, name: e.name, type: e.type, points: e.points.map(p=>({ freq: Number(p.freq), s21_dB: Number(p.s21_dB) })) }));
  }

  function importData(arr) {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      if (!it || !Array.isArray(it.points)) continue;
      addRawEntry(it.name||it.id||'import', it.points, it.type||'raw');
    }
  }

  // UI: update table (if present)
  function updateLibraryTable() {
    if (!libraryTableBody) return;
    libraryTableBody.innerHTML = '';
    entries.forEach((e, idx) => {
      const tr = document.createElement('tr');

      const idxTd = document.createElement('td'); idxTd.textContent = (idx+1);
      const nameTd = document.createElement('td'); nameTd.textContent = e.name;
      const typeTd = document.createElement('td'); typeTd.textContent = e.type || '';
      const ptsTd = document.createElement('td'); ptsTd.textContent = e.pointsCount;
      const rangeTd = document.createElement('td'); rangeTd.textContent = `${e.freqMin||''} → ${e.freqMax||''}`;
      const actionsTd = document.createElement('td');

      const btnView = document.createElement('button'); btnView.className='ghost'; btnView.textContent='Voir';
      btnView.addEventListener('click', ()=> {
        alert(`Nom: ${e.name}\nType: ${e.type}\nPoints: ${e.pointsCount}\nFréq: ${e.freqMin} → ${e.freqMax}\nEx: ${e.points.slice(0,8).map(p=>`${p.freq}:${p.s21_dB}`).join(', ')}`);
      });

      const btnDl = document.createElement('button'); btnDl.className='ghost'; btnDl.textContent='Téléch';
      btnDl.addEventListener('click', ()=> {
        const lines = ['freq_Hz s21_dB'];
        for (const p of e.points) lines.push(`${p.freq} ${p.s21_dB}`);
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const safeName = (e.name || 'library_entry').replace(/[^a-z0-9_.-]/gi,'_');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${safeName}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      });

      const btnDel = document.createElement('button'); btnDel.className='ghost'; btnDel.textContent='Suppr';
      btnDel.addEventListener('click', ()=> {
        if (!confirm(`Supprimer ${e.name} ?`)) return;
        removeEntry(e.id);
      });

      actionsTd.appendChild(btnView); actionsTd.appendChild(btnDl); actionsTd.appendChild(btnDel);
      tr.appendChild(idxTd); tr.appendChild(nameTd); tr.appendChild(typeTd); tr.appendChild(ptsTd); tr.appendChild(rangeTd); tr.appendChild(actionsTd);
      libraryTableBody.appendChild(tr);
    });
  }

  /* Wiring file input / drag drop with robust handling */
  if (btnAddFiles && libFileInput) {
    // prevent accidental double-open: small state flag
    btnAddFiles.addEventListener('click', () => {
      if (btnAddFiles.disabled) return;
      if (btnAddFiles._openRequested) return;
      btnAddFiles._openRequested = true;
      try { btnAddFiles.blur(); } catch (e) {}
      // ensure input cleared BEFORE opening so same file can be reselected
      try { libFileInput.value = ''; } catch(e){}
      // schedule click to next tick (safer on some browsers)
      setTimeout(()=>{
        try { libFileInput.click(); } finally { btnAddFiles._openRequested = false; }
      }, 0);
    });

    libFileInput.addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) { try { libFileInput.value = ''; } catch(e){}; return; }
      // disable button during processing
      btnAddFiles.disabled = true;
      try {
        for (const f of files) {
          const sig = makeFileSignature(f);
          if (sig && processedFileSignatures.has(sig)) {
            console.warn('Fichier déjà importé, ignoré:', f.name);
            continue;
          }
          if (sig && processingFileSignatures.has(sig)) {
            console.warn('Fichier en cours de traitement, ignoré (race):', f.name);
            continue;
          }
          try {
            await addFileEntry(f);
          } catch (err) {
            console.warn('Parse error', f.name, err);
            alert(`Erreur import ${f.name}: ${err.message||err}`);
          }
        }
      } finally {
        // clear input so same file can be reselected later
        try { libFileInput.value = ''; } catch (e) {}
        btnAddFiles.disabled = false;
      }
    });
  }

  if (btnClearLibrary) {
    btnClearLibrary.addEventListener('click', ()=> {
      if (!confirm('Vider la bibliothèque ?')) return;
      clearAll();
    });
  }

  (function addDrawerDrop() {
    const drawer = document.getElementById('librarySection') || document.getElementById('libraryDrawer');
    if (!drawer) return;
    drawer.addEventListener('dragover', ev => { ev.preventDefault(); drawer.classList.add('drag-over'); });
    drawer.addEventListener('dragleave', ev => { drawer.classList.remove('drag-over'); });
    drawer.addEventListener('drop', async (ev) => {
      ev.preventDefault(); drawer.classList.remove('drag-over');
      const files = Array.from(ev.dataTransfer.files || []); if (!files.length) return;
      // process sequentially
      for (const f of files) {
        try { await addFileEntry(f); } catch (err) { console.warn(err); alert(`Erreur import ${f.name}: ${err.message}`); }
      }
    });
  })();

  // initial table render
  updateLibraryTable();

  // Expose API
  // Expose API
  window.MultiLibrary = {
    listEntries: () => listEntries(),
    getClosestValue: (libId, freqHz) => getClosestValue(libId, freqHz),
    onChange: (cb) => { if (typeof cb === 'function') { onChangeCallbacks.add(cb); return () => onChangeCallbacks.delete(cb); } return () => {}; },
    exportData: () => exportData(),
    importData: (arr) => importData(arr),
    addFileEntries: (files) => addFileEntries(files),
    addFileEntry: (file) => addFileEntry(file),
    addRawEntry: (name, points, type) => addRawEntry(name, points, type),
    remove: (id) => removeEntry(id),
    clear: () => clearAll(),
    _entriesInternal: () => entries,
    // <-- méthode exposée permettant de forcer la notification externe (utilisée par MultiIO fallback)
    _notifyChange: () => { try { notifyChange(); } catch(e){ console.warn('notifyChange fallback failed', e); } }
  };


  console.log('MultiLibrary (stable importer) initialised (corrigé).');
})();
