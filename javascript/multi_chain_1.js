// multi_chain_1.js — UI / rendu / interactions pour Multi-Chain
// Affichage différent selon le type d'étage (LNA / filtre / atten / switch / mixer / custom)
// Dépendances : Chart.js (optionnel), window.MultiLibrary (optionnel), window.ChainCompute (compute module)

(function(){
  'use strict';

  /* ---------- i18n simplifié ---------- */
  const I18N = {
    fr: {
      types: {ampli:'LNA', filter:'Filtre', atten:'Atténuateur', switch:'Switch', mixer:'Mixer', custom:'Custom'},
      label_gain_field: 'Gain (dB) :',
      label_nf_field: 'NF (dB) :',
      label_insertion_field: 'Insertion loss (dB) :',
      label_p1: 'OP1dB (dBm) :',
      default_chain_prefix: {filter:'Filtre', lna:'LNA', mixer:'Mixer'},
      confirm_reset: 'Réinitialiser tout ?',
      help_filter_desc: 'renseigner Perte d’insertion (dB) et OP1dB. (NF = Perte d’insertion)',
      help_lna_desc: 'renseigner Gain (dB), NF (dB), OP1dB.',
      help_att_desc: 'renseigner Atténuation (dB) et OP1dB ; NF = Atténuation.',
      help_mixer_desc: 'renseigner Perte de conversion (dB), NF (dB), OP1dB.'
    }
  };
  let currentLang = 'fr';
  function t(key){ const parts = key.split('.'); let v = I18N[currentLang]; for (const p of parts){ if (v && v[p] !== undefined) v = v[p]; else return key; } return v; }

  /* ---------- util helpers ---------- */
  function safeGet(id){ try { return document.getElementById(id); } catch(e){ return null; } }
  function clampNum(v,d=0){ const n=Number(v); return Number.isFinite(n)?n:d; }
  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function formatFreqLabel(f){
    if (!isFinite(f)) return '';
    if (f >= 1e6) return (f/1e6).toFixed(2)+' MHz';
    if (f >= 1e3) return (f/1e3).toFixed(1)+' kHz';
    return f+' Hz';
  }

  /* ---------- DOM refs ---------- */
  const stagesContainer = safeGet('stagesContainer');
  const tableBody = document.querySelector('#tableStages tbody');

  const gainEl = safeGet('gainTotal');
  const nfEl = safeGet('nfTotal');
  const opOutEl = safeGet('op1dB_out');
  const ipInEl = safeGet('ip1dB_in');

  const btnAddStage = safeGet('btnAddStage');
  const btnRemoveStage = safeGet('btnRemoveStage');
  const nStagesInput = safeGet('nStagesInput');
  const btnReset = safeGet('btnReset');

  const freqMinInput = safeGet('freqMinInput');
  const freqMaxInput = safeGet('freqMaxInput');
  const freqStepInput = safeGet('freqStepInput');
  const btnComputeRange = safeGet('btnComputeRange');
  const btnExportCsv = safeGet('btnExportCsv');

  const btnManageLibrary = safeGet('btnManageLibrary');
  const btnAddFiles = safeGet('btnAddFiles');

  const activeRangeEl = safeGet('activeRange');

  const gainPlotMin = safeGet('gainPlotMin');
  const gainPlotMax = safeGet('gainPlotMax');
  const nfPlotMin = safeGet('nfPlotMin');
  const nfPlotMax = safeGet('nfPlotMax');
  const opPlotMin = safeGet('opPlotMin');
  const opPlotMax = safeGet('opPlotMax');
  const ipPlotMin = safeGet('ipPlotMin');
  const ipPlotMax = safeGet('ipPlotMax');

  const chartGainEl = safeGet('chartGain');
  const chartNFEl = safeGet('chartNF');
  const chartOP1El = safeGet('chartOP1');
  const chartIP1El = safeGet('chartIP1');

  /* ---------- state ---------- */
  window.stages = window.stages || [];
  const charts = { gain:null, nf:null, op1:null, ip1:null };
  let lastComputed = { freqs:[], gain:[], nf:[], op1:[], ip1:[] };

  window.ChainUI = window.ChainUI || {};
  window.ChainUI._pendingRequest = null;
  window.ChainUI.charts = charts;
  window.ChainUI.lastComputed = lastComputed;
  // chartRanges stores per-chart ymin/ymax (null = autoscale)
  window.ChainUI.chartRanges = window.ChainUI.chartRanges || { gain:{ymin:null,ymax:null}, nf:{ymin:null,ymax:null}, op1:{ymin:null,ymax:null}, ip1:{ymin:null,ymax:null} };

  /* ---------- Library API wrapper ---------- */
  const LibraryAPI = {
    list: () => {
      try {
        return (window.MultiLibrary && typeof window.MultiLibrary.listEntries === 'function') ? window.MultiLibrary.listEntries() : (window.MultiLibrary && typeof window.MultiLibrary._entriesInternal === 'function' ? window.MultiLibrary._entriesInternal() : []);
      } catch(e){ return []; }
    },
    getClosest: async (libId, freqHz) => {
      try { if (window.MultiLibrary && typeof window.MultiLibrary.getClosestValue === 'function') return await window.MultiLibrary.getClosestValue(libId, freqHz); } catch(e){ console.warn(e); }
      return null;
    },
    onChange: (cb) => { try { if (window.MultiLibrary && typeof window.MultiLibrary.onChange === 'function') return window.MultiLibrary.onChange(cb); } catch(e){} return () => {}; }
  };

  /* ---------- Charts init (simple) ---------- */
  function getCssVar(name, fallback){ try { const v = getComputedStyle(document.documentElement).getPropertyValue(name); return v?v.trim():fallback; } catch(e){ return fallback; } }
  function createCharts(){
    if (!window.Chart) return;
    const gridColor = getCssVar('--chart-grid','rgba(255,255,255,0.04)');
    const axisColor = getCssVar('--chart-axis','rgba(255,255,255,0.65)');

    const commonOpts = {
      maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ title:{ display:true, text:'Fréquence' }, ticks:{ maxRotation:0 }, grid:{ color:gridColor } },
        y:{ grid:{ color:gridColor }, ticks:{ color:axisColor } }
      }
    };

    function mk(el, label, ytitle){
      if (!el) return null;
      try {
        return new Chart(el.getContext('2d'), {
          type:'line',
          data:{ labels:[], datasets:[{ label, data:[], tension:0.25, pointRadius:0 }]},
          options: Object.assign({}, commonOpts, { scales: { x: commonOpts.scales.x, y: Object.assign({}, commonOpts.scales.y, { title:{ display:true, text: ytitle } }) } })
        });
      } catch(e){ console.warn('Chart create failed', e); return null; }
    }

    charts.gain = mk(chartGainEl, 'Gain (dB)', 'Gain (dB)');
    charts.nf   = mk(chartNFEl, 'NF (dB)', 'NF (dB)');
    charts.op1  = mk(chartOP1El, 'OP1dB out (dBm)', 'OP1dB (dBm)');
    charts.ip1  = mk(chartIP1El, 'IP1dB in (dBm)', 'IP1dB (dBm)');
  }
  function updateChartDataset(chart, labels, data){
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = (data||[]).map(v => isFinite(v) ? +v.toFixed(4) : null);
    try { chart.update(); } catch(e) { try { chart.update('none'); } catch(_){} }
  }

  /* ---------- Stage defaults / initial chain (compatible compute module) ---------- */
  function defaultStage(i){
    return {
      name: `${t('default_chain_prefix.filter')} ${i+1}` ,
      type: 'ampli',
      gain_dB: 15,
      nf_dB: 3,
      insertion_loss_dB: 1,
      op1db_dBm: 23,
      sources: { gain:{type:'manual'}, insertion:{type:'manual'}, nf:{type:'manual'}, op1:{type:'manual'} }
    };
  }

  function initialChain(){
    return [
      { name: t('default_chain_prefix.filter') + ' 1', type:'filter', gain_dB:0, nf_dB:1, insertion_loss_dB:1.0, op1db_dBm: 35, sources:{ insertion:{type:'manual'}, op1:{type:'manual'} } },
      { name: t('default_chain_prefix.lna') + ' 1', type:'ampli', gain_dB:20, nf_dB:1.0, insertion_loss_dB:0, op1db_dBm: 18, sources:{ gain:{type:'manual'}, nf:{type:'manual'}, op1:{type:'manual'} } },
      { name: t('default_chain_prefix.filter') + ' 2', type:'filter', gain_dB:0, nf_dB:0.8, insertion_loss_dB:0.8, op1db_dBm: 38, sources:{ insertion:{type:'manual'}, op1:{type:'manual'} } },
      { name: t('default_chain_prefix.mixer') + ' 1', type:'mixer', gain_dB:-6, nf_dB:6.0, insertion_loss_dB:6.0, op1db_dBm: 10, sources:{ insertion:{type:'manual'}, nf:{type:'manual'}, op1:{type:'manual'} } },
      { name: t('default_chain_prefix.filter') + ' 3', type:'filter', gain_dB:0, nf_dB:1.0, insertion_loss_dB:1.0, op1db_dBm: 40, sources:{ insertion:{type:'manual'}, op1:{type:'manual'} } }
    ];
  }

  /* ---------- populate library select ---------- */
  function populateLibSelect(sel, selectedId){
    if (!sel) return;
    sel.innerHTML = '';
    const empty = document.createElement('option'); empty.value=''; empty.textContent='(aucune)';
    sel.appendChild(empty);
    try {
      const libs = LibraryAPI.list() || [];
      libs.forEach(l=>{
        const o = document.createElement('option'); o.value = l.id; o.textContent = `${l.name} (${l.pointsCount||'pts'})`;
        sel.appendChild(o);
      });
      if (selectedId) sel.value = selectedId;
    } catch(e){}
  }

  /* ---------- Make stage card with per-type fields ---------- */
  function makeStageCard(idx, data){
    const L = I18N[currentLang];
    const root = document.createElement('div');
    root.className = 'stage-card';
    root.dataset.index = idx;
    root.dataset.type = data.type || 'custom';
    root.setAttribute('draggable','false');

    // header
    root.innerHTML = `
      <div class="stage-header">
        <div class="stage-name">
          <span class="stage-index">#${idx+1}</span>
          <input type="text" class="s_name" />
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="drag-handle" title="Glisser"><div class="bars" aria-hidden="true"><span></span><span></span><span></span></div></div>
          <select class="s_type">
            <option value="custom">Custom</option>
            <option value="ampli">LNA</option>
            <option value="filter">Filtre</option>
            <option value="atten">Atténuateur</option>
            <option value="switch">Switch</option>
            <option value="mixer">Mixer</option>
          </select>
          <button class="remove">Suppr</button>
        </div>
      </div>
      <div class="stage-controls compact-grid"></div>
    `;

    const nameInput = root.querySelector('.s_name');
    const typeSel = root.querySelector('.s_type');
    const controls = root.querySelector('.stage-controls');

    nameInput.value = data.name || `Stage ${idx+1}`;
    typeSel.value = data.type || 'custom';

    // ensure sources object exists
    data.sources = data.sources || { gain:{type:'manual'}, insertion:{type:'manual'}, nf:{type:'manual'}, op1:{type:'manual'} };

    // build a row: label | input | lib select
    function createRow(labelText, inputClass, inputValue, srcObj) {
      const label = document.createElement('div'); label.className = 'field-label'; label.textContent = labelText;
      const inputWrap = document.createElement('div'); inputWrap.className = 'field-input';
      const input = document.createElement('input'); input.type = (inputClass==='s_p1') ? 'number' : 'number'; input.className = inputClass;
      input.step = (inputClass==='s_p1') ? '0.01' : '0.1';
      if (inputValue !== undefined && inputValue !== null && inputValue !== '') input.value = inputValue;
      inputWrap.appendChild(input);

      const libWrap = document.createElement('div'); libWrap.className = 'field-lib';
      const libSel = document.createElement('select'); libSel.className = 'lib_select';
      populateLibSelect(libSel, srcObj && srcObj.libId);
      libWrap.appendChild(libSel);

      return { label, inputWrap, libWrap, input, libSel };
    }

    // decide which rows to render based on type
    function renderRowsForType(tp) {
      controls.innerHTML = '';
      // insertion row (used by filter/atten/mixer)
      const insertionLabel = (tp === 'mixer') ? 'Conversion loss (dB) :' : (tp === 'atten' ? 'Atténuation (dB) :' : 'Insertion / Atténuation (dB) :');
      const insRow = createRow(insertionLabel, 's_insertion', (data.insertion_loss_dB !== undefined) ? data.insertion_loss_dB : 0, data.sources.insertion);
      // for ampli we hide insertion row below; for others show
      // gain row
      const gainRow = createRow(t('label_gain_field'), 's_gain', (data.gain_dB !== undefined) ? data.gain_dB : 0, data.sources.gain);
      // nf row
      const nfRow = createRow(t('label_nf_field'), 's_nf', (data.nf_dB !== undefined) ? data.nf_dB : '', data.sources.nf);
      // p1 row
      const p1Row = createRow(t('label_p1'), 's_p1', (data.op1db_dBm !== undefined) ? data.op1db_dBm : 1000, data.sources.op1);

      // Layout decisions:
      // For filter/switch: show insertion + p1 (nf hidden; NF defaults to insertion)
      if (tp === 'filter' || tp === 'switch') {
        controls.appendChild(insRow.label); controls.appendChild(insRow.inputWrap); controls.appendChild(insRow.libWrap);
        controls.appendChild(p1Row.label); controls.appendChild(p1Row.inputWrap); controls.appendChild(p1Row.libWrap);
      }
      // For atten: show insertion (atténuation positive) + p1
      else if (tp === 'atten') {
        controls.appendChild(insRow.label); controls.appendChild(insRow.inputWrap); controls.appendChild(insRow.libWrap);
        controls.appendChild(p1Row.label); controls.appendChild(p1Row.inputWrap); controls.appendChild(p1Row.libWrap);
      }
      // For mixer: show insertion (conversion loss), nf, p1
      else if (tp === 'mixer') {
        controls.appendChild(insRow.label); controls.appendChild(insRow.inputWrap); controls.appendChild(insRow.libWrap);
        controls.appendChild(nfRow.label); controls.appendChild(nfRow.inputWrap); controls.appendChild(nfRow.libWrap);
        controls.appendChild(p1Row.label); controls.appendChild(p1Row.inputWrap); controls.appendChild(p1Row.libWrap);
      }
      // For ampli: show gain, nf, p1
      else if (tp === 'ampli') {
        controls.appendChild(gainRow.label); controls.appendChild(gainRow.inputWrap); controls.appendChild(gainRow.libWrap);
        controls.appendChild(nfRow.label); controls.appendChild(nfRow.inputWrap); controls.appendChild(nfRow.libWrap);
        controls.appendChild(p1Row.label); controls.appendChild(p1Row.inputWrap); controls.appendChild(p1Row.libWrap);
      }
      // custom: show all four rows (gain, nf, insertion, p1)
      else {
        controls.appendChild(gainRow.label); controls.appendChild(gainRow.inputWrap); controls.appendChild(gainRow.libWrap);
        controls.appendChild(nfRow.label); controls.appendChild(nfRow.inputWrap); controls.appendChild(nfRow.libWrap);
        controls.appendChild(insRow.label); controls.appendChild(insRow.inputWrap); controls.appendChild(insRow.libWrap);
        controls.appendChild(p1Row.label); controls.appendChild(p1Row.inputWrap); controls.appendChild(p1Row.libWrap);
      }

      // return references to inputs/selects for wiring
      return {
        gainInput: gainRow.input, gainLib: gainRow.libSel,
        insInput: insRow.input, insLib: insRow.libSel,
        nfInput: nfRow.input, nfLib: nfRow.libSel,
        p1Input: p1Row.input, p1Lib: p1Row.libSel
      };
    }

    // initial render rows
    let refs = renderRowsForType(typeSel.value);

    // refresh library options when global library changes
    LibraryAPI.onChange(()=> {
      controls.querySelectorAll('.lib_select').forEach(sel=>{
        const prev = sel.value;
        populateLibSelect(sel, prev);
      });
    });

    // drag handle behaviour
    const handle = root.querySelector('.drag-handle');
    handle.addEventListener('pointerdown', ()=> root.setAttribute('draggable','true'));
    handle.addEventListener('pointerup', ()=> root.setAttribute('draggable','false'));

    root.addEventListener('dragstart', (ev)=> {
      try { ev.dataTransfer.setData('text/plain', String(Number(root.dataset.index))); ev.dataTransfer.effectAllowed='move'; } catch(e) {}
      root.classList.add('dragging');
    });
    root.addEventListener('dragend', ()=> {
      root.setAttribute('draggable','false'); root.classList.remove('dragging');
      const marker = stagesContainer.querySelector('.insert-marker'); if (marker) marker.remove();
    });

    // remove button
    root.querySelector('.remove').addEventListener('click', ()=> {
      const i = Number(root.dataset.index); if (!Number.isFinite(i)) return;
      window.stages.splice(i,1);
      renderStages(); requestCompute();
    });

    // update visible rows when type changes
    typeSel.addEventListener('change', ()=> {
      const newType = typeSel.value;
      root.dataset.type = newType;
      data.type = newType;
      refs = renderRowsForType(newType); // recreate rows & refs
      writeBack(); // write back to stages
      renderSummaryTable();
      requestCompute();
    });

    // initialise displayed numeric values with sane defaults depending on imported data
    function initDisplayedValues() {
      // for atten: insertion should be positive (abs), keep gain_dB_max if present
      if (data.type === 'atten') {
        const activeGain = (data.gain_dB_max !== undefined) ? data.gain_dB_max : data.gain_dB;
        refs.insInput.value = Math.abs(activeGain || data.insertion_loss_dB || 0);
        refs.gainInput.value = (data.gain_dB !== undefined) ? data.gain_dB : 0;
        refs.nfInput.value = (data.nf_dB !== undefined) ? data.nf_dB : Math.abs(activeGain || refs.insInput.value || 0);
      } else if (data.type === 'mixer') {
        refs.insInput.value = Math.abs(data.gain_dB !== undefined ? data.gain_dB : data.insertion_loss_dB || 0);
        refs.gainInput.value = (data.gain_dB !== undefined) ? data.gain_dB : 0;
        refs.nfInput.value = (data.nf_dB !== undefined) ? data.nf_dB : Math.abs(refs.gainInput.value || refs.insInput.value || 0);
      } else if (data.type === 'filter' || data.type === 'switch') {
        refs.insInput.value = data.insertion_loss_dB !== undefined ? data.insertion_loss_dB : 0;
        refs.gainInput.value = data.gain_dB !== undefined ? data.gain_dB : 0;
        refs.nfInput.value = data.nf_dB !== undefined ? data.nf_dB : refs.insInput.value;
      } else { // ampli / custom
        refs.gainInput.value = data.gain_dB !== undefined ? data.gain_dB : 0;
        refs.insInput.value = data.insertion_loss_dB !== undefined ? data.insertion_loss_dB : 0;
        refs.nfInput.value = data.nf_dB !== undefined ? data.nf_dB : Math.abs(refs.gainInput.value || 0);
      }
      refs.p1Input.value = data.op1db_dBm !== undefined ? data.op1db_dBm : 1000;
      // populate library selects based on data.sources if present
      if (data.sources) {
        if (refs.gainLib) refs.gainLib.value = (data.sources.gain && data.sources.gain.libId) ? data.sources.gain.libId : '';
        if (refs.insLib) refs.insLib.value = (data.sources.insertion && data.sources.insertion.libId) ? data.sources.insertion.libId : '';
        if (refs.nfLib) refs.nfLib.value = (data.sources.nf && data.sources.nf.libId) ? data.sources.nf.libId : '';
        if (refs.p1Lib) refs.p1Lib.value = (data.sources.op1 && data.sources.op1.libId) ? data.sources.op1.libId : '';
      }
      // enable/disable input if lib selected
      if (refs.gainLib) refs.gainInput.disabled = refs.gainLib.value ? true : false;
      if (refs.insLib) refs.insInput.disabled = refs.insLib.value ? true : false;
      if (refs.nfLib) refs.nfInput.disabled = refs.nfLib.value ? true : false;
      if (refs.p1Lib) refs.p1Input.disabled = refs.p1Lib.value ? true : false;
    }
    initDisplayedValues();

    // write back values from inputs/selects to window.stages
    function writeBack(){
      const i = Number(root.dataset.index); if (!Number.isFinite(i)) return;
      const s = window.stages[i];
      if (!s) return;
      s.name = nameInput.value || `Stage ${i+1}`;
      s.type = typeSel.value || 'custom';

      // read from current refs (may have been re-created)
      const gainVal = refs.gainInput ? refs.gainInput.value : '';
      const insVal = refs.insInput ? refs.insInput.value : '';
      const nfVal = refs.nfInput ? refs.nfInput.value : '';
      const p1Val = refs.p1Input ? refs.p1Input.value : '';

      // sources from lib selects
      s.sources = s.sources || {};
      if (refs.gainLib) s.sources.gain = refs.gainLib.value ? { type:'library', libId: refs.gainLib.value } : { type:'manual' };
      if (refs.insLib)  s.sources.insertion = refs.insLib.value ? { type:'library', libId: refs.insLib.value } : { type:'manual' };
      if (refs.nfLib)   s.sources.nf = refs.nfLib.value ? { type:'library', libId: refs.nfLib.value } : { type:'manual' };
      if (refs.p1Lib)   s.sources.op1 = refs.p1Lib.value ? { type:'library', libId: refs.p1Lib.value } : { type:'manual' };

      // per type mapping
      if (s.type === 'filter' || s.type === 'switch') {
        s.insertion_loss_dB = insVal !== '' ? parseFloat(insVal) : 0;
        s.gain_dB = -Math.abs(s.insertion_loss_dB || 0);
        s.nf_dB = (nfVal !== '') ? parseFloat(nfVal) : s.insertion_loss_dB;
      } else if (s.type === 'atten') {
        const att = insVal !== '' ? Math.abs(parseFloat(insVal)) : 0;
        s.insertion_loss_dB = att;
        s.gain_dB_max = -att;
        if (s.gain_dB === undefined || s.gain_dB === 0) s.gain_dB = -att;
        s.nf_dB = (nfVal !== '') ? parseFloat(nfVal) : Math.abs(att);
      } else if (s.type === 'mixer') {
        const conv = insVal !== '' ? Math.abs(parseFloat(insVal)) : (s.insertion_loss_dB || Math.abs(s.gain_dB || 0));
        s.insertion_loss_dB = conv;
        s.gain_dB = -conv;
        s.nf_dB = (nfVal !== '') ? parseFloat(nfVal) : Math.abs(s.gain_dB || conv);
      } else { // ampli / custom
        s.gain_dB = gainVal !== '' ? parseFloat(gainVal) : (s.gain_dB || 0);
        s.insertion_loss_dB = insVal !== '' ? parseFloat(insVal) : (s.insertion_loss_dB || 0);
        s.nf_dB = (nfVal !== '') ? parseFloat(nfVal) : (s.nf_dB !== undefined ? s.nf_dB : Math.abs(s.gain_dB || 0));
      }
      s.op1db_dBm = p1Val !== '' ? parseFloat(p1Val) : (s.op1db_dBm !== undefined ? s.op1db_dBm : 1000);

      // summary
      renderSummaryTable();
    }

    // wiring: listen input and lib select changes
    function attachInputHandlers(){
      // generic input listener
      root.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', (ev) => {
          // if lib select changed -> enable/disable corresponding input
          controls.querySelectorAll('.lib_select').forEach((sel, idx) => {
            const inputSibling = sel.closest('.field-lib')?.previousElementSibling?.querySelector('input') || controls.querySelectorAll('input')[idx];
            if (inputSibling) inputSibling.disabled = !!sel.value;
          });

          // re-evaluate refs since rows may be re-rendered on type change
          refs = {
            gainInput: controls.querySelector('.s_gain'),
            gainLib: controls.querySelectorAll('.lib_select')[0] || null,
            insInput: controls.querySelector('.s_insertion'),
            insLib: controls.querySelectorAll('.lib_select')[ (typeSel.value==='filter' || typeSel.value==='switch') ? 0 : 0 ] || null,
            nfInput: controls.querySelector('.s_nf'),
            nfLib: controls.querySelectorAll('.lib_select')[ (typeSel.value==='ampli') ? 1 : 1 ] || null,
            p1Input: controls.querySelector('.s_p1'),
            p1Lib: controls.querySelectorAll('.lib_select')[ (controls.querySelectorAll('.lib_select').length-1) ] || null
          };
          writeBack();
          // immediate compute
          requestCompute();
        });
      });
    }
    attachInputHandlers();

    // ensure lib-list update when MultiLibrary changes
    LibraryAPI.onChange(()=> {
      controls.querySelectorAll('.lib_select').forEach(sel=>{
        const prev = sel.value;
        populateLibSelect(sel, prev);
      });
    });

    return root;
  }

  /* ---------- Render / Summary ---------- */
  function renderStages(){
    if (!stagesContainer) return;
    stagesContainer.innerHTML = '';
    window.stages.forEach((s, idx) => {
      const c = makeStageCard(idx, s);
      stagesContainer.appendChild(c);
    });
    if (nStagesInput) nStagesInput.value = window.stages.length;
    attachContainerDnD();
    renderSummaryTable();
  }

  function renderSummaryTable(){
    if (!tableBody) return;
    tableBody.innerHTML = '';
    window.stages.forEach((s, idx)=>{
      let gainShown = 0, nfShown = 0;
      if (s.type === 'filter' || s.type === 'switch') {
        gainShown = -(s.insertion_loss_dB || 0);
        nfShown = (s.nf_dB !== undefined) ? s.nf_dB : (s.insertion_loss_dB || 0);
      } else if (s.type === 'atten') {
        gainShown = (s.gain_dB_max !== undefined) ? Number(s.gain_dB_max) : Number(s.gain_dB || 0);
        nfShown = Math.abs(gainShown);
      } else if (s.type === 'mixer') {
        gainShown = Number(s.gain_dB || 0);
        nfShown = Number(s.nf_dB || Math.abs(gainShown));
      } else {
        gainShown = Number(s.gain_dB || 0);
        nfShown = Number(s.nf_dB !== undefined ? s.nf_dB : Math.abs(gainShown));
      }

      const srcParts = [];
      if (s.sources) {
        ['gain','insertion','nf','op1'].forEach(k => { if (s.sources[k] && s.sources[k].type === 'library' && s.sources[k].libId) srcParts.push(k+':lib'); });
      }
      const sourceText = srcParts.length ? srcParts.join(',') : 'Manuel';

      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${idx+1}</td><td style="text-align:left">${escapeHtml(s.name)} (${escapeHtml(I18N[currentLang].types[s.type]||s.type)})</td><td>${isFinite(gainShown)?gainShown.toFixed(2):'—'}</td><td>${isFinite(nfShown)?nfShown.toFixed(2):'—'}</td><td>${escapeHtml(sourceText)}</td><td>${(s.op1db_dBm||0).toFixed(2)}</td>`;
      tableBody.appendChild(tr);
    });
  }

  /* ---------- Drag & drop container reorder ---------- */
  function attachContainerDnD(){
    if (!stagesContainer || stagesContainer._dndAttached) return;
    const marker = document.createElement('div');
    marker.className = 'insert-marker';
    marker.style.display = 'none';
    stagesContainer.appendChild(marker);
    stagesContainer._insertMarker = marker;

    stagesContainer.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      const children = Array.from(stagesContainer.querySelectorAll('.stage-card'));
      if (children.length === 0) { marker.style.display='block'; stagesContainer.appendChild(marker); return; }
      const y = ev.clientY; let insertAt = children.length;
      for (let i=0;i<children.length;i++){
        const r = children[i].getBoundingClientRect();
        if (y < r.top + r.height/2) { insertAt = i; break; }
      }
      if (insertAt >= children.length) stagesContainer.appendChild(marker); else stagesContainer.insertBefore(marker, children[insertAt]);
      marker.style.display = 'block';
    });

    stagesContainer.addEventListener('dragleave', (ev) => {
      const rect = stagesContainer.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) marker.style.display = 'none';
    });

    stagesContainer.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const srcIdx = parseInt(ev.dataTransfer.getData('text/plain'),10);
      if (!Number.isFinite(srcIdx)) { marker.style.display='none'; return; }
      const children = Array.from(stagesContainer.querySelectorAll('.stage-card'));
      let destIdx = children.length;
      const y = ev.clientY;
      for (let i=0;i<children.length;i++){ const r = children[i].getBoundingClientRect(); if (y < r.top + r.height/2) { destIdx = i; break; } }
      const moved = window.stages.splice(srcIdx,1)[0];
      let realDest = destIdx;
      if (srcIdx < destIdx) realDest = destIdx - 1;
      if (realDest < 0) realDest = 0;
      window.stages.splice(realDest,0,moved);
      marker.style.display='none'; marker.remove();
      renderStages(); requestCompute();
    });

    stagesContainer._dndAttached = true;
  }

  /* ---------- Compute integration: delegate to window.ChainCompute (multi_chain_2.js) ---------- */
  function generateFreqArray(minHz, maxHz, stepHz){
    const out = [];
    if (!isFinite(minHz) || !isFinite(maxHz) || !isFinite(stepHz) || stepHz <= 0 || maxHz <= minHz) return out;
    const maxPoints = 2000;
    const approxN = Math.floor((maxHz - minHz)/stepHz) + 1;
    if (approxN > maxPoints) stepHz = Math.ceil((maxHz - minHz)/maxPoints);
    for (let f = minHz; f <= maxHz + 1e-9; f += stepHz) { out.push(+f); if (out.length > maxPoints) break; }
    return out;
  }

  function requestCompute(){
    const fmin = Number(freqMinInput?.value) || 0;
    const fmax = Number(freqMaxInput?.value) || 0;
    const fstep = Number(freqStepInput?.value) || 0;
    let freqs = [];
    if (fmax > fmin && fstep > 0) freqs = generateFreqArray(fmin,fmax,fstep);
    else freqs = [1e9];

    if (window.ChainCompute && typeof window.ChainCompute.computeRange === 'function') {
      try {
        window.ChainCompute.computeRange(freqs);
        window.ChainUI._pendingRequest = null;
      } catch(e){
        console.warn('computeRange call failed', e);
        window.ChainUI._pendingRequest = freqs;
      }
    } else {
      window.ChainUI._pendingRequest = freqs;
      // ChainCompute will flush pending when ready
    }
  }

  function _flushPending(){
    if (window.ChainUI._pendingRequest && window.ChainCompute && typeof window.ChainCompute.computeRange === 'function') {
      try { window.ChainCompute.computeRange(window.ChainUI._pendingRequest); } catch (e) { console.warn('flush pending compute failed', e); }
      window.ChainUI._pendingRequest = null;
    }
  }

  /* ---------- Per-chart controls (Ymin / Ymax) ---------- */
  // createPerChartScaleControls creates inputs above each chart once
  /* ---------- Per-chart controls (Ymin / Ymax) ----------
     Remplacer l'ancienne createPerChartScaleControls() par celle-ci.
     - plus de boutons OK/Auto
     - mise à jour live (debounced) des chartes
  */
  function createPerChartScaleControls(){
    // mapping key -> canvas id and label
    const MAP = {
      gain: { canvasId:'chartGain', label:'Gain' },
      nf:   { canvasId:'chartNF',   label:'NF' },
      op1:  { canvasId:'chartOP1',  label:'OP1' },
      ip1:  { canvasId:'chartIP1',  label:'IP1' }
    };

    // helper to parse input -> null or number
    function parseOrNull(v){
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      if (s === '' || s.toLowerCase() === 'auto') return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }

    // ensure ChainUI state exists
    if (!window.ChainUI) window.ChainUI = {};
    if (!window.ChainUI.chartRanges) window.ChainUI.chartRanges = { gain:{ymin:null,ymax:null}, nf:{ymin:null,ymax:null}, op1:{ymin:null,ymax:null}, ip1:{ymin:null,ymax:null} };

// Remplacer la fonction setYAxisRangeForChart par ceci (multi_chain_1.js)
function findYScaleId(chart){
  try {
    if (chart && chart.scales) {
      const ids = Object.keys(chart.scales);
      // prefer an id containing 'y'
      for (const id of ids) if (String(id).toLowerCase().includes('y')) return id;
      if (ids.length) return ids[0];
    }
  } catch(e){}
  return 'y';
}

function setYAxisRangeForChart(key, ymin, ymax){
  const ch = charts[key];
  // persist runtime values for export / UI state
  window.ChainUI.chartRanges[key] = {
    ymin: (Number.isFinite(Number(ymin)) ? Number(ymin) : null),
    ymax: (Number.isFinite(Number(ymax)) ? Number(ymax) : null)
  };

  if (!ch) return;

  const yId = findYScaleId(ch);

  // helper : get finite numeric values from all datasets for this chart
  function getDataMinMax(chart){
    const vals = [];
    try {
      if (chart && Array.isArray(chart.data && chart.data.datasets)) {
        chart.data.datasets.forEach(ds => {
          if (!ds || !Array.isArray(ds.data)) return;
          ds.data.forEach(v => {
            const n = Number(v);
            if (Number.isFinite(n)) vals.push(n);
          });
        });
      }
    } catch(e){}
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }

  try {
    // prefer writing to instantiated scale options when available
    let sopts = (ch.scales && ch.scales[yId] && ch.scales[yId].options) ? ch.scales[yId].options : null;
    if (!sopts) {
      // ensure chart.options.scales[yId] exists and use it as fallback
      if (!ch.options) ch.options = {};
      if (!ch.options.scales) ch.options.scales = {};
      ch.options.scales[yId] = ch.options.scales[yId] || {};
      sopts = ch.options.scales[yId];
    }

    // CASE A: both bounds null -> autoscale from data
    if ((ymin === null || ymin === undefined || !Number.isFinite(Number(ymin))) &&
        (ymax === null || ymax === undefined || !Number.isFinite(Number(ymax)))) {

      const dm = getDataMinMax(ch);
      if (dm) {
        let minV = dm.min, maxV = dm.max;
        // if single-value dataset, add small padding
        if (minV === maxV) {
          const pad = (Math.abs(minV) > 1e-6) ? Math.abs(minV) * 0.05 : 1;
          minV = minV - pad;
          maxV = maxV + pad;
        } else {
          // add small 2% padding for nicer framing
          const pad = Math.max(Math.abs(maxV - minV) * 0.02, 1e-6);
          minV = minV - pad;
          maxV = maxV + pad;
        }
        // Apply computed bounds (but keep persisted state as null to signal 'auto')
        sopts.min = minV;
        sopts.max = maxV;
      } else {
        // no numeric data -> remove constraints; let Chart.js fallback
        if ('min' in sopts) delete sopts.min;
        if ('max' in sopts) delete sopts.max;
      }

      // apply update immediately
      try { ch.update(); } catch(e){ try { ch.update('none'); } catch(_){} }
      return;
    }

    // CASE B: partial autoscale (one bound empty)
    if ((ymin === null || ymin === undefined || !Number.isFinite(Number(ymin))) ||
        (ymax === null || ymax === undefined || !Number.isFinite(Number(ymax)))) {

      // compute the missing bound from data
      const dm = getDataMinMax(ch);
      let computedMin = null, computedMax = null;
      if (dm) {
        computedMin = dm.min; computedMax = dm.max;
        if (computedMin === computedMax) {
          const pad = (Math.abs(computedMin) > 1e-6) ? Math.abs(computedMin) * 0.05 : 1;
          computedMin -= pad; computedMax += pad;
        } else {
          const pad = Math.max(Math.abs(computedMax - computedMin) * 0.02, 1e-6);
          computedMin -= pad; computedMax += pad;
        }
      }

      const finalMin = (ymin === null || ymin === undefined || !Number.isFinite(Number(ymin))) ? (computedMin !== null ? computedMin : undefined) : Number(ymin);
      const finalMax = (ymax === null || ymax === undefined || !Number.isFinite(Number(ymax))) ? (computedMax !== null ? computedMax : undefined) : Number(ymax);

      if (finalMin === undefined) { if ('min' in sopts) delete sopts.min; } else sopts.min = Number(finalMin);
      if (finalMax === undefined) { if ('max' in sopts) delete sopts.max; } else sopts.max = Number(finalMax);

      try { ch.update(); } catch(e){ try { ch.update('none'); } catch(_){} }
      return;
    }

    // CASE C: both bounds provided -> apply them (ensure numeric)
    if (Number.isFinite(Number(ymin))) sopts.min = Number(ymin); else if ('min' in sopts) delete sopts.min;
    if (Number.isFinite(Number(ymax))) sopts.max = Number(ymax); else if ('max' in sopts) delete sopts.max;

    try { ch.update(); } catch(e){ try { ch.update('none'); } catch(_){} }
  } catch (e) {
    console.warn('setYAxisRangeForChart error', e);
    try { ch.update(); } catch(_) {}
  }
}



    // expose API (already used by multi_io)
    window.ChainUI.setYAxisRangeForChart = setYAxisRangeForChart;
    window.ChainUI.getChartRanges = function(){ return JSON.parse(JSON.stringify(window.ChainUI.chartRanges || {})); };

    window.ChainUI.applyChartRangesFromObject = function(obj){
      if (!obj || typeof obj !== 'object') return;
      Object.keys(MAP).forEach(k=>{
        try {
          const item = obj[k];
          const ymin = (item && (item.ymin !== undefined)) ? (Number.isFinite(Number(item.ymin)) ? Number(item.ymin) : null) : null;
          const ymax = (item && (item.ymax !== undefined)) ? (Number.isFinite(Number(item.ymax)) ? Number(item.ymax) : null) : null;
          // set inputs if present
          const yminEl = document.getElementById(`${k}YMinInput`);
          const ymaxEl = document.getElementById(`${k}YMaxInput`);
          if (yminEl) yminEl.value = (ymin === null ? '' : String(ymin));
          if (ymaxEl) ymaxEl.value = (ymax === null ? '' : String(ymax));
          setYAxisRangeForChart(k, ymin, ymax);
        } catch(e){ console.warn('applyChartRangesFromObject failed for', k, e); }
      });
    };

    // Debounce helper per-input to avoid too many chart.update calls
    const debounceTimers = {};
    function debounceSet(key, ymin, ymax, ms=250){
      if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
      debounceTimers[key] = setTimeout(()=> {
        setYAxisRangeForChart(key, ymin, ymax);
        debounceTimers[key] = null;
      }, ms);
    }

    // create DOM controls for each chart if not yet present
    Object.keys(MAP).forEach(key=>{
      const map = MAP[key];
      const canvas = document.getElementById(map.canvasId);
      if (!canvas) return;
      const card = canvas.closest('.chart-card') || canvas.parentElement;
      if (!card) return;

      // avoid duplicate control creation
      if (card.querySelector(`.chart-range-${key}`)) return;

      // create header container if absent
      let header = card.querySelector('.chart-top-controls');
      if (!header) {
        header = document.createElement('div');
        header.className = 'chart-top-controls';
        header.style.display = 'flex';
        header.style.gap = '8px';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'flex-end';
        header.style.marginBottom = '6px';
        card.insertBefore(header, canvas);
      }

      // build compact inputs (no buttons)
      const wrapper = document.createElement('div');
      wrapper.className = `chart-range-wrapper chart-range-${key}`;
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '6px';
      wrapper.innerHTML = `
        <label class="small muted" style="white-space:nowrap;">${map.label} ymin</label>
        <input id="${key}YMinInput" placeholder="auto" style="width:84px;padding:4px;border-radius:5px;font-size:0.85rem;" />
        <label class="small muted" style="white-space:nowrap;">Ymax</label>
        <input id="${key}YMaxInput" placeholder="auto" style="width:84px;padding:4px;border-radius:5px;font-size:0.85rem;" />
      `;
      header.appendChild(wrapper);

      const yminEl = wrapper.querySelector(`#${key}YMinInput`);
      const ymaxEl = wrapper.querySelector(`#${key}YMaxInput`);

      // input handlers: live update with debounce
      function onInputChanged(){
        const rawA = String(yminEl.value || '').trim();
        const rawB = String(ymaxEl.value || '').trim();
        const a = parseOrNull(rawA);
        const b = parseOrNull(rawB);

        // If both fields are empty -> force autoscale immediately
        if (rawA === '' && rawB === '') {
          // persist
          window.ChainUI.chartRanges[key] = { ymin: null, ymax: null };
          // apply immediate autoscale
          setYAxisRangeForChart(key, null, null);
          // clear any pending debounce for this key
          if (debounceTimers[key]) { clearTimeout(debounceTimers[key]); debounceTimers[key] = null; }
          return;
        }

        // If one field is empty -> treat it as null (autoscale for that bound) and apply immediately:
        if (rawA === '' || rawB === '') {
          const newYmin = rawA === '' ? null : a;
          const newYmax = rawB === '' ? null : b;
          // persist then apply
          window.ChainUI.chartRanges[key] = { ymin: newYmin, ymax: newYmax };
          setYAxisRangeForChart(key, newYmin, newYmax);
          if (debounceTimers[key]) { clearTimeout(debounceTimers[key]); debounceTimers[key] = null; }
          return;
        }

        // If both defined and invalid ordering -> give visual feedback & persist but DO NOT apply scale
        if (a !== null && b !== null && a >= b) {
          // subtle border flash
          yminEl.style.borderColor = 'var(--danger)';
          ymaxEl.style.borderColor = 'var(--danger)';
          setTimeout(()=>{ yminEl.style.borderColor=''; ymaxEl.style.borderColor=''; }, 700);
          // persist invalid values so user can keep editing, but do not apply to chart
          window.ChainUI.chartRanges[key] = { ymin: a, ymax: b };
          // cancel any debounce
          if (debounceTimers[key]) { clearTimeout(debounceTimers[key]); debounceTimers[key] = null; }
          return;
        }

        // Normal case: both numbers valid -> debounce applying the scale for smoothness
        debounceSet(key, a, b, 250);
      }


      yminEl.addEventListener('input', onInputChanged);
      ymaxEl.addEventListener('input', onInputChanged);
      // support paste/blur events to force immediate apply
      yminEl.addEventListener('blur', onInputChanged);
      ymaxEl.addEventListener('blur', onInputChanged);

      // Restore saved runtime values into inputs and apply them
      const saved = (window.ChainUI.chartRanges && window.ChainUI.chartRanges[key]) ? window.ChainUI.chartRanges[key] : null;
      if (saved) {
        if (saved.ymin !== null && saved.ymin !== undefined && Number.isFinite(saved.ymin)) yminEl.value = saved.ymin;
        if (saved.ymax !== null && saved.ymax !== undefined && Number.isFinite(saved.ymax)) ymaxEl.value = saved.ymax;
        if ((saved.ymin !== null && saved.ymin !== undefined) || (saved.ymax !== null && saved.ymax !== undefined)) {
          // apply immediately (no debounce)
          setYAxisRangeForChart(key, saved.ymin, saved.ymax);
        }
      }
    }); // end map keys
  }


  /* ---------- UI update after compute (called by compute module) ---------- */
  function updateUIAfterCompute(result){
    // normalise result -> lastComputed
    if (!result || !Array.isArray(result.freqs)) {
      lastComputed = { freqs: [], gain: [], nf: [], op1: [], ip1: [] };
    } else {
      // defensive copy
      lastComputed = {
        freqs: Array.isArray(result.freqs) ? result.freqs.slice() : [],
        gain: Array.isArray(result.gain) ? result.gain.slice() : [],
        nf: Array.isArray(result.nf) ? result.nf.slice() : [],
        op1: Array.isArray(result.op1) ? result.op1.slice() : [],
        ip1: Array.isArray(result.ip1) ? result.ip1.slice() : []
      };
    }

    // expose to UI/debug
    if (window.ChainUI) window.ChainUI.lastComputed = lastComputed;

    // Active range affichage
    if (lastComputed.freqs && lastComputed.freqs.length) {
      const fmin = lastComputed.freqs[0];
      const fmax = lastComputed.freqs[lastComputed.freqs.length - 1];
      if (activeRangeEl) activeRangeEl.textContent = `${Number(fmin).toLocaleString()} Hz → ${Number(fmax).toLocaleString()} Hz`;
    } else {
      if (activeRangeEl) activeRangeEl.textContent = '—';
    }

    // Snapshot au centre (point milieu)
    if (!lastComputed.freqs || lastComputed.freqs.length === 0) {
      if (gainEl) gainEl.textContent = '— dB';
      if (nfEl) nfEl.textContent = '— dB';
      if (opOutEl) opOutEl.textContent = '— dBm';
      if (ipInEl) ipInEl.textContent = '— dBm';
    } else {
      const mid = Math.floor(lastComputed.freqs.length / 2);
      const g = lastComputed.gain[mid], n = lastComputed.nf[mid], o = lastComputed.op1[mid], ip = lastComputed.ip1[mid];
      if (gainEl) gainEl.textContent = isFinite(g) ? g.toFixed(2) + ' dB' : '— dB';
      if (nfEl) nfEl.textContent = isFinite(n) ? n.toFixed(2) + ' dB' : '— dB';
      if (opOutEl) opOutEl.textContent = isFinite(o) ? o.toFixed(2) + ' dBm' : '— dBm';
      if (ipInEl) ipInEl.textContent = isFinite(ip) ? ip.toFixed(2) + ' dBm' : '— dBm';
    }

    // helper min/max en ignorant NaN/Infinity
    function minMax(arr){
      const vals = (arr || []).filter(v => typeof v === 'number' && isFinite(v));
      if (!vals.length) return { min: NaN, max: NaN };
      return { min: Math.min(...vals), max: Math.max(...vals) };
    }

    const gMM = minMax(lastComputed.gain);
    const nfMM = minMax(lastComputed.nf);
    const opMM = minMax(lastComputed.op1);
    const ipMM = minMax(lastComputed.ip1);

    // Mettre à jour les badges (plot) s'ils existent (pour la zone graphique)
    if (gainPlotMin) gainPlotMin.textContent = isFinite(gMM.min) ? gMM.min.toFixed(2) : '—';
    if (gainPlotMax) gainPlotMax.textContent = isFinite(gMM.max) ? gMM.max.toFixed(2) : '—';
    if (nfPlotMin) nfPlotMin.textContent = isFinite(nfMM.min) ? nfMM.min.toFixed(2) : '—';
    if (nfPlotMax) nfPlotMax.textContent = isFinite(nfMM.max) ? nfMM.max.toFixed(2) : '—';
    if (opPlotMin) opPlotMin.textContent = isFinite(opMM.min) ? opMM.min.toFixed(2) : '—';
    if (opPlotMax) opPlotMax.textContent = isFinite(opMM.max) ? opMM.max.toFixed(2) : '—';
    if (ipPlotMin) ipPlotMin.textContent = isFinite(ipMM.min) ? ipMM.min.toFixed(2) : '—';
    if (ipPlotMax) ipPlotMax.textContent = isFinite(ipMM.max) ? ipMM.max.toFixed(2) : '—';

    // ---------- IMPORTANT: mettre à jour la zone "Pire cas (sur plage)" ----------
    function setPireCas(id, value, unit='') {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = (typeof value === 'number' && isFinite(value)) ? value.toFixed(2) + (unit || '') : '—';
    }

    setPireCas('gainMin', gMM.min, ' dB');
    setPireCas('gainMax', gMM.max, ' dB');

    setPireCas('nfMin', nfMM.min, ' dB');
    setPireCas('nfMax', nfMM.max, ' dB');

    setPireCas('opMin', opMM.min, ' dBm');
    setPireCas('opMax', opMM.max, ' dBm');

    setPireCas('ipMin', ipMM.min, ' dBm');
    setPireCas('ipMax', ipMM.max, ' dBm');

    // ---------- update charts (labels & data) ----------
    if (charts.gain) {
      const labels = (lastComputed.freqs || []).map(f => formatFreqLabel(f));
      updateChartDataset(charts.gain, labels, lastComputed.gain);
      updateChartDataset(charts.nf, labels, lastComputed.nf);
      updateChartDataset(charts.op1, labels, lastComputed.op1);
      updateChartDataset(charts.ip1, labels, lastComputed.ip1);
    }
  }

  /* ---------- CSV export (from lastComputed) ---------- */
  function exportCsv(){
    if (!lastComputed.freqs || !lastComputed.freqs.length) { alert('Aucune donnée calculée à exporter.'); return; }
    const lines = ['freq_Hz,gain_dB,nf_dB,op1dB_out_dBm,ip1dB_in_dBm'];
    for (let i=0;i<lastComputed.freqs.length;i++){
      const f = lastComputed.freqs[i];
      lines.push([f, lastComputed.gain[i], lastComputed.nf[i], lastComputed.op1[i], lastComputed.ip1[i]].map(x => isFinite(x)?x:'').join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'multi_verif_results.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  /* ---------- UI wiring ---------- */
  function setupUI(){
    if (btnAddStage) btnAddStage.addEventListener('click', ()=> { window.stages.push(defaultStage(window.stages.length)); renderStages(); requestCompute(); nStagesInput && (nStagesInput.value = window.stages.length); });
    if (btnRemoveStage) btnRemoveStage.addEventListener('click', ()=> { if (!window.stages.length) return; window.stages.pop(); renderStages(); requestCompute(); nStagesInput && (nStagesInput.value = window.stages.length); });
    if (nStagesInput) {
      nStagesInput.addEventListener('input', (e)=> {
        let v = parseInt(e.target.value,10); if (isNaN(v)) v = window.stages.length;
        v = Math.max(0, Math.min(200, v));
        if (v > window.stages.length) for (let i=window.stages.length;i<v;i++) window.stages.push(defaultStage(i));
        else if (v < window.stages.length) window.stages.splice(v);
        renderStages(); requestCompute(); nStagesInput.value = v;
      });
    }
    if (btnReset) btnReset.addEventListener('click', ()=> { if (!confirm(t('confirm_reset'))) return; window.stages = initialChain(); renderStages(); requestCompute(); });

    if (btnComputeRange) btnComputeRange.addEventListener('click', ()=> requestCompute());
    if (btnExportCsv) btnExportCsv.addEventListener('click', exportCsv);
    if (btnManageLibrary) btnManageLibrary.addEventListener('click', ()=> { const libSection = document.getElementById('librarySection'); if (libSection) libSection.scrollIntoView({ behavior:'smooth', block:'center' }); });
    if (btnAddFiles) btnAddFiles.addEventListener('click', ()=> { const libFileInput = document.getElementById('libFileInput'); if (libFileInput) libFileInput.click(); });

    // when library changes -> refresh lib selects and clear lib cache (compute module handles cache)
    LibraryAPI.onChange(()=> {
      document.querySelectorAll('.stage-card').forEach(card => {
        card.querySelectorAll('.lib_select').forEach(sel => {
          const prev = sel.value; populateLibSelect(sel, prev);
        });
      });
      // re-run compute since library content might change
      requestCompute();
    });

    // if compute module is present, notify it we are ready
    if (window.ChainCompute && typeof window.ChainCompute._notifyUIReady === 'function') {
      try { window.ChainCompute._notifyUIReady(); } catch (e) {}
    }
  }

  /* ---------- Init ---------- */
  function init(){
    createCharts();
    // create per-chart y-range controls (idempotent)
    try { createPerChartScaleControls(); } catch(e){ console.warn('createPerChartScaleControls failed', e); }

    if (!Array.isArray(window.stages) || window.stages.length === 0) window.stages = initialChain();
    renderStages();
    setupUI();
    // flush pending if compute available
    if (window.ChainCompute && typeof window.ChainCompute._notifyUIReady === 'function') {
      try { window.ChainCompute._notifyUIReady(); } catch (e) {}
    } else {
      // ChainCompute may appear later; it should call ChainUI._flushPending()
    }
    // initial compute request
    requestCompute();

    // expose API for compute module to call back
    window.ChainUI.renderStages = renderStages;
    window.ChainUI.renderSummaryTable = renderSummaryTable;
    window.ChainUI.updateUIAfterCompute = updateUIAfterCompute;
    window.ChainUI._flushPending = _flushPending;
    window.ChainUI.requestCompute = requestCompute;
    window.ChainUI._internal = { createCharts, updateChartDataset, generateFreqArray };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  console.log('multi_chain_1 (UI) initialisé.');
})();
