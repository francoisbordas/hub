/* ---------- i18n (simplifié, on garde fr par défaut) */
const I18N = {
  fr: {
    types: {ampli:'LNA', filter:'Filtre', atten:'Atténuateur', switch:'Switch', mixer:'Mixer'},
    label_gain_field: 'Gain (dB) :',
    label_nf_field: 'NF (dB) :',
    label_insertion_field: 'Insertion loss (dB) :',
    label_p1: 'OP1dB (dBm) :',
    default_chain_prefix: {filter:'Filtre', lna:'LNA', mixer:'Mixer'},
    confirm_reset: 'Réinitialiser tout ?',
    details: 'Détails & trace',
    help_title: 'Rappels par type',
    help_filter: 'Filtre',
    help_filter_desc: 'renseigner Perte d’insertion (dB) et OP1dB. (NF = Perte d’insertion)',
    help_lna: 'LNA',
    help_lna_desc: 'renseigner Gain (dB), NF (dB), OP1dB.',
    help_att: 'Atténuateur / Switch',
    help_att_desc: 'renseigner Atténuation (dB) et OP1dB ; NF = Atténuation.',
    help_mixer: 'Mixer',
    help_mixer_desc: 'renseigner Perte de conversion (dB), NF (dB), OP1dB.'
  }
};
let currentLang = 'fr';
function t(key){ const parts = key.split('.'); let v = I18N[currentLang]; for (const p of parts){ if (v && v[p] !== undefined) v = v[p]; else return key; } return v; }
function applyLang(lang){ currentLang = lang; }
function applyTheme(tname){ document.body.setAttribute('data-theme', tname); }

/* utils */
function dbToLin(db) { if (!isFinite(db)) return 1e300; if (db > 500) return 1e300; return Math.pow(10, db / 10); }
function linToDb(lin) { if (lin <= 0) return -Infinity; return 10 * Math.log10(lin); }

/* DOM refs */
const stagesContainer = document.getElementById('stagesContainer');
const tableBody = document.querySelector('#tableStages tbody');
const gainEl = document.getElementById('gainTotal');
const nfEl = document.getElementById('nfTotal');
const opOutEl = document.getElementById('op1dB_out');
const ipInEl = document.getElementById('ip1dB_in');
const btnReset = document.getElementById('btnReset');
const nStagesInput = document.getElementById('nStagesInput');
const btnAdd = document.getElementById('btnAdd');
const btnRemove = document.getElementById('btnRemove');

/* ---------- YAML import / export (utilise js-yaml) ---------- */
const yamlFileInput = document.getElementById('yamlFileInput');
const btnImportYaml = document.getElementById('btnImportYaml');
const btnExportYaml = document.getElementById('btnExportYaml');
const yamlStatus = document.getElementById('yamlStatus');

function sanitizeStageFromYaml(item, idx) {
  const s = {};
  s.name = item.name || (`Stage ${idx+1}`);
  s.type = item.type || 'filter';

  // gains / pertes brutes fournies dans le YAML
  s.gain_dB = (item.gain_dB !== undefined) ? Number(item.gain_dB) : 0;
  s.gain_dB_max = (item.gain_dB_max !== undefined) ? Number(item.gain_dB_max) : undefined;
  s.insertion_loss_dB = (item.insertion_loss_dB !== undefined) ? Number(item.insertion_loss_dB) : 0;

  // si c'est un atténuateur, définir insertion_loss comme |gain actif|
  if (s.type === 'atten') {
    const activeGain = (s.gain_dB_max !== undefined) ? s.gain_dB_max : s.gain_dB;
    s.insertion_loss_dB = Math.abs(Number(activeGain || 0));
  }

  // si c'est un mixer, remplir insertion_loss avec |gain_dB| pour affichage (conversion loss)
  if (s.type === 'mixer') {
    s.insertion_loss_dB = Math.abs(Number(item.gain_dB !== undefined ? item.gain_dB : item.insertion_loss_dB || 0));
  }

  // NF : si fourni on l'utilise; sinon heuristiques
  if (item.nf_dB !== undefined) {
    s.nf_dB = Number(item.nf_dB);
  } else {
    if (s.type === 'filter' || s.type === 'switch') s.nf_dB = s.insertion_loss_dB;
    else if (s.type === 'atten') s.nf_dB = Math.abs(s.insertion_loss_dB);
    else s.nf_dB = Math.abs(s.gain_dB) || 0;
  }

  s.op1db_dBm = (item.op1db_dBm !== undefined) ? Number(item.op1db_dBm) : 1000;
  return s;
}



function importYamlString(yamlText) {
  let obj;
  try {
    obj = jsyaml.load(yamlText);
  } catch (e) {
    yamlStatus.textContent = 'Erreur: YAML non valide';
    console.error(e);
    return false;
  }
  if (!obj || !obj.architecture || !Array.isArray(obj.architecture)) {
    yamlStatus.textContent = 'Erreur: clé "architecture" manquante ou non-liste';
    return false;
  }

  // Convertir en stages au format interne (ordre haut->bas)
  const newStages = obj.architecture.map((it, idx) => sanitizeStageFromYaml(it, idx));
  stages = newStages.map((s, idx) => {
    // construire objet stage complet (mêmes champs que defaultStage)
    return {
      name: s.name,
      type: s.type,
      gain_dB: (s.type === 'filter' || s.type === 'atten' || s.type === 'switch' || s.type === 'mixer') ? (s.gain_dB || 0) : (s.gain_dB || 0),
      nf_dB: s.nf_dB,
      insertion_loss_dB: s.insertion_loss_dB || 0,
      op1db_dBm: s.op1db_dBm
    };
  });

  renderStages();
  computeAll();
  yamlStatus.textContent = 'YAML importé';
  setTimeout(()=>yamlStatus.textContent = '', 2500);
  return true;
}

function importYamlFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    importYamlString(e.target.result);
  };
  reader.onerror = function() {
    yamlStatus.textContent = 'Erreur lecture fichier';
  };
  reader.readAsText(file, 'utf-8');
}

function exportYamlString() {
  const architecture = stages.map(s => {
    const out = { name: s.name, type: s.type };
    if (s.type === 'filter' || s.type === 'switch') {
      out.insertion_loss_dB = Number(s.insertion_loss_dB || 0);
    }
    if (s.type === 'atten') {
      out.gain_dB = Number(s.gain_dB || 0);
      if (s.gain_dB_max !== undefined) out.gain_dB_max = Number(s.gain_dB_max);
    }
    if (s.type === 'ampli' || s.type === 'mixer') {
      out.gain_dB = Number(s.gain_dB || 0);
      out.nf_dB = Number(s.nf_dB || 0);
    }
    out.op1db_dBm = Number(s.op1db_dBm || 1000);
    return out;
  });
  const doc = { architecture };
  return jsyaml.dump(doc, { noRefs: true, sortKeys: false });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* event listeners for import/export controls */
if (btnImportYaml) {
  btnImportYaml.addEventListener('click', () => yamlFileInput.click());
}
if (yamlFileInput) {
  yamlFileInput.addEventListener('change', (ev)=> {
    const f = ev.target.files[0];
    if (f) importYamlFile(f);
    // clear input for re-import same file later
    yamlFileInput.value = '';
  });
}
if (btnExportYaml) {
  btnExportYaml.addEventListener('click', () => {
    const yamlText = exportYamlString();
    downloadText('architecture_export.yaml', yamlText);
    yamlStatus.textContent = 'YAML exporté';
    setTimeout(()=>yamlStatus.textContent = '', 2000);
  });
}


let stages = [];

/* ========== contrôles du nombre d'étages (btn + / - / input) ========== */
btnAdd.addEventListener('click', () => {
  const max = 100;
  if (stages.length >= max) return;
  stages.push(defaultStage(stages.length));
  renderStages();
  computeAll();
  nStagesInput.value = stages.length;
});

btnRemove.addEventListener('click', () => {
  if (stages.length === 0) return;
  stages.pop();
  renderStages();
  computeAll();
  nStagesInput.value = stages.length;
});

nStagesInput.addEventListener('input', (e) => {
  let v = parseInt(e.target.value, 10);
  if (Number.isNaN(v)) v = 0;
  const max = 100;
  v = Math.max(0, Math.min(max, v));
  if (v > stages.length) {
    for (let i = stages.length; i < v; i++) stages.push(defaultStage(i));
  } else if (v < stages.length) {
    stages.splice(v);
  }
  renderStages();
  computeAll();
  nStagesInput.value = v;
});

nStagesInput.addEventListener('blur', (e) => {
  let v = parseInt(e.target.value, 10);
  if (Number.isNaN(v)) v = stages.length;
  v = Math.max(0, Math.min(100, v));
  nStagesInput.value = v;
});

function defaultStage(i){ return { name: `${t('default_chain_prefix.filter')} ${i+1}`, type: 'ampli', gain_dB: 15, nf_dB: 3, insertion_loss_dB: 1, op1db_dBm: 23 }; }

function initialChain(){
  return [
    { name: t('default_chain_prefix.filter') + ' 1', type:'filter', gain_dB:0, nf_dB:1, insertion_loss_dB:1.0, op1db_dBm: 35 },
    { name: t('default_chain_prefix.lna') + ' 1', type:'ampli', gain_dB:20, nf_dB:1.0, insertion_loss_dB:0, op1db_dBm: 18 },
    { name: t('default_chain_prefix.filter') + ' 2', type:'filter', gain_dB:0, nf_dB:0.8, insertion_loss_dB:0.8, op1db_dBm: 38 },
    { name: t('default_chain_prefix.mixer') + ' 1', type:'mixer', gain_dB:0, nf_dB:6.0, insertion_loss_dB:6.0, op1db_dBm: 10 },
    { name: t('default_chain_prefix.filter') + ' 3', type:'filter', gain_dB:0, nf_dB:1.0, insertion_loss_dB:1.0, op1db_dBm: 40 }
  ];
}

/* ---------- remplaçant complet de makeStageCard ---------- */
function makeStageCard(idx, data) {
  const L = I18N[currentLang];
  const root = document.createElement('div');
  root.className = 'stage-card';
  root.dataset.index = idx;
  root.dataset.type = data.type;
  // NOTE: draggable activé dynamiquement sur pointerdown de la poignée
  root.setAttribute('draggable', 'false');

  const header = document.createElement('div');
  header.className = 'stage-header';
  header.innerHTML = `
    <div class="stage-name">
      <span class="stage-index">#${idx+1}</span>
      <input type="text" class="s_name" placeholder="Nom de l’étage…">
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <div class="drag-handle" title="Glisser pour déplacer">
        <div class="bars" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>
      <button class="remove">X</button>
    </div>
  `;

  const typeRow = document.createElement('div');
  typeRow.className = 'stage-row';
  typeRow.innerHTML = `
    <label>Type :</label>
    <select class="s_type">
      <option value="ampli">${L.types.ampli}</option>
      <option value="filter">${L.types.filter}</option>
      <option value="atten">${L.types.atten}</option>
      <option value="switch">${L.types.switch}</option>
      <option value="mixer">${L.types.mixer}</option>
    </select>
  `;
  typeRow.querySelector('.s_type').value = data.type;

  const params = document.createElement('div');
  params.className = 'stage-controls';
  params.innerHTML = `
    <div class="stage-row">
      <label class="lab_gain">${L.label_gain_field}</label>
      <input type="number" step="0.1" class="s_gain" value="${data.gain_dB}">
    </div>
    <div class="stage-row">
      <label class="lab_nf">${L.label_nf_field}</label>
      <input type="number" step="0.1" class="s_nf" value="${data.nf_dB}">
    </div>
    <div class="stage-row">
      <label class="lab_insertion">${L.label_insertion_field}</label>
      <input type="number" step="0.1" class="s_insertion" value="${data.insertion_loss_dB}">
    </div>
    <div class="stage-row">
      <label>${L.label_p1}</label>
      <input type="number" step="0.01" class="s_p1" value="${data.op1db_dBm}">
    </div>
  `;

  root.appendChild(header);
  root.appendChild(typeRow);
  root.appendChild(params);

  // set the name value so user labels are preserved when re-rendering
  const nameInput = root.querySelector('.s_name');
  nameInput.value = data.name || '';

  // update the visual and dataset type
  function updateVis() {
    const type = root.querySelector('.s_type').value;
    const lab_gain = root.querySelector('.lab_gain');
    const lab_nf = root.querySelector('.lab_nf');
    const lab_ins = root.querySelector('.lab_insertion');
    const inp_gain = root.querySelector('.s_gain');
    const inp_nf = root.querySelector('.s_nf');
    const inp_ins = root.querySelector('.s_insertion');

    // reset all visible
    lab_gain.style.display = 'inline-block'; inp_gain.style.display = 'inline-block';
    lab_ins.style.display = 'inline-block'; inp_ins.style.display = 'inline-block';
    lab_nf.style.display = 'inline-block'; inp_nf.style.display = 'inline-block';

    if (type === 'filter') {
      lab_gain.style.display = 'none'; inp_gain.style.display = 'none';
      lab_ins.textContent = L.label_insertion_field;
      lab_nf.style.display = 'none'; inp_nf.style.display = 'none';
    } else if (type === 'ampli') {
      lab_gain.style.display = 'inline-block'; inp_gain.style.display = 'inline-block';
      lab_ins.style.display = 'none'; inp_ins.style.display = 'none';
      lab_nf.style.display = 'inline-block'; inp_nf.style.display = 'inline-block';
    } else if (type === 'atten' || type === 'switch') {
      lab_gain.style.display = 'none'; inp_gain.style.display = 'none';
      lab_ins.textContent = 'Atténuation (dB) :';
      lab_nf.style.display = 'none'; inp_nf.style.display = 'none';
    } else if (type === 'mixer') {
      lab_gain.style.display = 'none'; inp_gain.style.display = 'none';
      lab_ins.textContent = 'Conversion loss (dB) :';
      lab_nf.style.display = 'inline-block'; inp_nf.style.display = 'inline-block';
    }
    root.dataset.type = type;
  }

  updateVis();

  // --- synchroniser les valeurs affichées dans les inputs selon le type et les valeurs importées ---
  const s_gain_inp = root.querySelector('.s_gain');
  const s_ins_inp = root.querySelector('.s_insertion');
  const s_nf_inp = root.querySelector('.s_nf');
  const s_p1_inp = root.querySelector('.s_p1');

  // valeurs par défaut en nombre
  const dataGain = Number(data.gain_dB || 0);
  const dataGainMax = (data.gain_dB_max !== undefined) ? Number(data.gain_dB_max) : undefined;
  const dataIns = Number(data.insertion_loss_dB || 0);
  const activeGain = (data.type === 'atten') ? (dataGainMax !== undefined ? dataGainMax : dataGain) : dataGain;

  if (data.type === 'atten') {
    s_ins_inp.value = Math.abs(activeGain).toString();      // affichage: Atténuation positive (ex: 5)
    s_gain_inp.value = dataGain.toString();                 // gain nominal (négatif) si besoin
    s_nf_inp.value = (data.nf_dB !== undefined ? data.nf_dB : Math.abs(activeGain)).toString();
  } else if (data.type === 'mixer') {
    s_ins_inp.value = Math.abs(dataGain || dataIns).toString(); // affichage: conversion loss positive
    s_gain_inp.value = dataGain.toString();
    s_nf_inp.value = (data.nf_dB !== undefined ? data.nf_dB : Math.abs(dataGain)).toString();
  } else if (data.type === 'filter' || data.type === 'switch') {
    s_ins_inp.value = dataIns.toString();
    s_gain_inp.value = (data.gain_dB || 0).toString();
    s_nf_inp.value = (data.nf_dB !== undefined ? data.nf_dB : dataIns).toString();
  } else { // ampli / default
    s_gain_inp.value = dataGain.toString();
    s_ins_inp.value = dataIns.toString();
    s_nf_inp.value = (data.nf_dB !== undefined ? data.nf_dB : Math.abs(dataGain)).toString();
  }

  s_p1_inp.value = (data.op1db_dBm !== undefined ? data.op1db_dBm : 1000);


  root.querySelector('.s_type').addEventListener('change', () => { updateVis(); writeBack(); computeAll(); });
  root.querySelector('.remove').addEventListener('click', () => {
    const i = parseInt(root.dataset.index, 10);
    if (!Number.isFinite(i)) return;
    stages.splice(i, 1);
    renderStages();
    computeAll();
  });

  function writeBack(){
    const i = parseInt(root.dataset.index, 10);
    if (!Number.isFinite(i)) return;
    const s = stages[i];

    s.name = root.querySelector('.s_name').value;
    s.type = root.querySelector('.s_type').value;

    const inpGain = root.querySelector('.s_gain').value;
    const inpIns = root.querySelector('.s_insertion').value;
    const inpNf = root.querySelector('.s_nf').value;
    const inpP1 = root.querySelector('.s_p1').value;

    if (s.type === 'filter' || s.type === 'switch') {
      s.insertion_loss_dB = parseFloat(inpIns) || 0;
      // pour cohérence, garder aussi gain_dB = -insertion_loss
      s.gain_dB = -s.insertion_loss_dB;
      s.nf_dB = (inpNf !== '') ? parseFloat(inpNf) : s.insertion_loss_dB;
    } else if (s.type === 'atten') {
      // l'input insertion affiche l'atténuation positive (ex: 5dB)
      const att = parseFloat(inpIns) || 0;
      s.insertion_loss_dB = att;
      // mettre gain_dB_max = -att (meilleure position), conserver gain_dB nominal si déjà présent
      s.gain_dB_max = -att;
      if (s.gain_dB === undefined || s.gain_dB === 0) s.gain_dB = -att;
      s.nf_dB = (inpNf !== '') ? parseFloat(inpNf) : Math.abs(att);
    } else if (s.type === 'mixer') {
      // input insertion affiche conversion loss positive (ex: 6.83)
      const conv = parseFloat(inpIns) || 0;
      s.insertion_loss_dB = conv;
      s.gain_dB = -conv;
      s.nf_dB = (inpNf !== '') ? parseFloat(inpNf) : Math.abs(s.gain_dB);
    } else { // ampli et autres
      s.gain_dB = parseFloat(inpGain) || 0;
      s.nf_dB = (inpNf !== '') ? parseFloat(inpNf) : Math.abs(s.gain_dB);
      s.insertion_loss_dB = Number(s.insertion_loss_dB || 0);
    }

    s.op1db_dBm = parseFloat(inpP1) || 1000;
    renderSummaryTable();
  }


  root.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input', () => { writeBack(); computeAll(); });
  });

  /* --- Drag & drop: activation uniquement depuis la poignée.
     On met draggable=true lors du pointerdown sur la poignée
     et on remet false au dragend. --- */
  const handle = root.querySelector('.drag-handle');

  handle.addEventListener('pointerdown', (ev) => {
    // enable dragging for this element only while user starts dragging
    root.setAttribute('draggable', 'true');
  });

  handle.addEventListener('pointerup', (ev) => {
    // remove draggable if user releases without dragging
    root.setAttribute('draggable', 'false');
  });

  root.addEventListener('dragstart', (ev) => {
    const srcIdx = parseInt(root.dataset.index, 10);
    if (!Number.isFinite(srcIdx)) { ev.preventDefault(); return; }
    try {
      ev.dataTransfer.setData('text/plain', String(srcIdx));
      ev.dataTransfer.effectAllowed = 'move';
    } catch (e) { /* some browsers peuvent être stricts */ }
    root.classList.add('dragging');
  });

  root.addEventListener('dragend', (ev) => {
    root.setAttribute('draggable', 'false');
    root.classList.remove('dragging');
    const marker = stagesContainer.querySelector('.insert-marker');
    if (marker) marker.remove();
  });

  return root;
}


/* render / summary */
function renderStages(){
  stagesContainer.innerHTML='';
  stages.forEach((s, idx)=>{ const card = makeStageCard(idx, s); stagesContainer.appendChild(card); });
  nStagesInput.value = stages.length;
  attachContainerDnD();
  renderSummaryTable();
}

function renderSummaryTable(){
  tableBody.innerHTML='';
  stages.forEach((s, idx)=>{
    let gainShown = 0, nfShown = 0;

    if (s.type === 'filter' || s.type === 'switch') {
      gainShown = -(s.insertion_loss_dB || 0);
      nfShown = (s.insertion_loss_dB || 0);
    } else if (s.type === 'atten') {
      // pour les atténuateurs, afficher la valeur 'active' = gain_dB_max si fournie, sinon gain_dB
      gainShown = (s.gain_dB_max !== undefined) ? Number(s.gain_dB_max) : Number(s.gain_dB || 0);
      // NF = atténuation positive
      nfShown = Math.abs(gainShown);
    } else if (s.type === 'mixer') {
      // mixer: conversion loss prise depuis gain_dB (négatif si perte)
      gainShown = Number(s.gain_dB || 0);
      nfShown = Number(s.nf_dB || Math.abs(gainShown));
    } else { // ampli et autres
      gainShown = Number(s.gain_dB || 0);
      nfShown = Number(s.nf_dB || Math.abs(gainShown));
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${idx+1}</td><td>${s.name} (${I18N[currentLang].types[s.type]})</td><td>${gainShown.toFixed(2)}</td><td>${nfShown.toFixed(2)}</td><td>${(s.op1db_dBm||0).toFixed(2)}</td>`;
    tableBody.appendChild(tr);
  });
}


/* NF / P1 calculations */
function calcNF(chain){ if (!chain.length) return NaN; let nf_tot = chain[0].nf_lin; let g_prod = chain[0].gain_lin; for (let i=1;i<chain.length;i++){ nf_tot += (chain[i].nf_lin - 1) / g_prod; g_prod *= chain[i].gain_lin; } return linToDb(nf_tot); }
function calcP1db(chain){ const N = chain.length; if (N===0) return -Infinity; const gain_after = new Array(N).fill(1.0); let prod = 1.0; for (let idx=N-1; idx>=0; --idx){ gain_after[idx] = prod; prod *= chain[idx].gain_lin; } let inv_sum = 0; for (let i=0;i<N;i++){ const p = chain[i].p1_lin; if (!isFinite(p) || p<=0) continue; inv_sum += 1 / (p * gain_after[i]); } if (inv_sum === 0) return Infinity; const Ptot = 1 / inv_sum; return linToDb(Ptot); }

function computeAll(){
  if (!stages.length) {
    gainEl.textContent = '— dB'; nfEl.textContent = '— dB'; opOutEl.textContent = '— dBm'; ipInEl.textContent = '— dBm';
    renderSummaryTable(); return;
  }

  const chainForNF = [];
  const chainForP1 = [];

  stages.forEach((s, idx) => {
    let gain_dB = 0;
    let nf_dB = 0;

    if (s.type === 'filter' || s.type === 'switch') {
      // passifs: perte d'insertion positive -> gain = -insertion_loss
      gain_dB = -(s.insertion_loss_dB || 0);
      nf_dB = s.insertion_loss_dB || 0;
    } else if (s.type === 'atten') {
      // atténuateur: utiliser gain_dB_max si fourni (meilleure position), sinon gain_dB
      gain_dB = (s.gain_dB_max !== undefined) ? Number(s.gain_dB_max) : Number(s.gain_dB || 0);
      // nf = atténuation positive
      nf_dB = Math.abs(gain_dB);
    } else if (s.type === 'mixer') {
      // mixer: conversion loss donné par gain_dB (négatif si perte)
      gain_dB = Number(s.gain_dB || 0);
      nf_dB = (s.nf_dB !== undefined) ? Number(s.nf_dB) : Math.abs(gain_dB);
    } else {
      // ampli et autres
      gain_dB = Number(s.gain_dB || 0);
      nf_dB = (s.nf_dB !== undefined) ? Number(s.nf_dB) : Math.abs(gain_dB);
    }

    const op1 = (s.op1db_dBm || 1000);
    const gain_lin = dbToLin(gain_dB);
    const nf_lin = dbToLin(nf_dB);
    const p1_lin = (op1 > 500) ? 1e300 : Math.pow(10, op1/10);

    chainForNF.push({ gain_lin, nf_lin, name: s.name });
    chainForP1.push({ gain_lin, p1_lin, name: s.name, op1: op1 });
  });

  const gprod = chainForNF.reduce((a,c)=>a*c.gain_lin,1);
  const gainTotal_dB = linToDb(gprod);
  const nfTotal_dB = calcNF(chainForNF);
  const p1_out = calcP1db(chainForP1);
  const ip1_in = p1_out - gainTotal_dB;

  gainEl.textContent = (isFinite(gainTotal_dB)?gainTotal_dB.toFixed(2):'—') + ' dB';
  nfEl.textContent = (isFinite(nfTotal_dB)?nfTotal_dB.toFixed(2):'—') + ' dB';
  opOutEl.textContent = (isFinite(p1_out)?p1_out.toFixed(2):'—') + ' dBm';
  ipInEl.textContent = (isFinite(ip1_in)?ip1_in.toFixed(2):'—') + ' dBm';

  renderSummaryTable();
}


/* ---------- Exemple YAML téléchargeable (compatible import) ---------- */
const btnDownloadExample = document.getElementById('btnDownloadExample');

const exampleYamlString = `# Fichier YAML d'exemple pour test de l'import sur le site
# L'ordre des éléments définit l'ordre de la chaîne RF (haut vers bas)
# Chaque composant doit avoir :
#   - name        : nom unique ou descriptif
#   - type        : 'filter', 'switch', 'ampli', 'atten', 'mixer'
#   - gain_dB     : pour ampli/mixer/atten
#   - gain_dB_max : pour atténuateur (meilleure position)
#   - insertion_loss_dB : pour filtre/switch (valeur positive)
#   - nf_dB       : figure de bruit (optionnel pour ampli/mixer)
#   - op1db_dBm   : OP1dB du composant

architecture:

  - name: Example_Filter
    type: filter
    insertion_loss_dB: 0.61
    op1db_dBm: 20
  
  - name: Example_Switch
    type: switch
    insertion_loss_dB: 0.85
    op1db_dBm: 25
  
  - name: Example_LNA
    type: ampli
    gain_dB: 15.3
    nf_dB: 3.5
    op1db_dBm: 23.94
  
  - name: Example_Attenuator
    type: atten
    gain_dB: -5
    op1db_dBm: 20

  - name: Example_Mixer
    type: mixer
    gain_dB: -6.83        # conversion loss
    nf_dB: 7.5
    op1db_dBm: 14

`;

/* fallback : downloadText existe déjà si tu as suivi les instructions précédentes.
   Si tu n'as pas downloadText, colle aussi la fonction suivante (déjà fournie auparavant). */
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* listener sur le bouton */
if (btnDownloadExample) {
  btnDownloadExample.addEventListener('click', () => {
    downloadText('architecture_example.yaml', exampleYamlString);
    yamlStatus.textContent = 'Exemple téléchargé';
    setTimeout(()=> yamlStatus.textContent = '', 2000);
  });
}



/* render help texts that were missing */
function renderHelp() {
  const L = I18N[currentLang];
  const elHelpFilter = document.getElementById('help_filter');
  const elHelpFilterDesc = document.getElementById('help_filter_desc');
  const elHelpLna = document.getElementById('help_lna');
  const elHelpLnaDesc = document.getElementById('help_lna_desc');
  const elHelpAtt = document.getElementById('help_att');
  const elHelpAttDesc = document.getElementById('help_att_desc');
  const elHelpMixer = document.getElementById('help_mixer');
  const elHelpMixerDesc = document.getElementById('help_mixer_desc');

  if (elHelpFilter) elHelpFilter.textContent = L.help_filter;
  if (elHelpFilterDesc) elHelpFilterDesc.textContent = L.help_filter_desc;
  if (elHelpLna) elHelpLna.textContent = L.help_lna;
  if (elHelpLnaDesc) elHelpLnaDesc.textContent = L.help_lna_desc;
  if (elHelpAtt) elHelpAtt.textContent = L.help_att;
  if (elHelpAttDesc) elHelpAttDesc.textContent = L.help_att_desc;
  if (elHelpMixer) elHelpMixer.textContent = L.help_mixer;
  if (elHelpMixerDesc) elHelpMixerDesc.textContent = L.help_mixer_desc;
}

/* reset */
btnReset.addEventListener('click', ()=>{ if(!confirm(I18N[currentLang].confirm_reset)) return; stages = initialChain(); renderStages(); computeAll(); });

/* ---------- Container-level drag & drop (remplacement robuste) ---------- */
function attachContainerDnD(){
  // On attache une seule fois les handlers; renderStages appellera attachContainerDnD() sans dupliquer.
  if (stagesContainer._dndAttached) return;

  // create the insert marker (kept in DOM for placement)
  const marker = document.createElement('div');
  marker.className = 'insert-marker';
  marker.style.display = 'none';
  stagesContainer.appendChild(marker);
  stagesContainer._insertMarker = marker;

  // dragover: calcule l'index d'insertion (par position Y) et affiche le marker entre deux cartes
  stagesContainer.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    const children = Array.from(stagesContainer.querySelectorAll('.stage-card'));
    if (children.length === 0) {
      // si vide, placer le marker en fin
      marker.style.display = 'block';
      stagesContainer.appendChild(marker);
      return;
    }
    const y = ev.clientY;
    let insertAt = children.length;
    for (let i = 0; i < children.length; i++) {
      const r = children[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { insertAt = i; break; }
    }
    if (insertAt >= children.length) stagesContainer.appendChild(marker);
    else stagesContainer.insertBefore(marker, children[insertAt]);
    marker.style.display = 'block';
  });

  // cacher le marker quand on sort du container
  stagesContainer.addEventListener('dragleave', (ev) => {
    const rect = stagesContainer.getBoundingClientRect();
    // si le curseur est hors du container -> cacher
    if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) {
      marker.style.display = 'none';
    }
  });

  // drop: calcule la destination en fonction de la position (même logique que dragover)
  stagesContainer.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const srcIdx = parseInt(ev.dataTransfer.getData('text/plain'), 10);
    if (!Number.isFinite(srcIdx)) { marker.style.display = 'none'; return; }

    // compute destination index by Y (to be robust)
    const children = Array.from(stagesContainer.querySelectorAll('.stage-card'));
    let destIdx = children.length;
    const y = ev.clientY;
    for (let i = 0; i < children.length; i++) {
      const r = children[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { destIdx = i; break; }
    }

    // remove source element and insert at dest (adjust index when necessary)
    const moved = stages.splice(srcIdx, 1)[0];
    let realDest = destIdx;
    if (srcIdx < destIdx) realDest = destIdx - 1;
    if (realDest < 0) realDest = 0;
    stages.splice(realDest, 0, moved);

    // clean up
    marker.style.display = 'none';
    marker.remove();

    renderStages();
    computeAll();
  });

  stagesContainer._dndAttached = true;
}


function onContainerDragOver(ev){ ev.preventDefault(); }

function findCardFromEvent(ev){
  let el = ev.target;
  while (el && !el.classList?.contains('stage-card')) el = el.parentElement;
  return el;
}

function onCardDragOver(ev){
  ev.preventDefault();
  const card = findCardFromEvent(ev);
  if (card) {
    document.querySelectorAll('.stage-card.drag-over').forEach(el=>el.classList.remove('drag-over'));
    card.classList.add('drag-over');
  }
}

function onCardDrop(ev){
  ev.preventDefault();
  const srcIdx = parseInt(ev.dataTransfer.getData('text/plain'),10);
  const destCard = findCardFromEvent(ev);
  let destIdx = destCard ? parseInt(destCard.dataset.index,10) : stages.length-1;
  if (!Number.isFinite(srcIdx) || !Number.isFinite(destIdx)) return;

  // if dropping onto an item, put AFTER it if mouseY is lower than midpoint; else insert before
  const rect = destCard.getBoundingClientRect();
  const midpoint = rect.top + rect.height/2;
  const insertBefore = (ev.clientY < midpoint);
  if (!insertBefore) destIdx = destIdx + 1;

  const moved = stages.splice(srcIdx,1)[0];
  // when removing earlier element, the dest index shifts
  let realDest = destIdx;
  if (srcIdx < destIdx) realDest = destIdx - 1;
  stages.splice(realDest,0,moved);
  renderStages();
  computeAll();
}

function onContainerDrop(ev){
  ev.preventDefault();
  const srcIdx = parseInt(ev.dataTransfer.getData('text/plain'),10);
  if (!Number.isFinite(srcIdx)) return;
  // append to end
  const moved = stages.splice(srcIdx,1)[0];
  stages.push(moved);
  renderStages(); computeAll();
}

/* init */
(function init(){ applyLang('fr'); applyTheme('dark'); stages = initialChain(); renderStages(); computeAll(); renderHelp(); })();
