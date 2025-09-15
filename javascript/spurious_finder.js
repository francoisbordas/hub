/* ---------- i18n strings (FR/EN) ---------- */

const I18N = {
  fr: {
    title: "Spurious — outil interactif",
    subtitle: "Les calculs se mettent à jour automatiquement à la saisie.",
    lang:"Langue",
    params_title: "Paramètres",
    params_sub: "Saisir les plages / bornes",
    reset_btn: "Réinitialiser",
    clear_all: "Vider",
    rf_range: "Plage RF (MHz) :",
    ol_fixed: "OL fixe (MHz) :",
    mode_label: "Mode :",
    fi_range: "Plage FI (MHz) :",
    m_max: "m_max (±) :",
    n_max: "n_max (±) :",
    table_title: "Table puissances spurious (dBc) — 5×6",
    table_hint: "m = 1..5, n = 0..5",
    reset_table: "Réinitialiser",
    clear_table: "Vider",
    download_csv: "Télécharger CSV",
    table_note: "Si une cellule est vide, la puissance n'est pas disponible pour ce couple (m,n).",
    results_title: "Résultats (tous couples)",
    no_calc: "Aucun calcul",
    download_report: "Télécharger rapport",
    copy_report: "Copier",
    author: "Auteur : <strong>François Bordas</strong> — <a href=\"mailto:francois.bordas@etu.univ-amu.fr\">francois.bordas@etu.univ-amu.fr</a>"
  },
  en: {
    title: "Spurious — interactive tool",
    subtitle: "Calculations update automatically while you type.",
    params_title: "Parameters",
    lang:"Language",
    params_sub: "Enter ranges / bounds",
    reset_btn: "Reset",
    clear_all: "Clear",
    rf_range: "RF range (MHz):",
    ol_fixed: "Fixed LO (MHz):",
    mode_label: "Mode:",
    fi_range: "IF range (MHz):",
    m_max: "m_max (±):",
    n_max: "n_max (±):",
    table_title: "Spurious power table (dBc) — 5×6",
    table_hint: "m = 1..5, n = 0..5",
    reset_table: "Reset",
    clear_table: "Clear",
    download_csv: "Download CSV",
    table_note: "If a cell is empty, the power is not available for that (m,n) pair.",
    results_title: "Results (all pairs)",
    no_calc: "No calculation",
    download_report: "Download report",
    copy_report: "Copy",
    author: "Author: <strong>François Bordas</strong> — <a href=\"mailto:francois.bordas@etu.univ-amu.fr\">francois.bordas@etu.univ-amu.fr</a>"
  }
};

function applyLang(lang){
  const dict = I18N[lang] || I18N.fr;
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    if (key === 'author') { el.innerHTML = dict[key]; return; }
    el.textContent = dict[key];
  });
}

function applyTheme(theme){
  // theme locked to dark
  document.body.setAttribute('data-theme','dark');
}

/* ---------- table par défaut (unchanged) ---------- */
const DEFAULT_TABLE = [
  [-29,  " -ref", -23, -10, -21, -19],
  [-85,  -61,    -73, -65, -71, -69],
  [-84,  -68,    -88, -81, -87, -78],
  [-114, -109,   -116, -115, -116, -115],
  [-119, -123,   -128, -126, -127, -128]
];

function buildFixedPowerTable(prefill = null){
  const tbl = document.getElementById('power_table');
  tbl.innerHTML = '';
  const header = document.createElement('tr');
  header.innerHTML = '<th style="width:66px">m \\ n</th>' + Array.from({length:6},(_,i)=>`<th style="width:64px">n=${i}</th>`).join('');
  tbl.appendChild(header);
  for (let r=0;r<5;r++){
    const tr = document.createElement('tr');
    const th = document.createElement('td'); th.textContent = `m=${r+1}`; tr.appendChild(th);
    for (let c=0;c<6;c++){
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type='text'; inp.className='mono';
      inp.style.width='64px';
      inp.style.boxSizing='border-box';
      inp.dataset.r = r; inp.dataset.c = c;
      if (prefill && prefill[r] && prefill[r][c] !== undefined && prefill[r][c] !== null){
        inp.value = String(prefill[r][c]);
      }
      td.appendChild(inp); tr.appendChild(td);
    }
    tbl.appendChild(tr);
  }
}

function parseFixedPowerTable(){
  const tbl = document.getElementById('power_table');
  const rows = Array.from(tbl.querySelectorAll('tr')).slice(1);
  const data = rows.map(tr => Array.from(tr.querySelectorAll('td input')).map(inp=>{
    const v = inp.value.trim();
    if (v === '') return null;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
    return null;
  }));
  return data;
}

function getPowerFromFixedTable(m,n,table){
  const im = Math.abs(m)-1;
  const inIdx = Math.abs(n);
  if (im < 0 || im >= 5 || inIdx < 0 || inIdx >= 6) return null;
  const val = table[im][inIdx];
  return (val === null) ? null : val;
}

function computeImageRange(params){
  if (params.mode === 'supradyne') return [params.ol + params.fi_min, params.ol + params.fi_max];
  return [params.ol - params.fi_max, params.ol - params.fi_min];
}

function computeRanges(params, table){
  const res = [];
  const {m_max, n_max, ol, fi_min, fi_max, rf_min, rf_max, mode} = params;
  for (let m = -m_max; m <= m_max; m++){
    for (let n = -n_max; n <= n_max; n++){
      if (m===0 && n===0) continue;
      let lo_c=null, hi_c=null;
      try {
        if (m===0){
          const FI = Math.abs(n * ol);
          if (!(FI >= fi_min && FI <= fi_max)) continue;
          lo_c = rf_min; hi_c = rf_max;
        } else if (n===0){
          const lo = fi_min / Math.abs(m);
          const hi = fi_max / Math.abs(m);
          const lo_sorted = Math.min(lo,hi), hi_sorted = Math.max(lo,hi);
          lo_c = Math.max(lo_sorted, rf_min);
          hi_c = Math.min(hi_sorted, rf_max);
          if (lo_c > hi_c) continue;
        } else {
          const rf1 = (fi_min - n*ol)/m;
          const rf2 = (fi_max - n*ol)/m;
          const lo = Math.min(rf1, rf2), hi = Math.max(rf1, rf2);
          lo_c = Math.max(lo, rf_min);
          hi_c = Math.min(hi, rf_max);
          if (lo_c > hi_c) continue;
        }
      } catch(e){ continue; }
      let label = 'spurious';
      if (m===0 || n===0) label = 'fuite';
      else if ((mode === 'supradyne' && m===-1 && n===1) || (mode==='infradyne' && m===1 && n===-1)) label='utile';
      else if ((mode === 'supradyne' && m===1 && n===-1) || (mode==='infradyne' && m===-1 && n===1)) label='image';
      const power = getPowerFromFixedTable(m,n,table);
      res.push({m,n,type:label,RF_min:Number(lo_c.toFixed(3)),RF_max:Number(hi_c.toFixed(3)),power});
    }
  }
  return res;
}

function sortSpurious(list, tableProvided){
  if (!Array.isArray(list)) return;
  if (tableProvided){
    list.sort((a,b)=>{
      const pa = (a.power===null||a.power===undefined)? Infinity : a.power;
      const pb = (b.power===null||b.power===undefined)? Infinity : b.power;
      if (pa !== pb) return pa - pb;
      const ca = Math.abs(a.m)+Math.abs(a.n), cb = Math.abs(b.m)+Math.abs(b.n);
      if (ca !== cb) return ca - cb;
      if (Math.abs(a.m)!==Math.abs(b.m)) return Math.abs(a.m)-Math.abs(b.m);
      return Math.abs(a.n)-Math.abs(b.n);
    });
  } else {
    list.sort((a,b)=>{
      const ca = Math.abs(a.m)+Math.abs(a.n), cb = Math.abs(b.m)+Math.abs(b.n);
      if (ca !== cb) return ca - cb;
      if (Math.abs(a.m)!==Math.abs(b.m)) return Math.abs(a.m)-Math.abs(b.m);
      return Math.abs(a.n)-Math.abs(b.n);
    });
  }
}

/* Render results into the right column (unchanged logic) */
function renderResults(){
  const rf_min = Number(document.getElementById('rf_min').value);
  const rf_max = Number(document.getElementById('rf_max').value);
  const ol = Number(document.getElementById('ol').value);
  const fi_min = Number(document.getElementById('fi_min').value);
  const fi_max = Number(document.getElementById('fi_max').value);
  let m_max = Number(document.getElementById('m_max').value);
  let n_max = Number(document.getElementById('n_max').value);
  m_max = Math.min(30, Math.max(0, Math.round(m_max)));
  n_max = Math.min(30, Math.max(0, Math.round(n_max)));
  const mode = document.getElementById('mode').value;
  if (!(rf_min < rf_max && fi_min < fi_max)) {
    document.getElementById('summary').innerHTML = '<span class="muted">Vérifier les plages RF et FI (min < max)</span>';
    document.getElementById('spurious_list').innerHTML = ''; return;
  }
  const tableRaw = parseFixedPowerTable();
  const tableProvided = tableRaw.some(r=>r.some(c=>c!==null));
  const params = {rf_min, rf_max, ol, fi_min, fi_max, m_max, n_max, mode};
  const results = computeRanges(params, tableRaw);
  const groups={utile:[],image:[],spurious:[],fuite:[]};
  results.forEach(r=> groups[r.type].push(r));
  sortSpurious(groups.spurious, tableProvided);
  const imrange = computeImageRange(params);

  document.getElementById('summary').innerHTML = `<div><strong>Total couples:</strong> ${results.length}</div>
    <div class="small">Utile: ${groups.utile.length} • Image: ${groups.image.length} • Spurious: ${groups.spurious.length} • Fuite: ${groups.fuite.length}</div>
    <div class="small">Plage image: ${imrange[0].toFixed(2)} — ${imrange[1].toFixed(2)} MHz (${mode})</div>`;

  const spDiv = document.getElementById('spurious_list'); spDiv.innerHTML='';
  // Spurious table
  if (groups.spurious.length===0) spDiv.innerHTML = '<div class="muted">Aucun spurious détecté</div>';
  else {
    const t = document.createElement('table');
    const showPowerCol = tableProvided;
    t.innerHTML = `<tr><th>m</th><th>n</th><th>RF_min (MHz)</th><th>RF_max (MHz)</th>${showPowerCol?'<th>power (dBc)</th>':''}</tr>`;
    groups.spurious.forEach(s=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.m}</td><td>${s.n}</td><td>${s.RF_min}</td><td>${s.RF_max}</td>${showPowerCol?`<td>${s.power==null?'':s.power}</td>`:''}`;
      t.appendChild(tr);
    });
    spDiv.appendChild(t);
  }

  // then the other groups (utile,image,fuite)
  const sec = document.createElement('div'); sec.style.marginTop='12px';
  ['utile','image','fuite'].forEach(k=>{
    const arr = groups[k];
    const block = document.createElement('div');
    block.innerHTML = `<strong>${k.toUpperCase()}</strong> (${arr.length})`;
    if (arr.length){
      const t=document.createElement('table');
      t.style.marginTop='6px';
      t.innerHTML = `<tr><th>m</th><th>n</th><th>RF_min</th><th>RF_max</th></tr>`;
      arr.forEach(s => { const tr=document.createElement('tr'); tr.innerHTML=`<td>${s.m}</td><td>${s.n}</td><td>${s.RF_min}</td><td>${s.RF_max}</td>`; t.appendChild(tr); });
      block.appendChild(t);
    }
    sec.appendChild(block);
  });
  spDiv.appendChild(sec);

  window._lastReport = {params, results, tableProvided};
}

/* report generation & download (unchanged) */
function generateReportText(){
  const last = window._lastReport;
  if (!last) return 'Aucun calcul disponible';
  const p = last.params; const results = last.results;
  const lines = [];
  lines.push('=== Spurious report ===');
  lines.push(`RF_range: ${p.rf_min} - ${p.rf_max} MHz`);
  lines.push(`OL: ${p.ol} MHz ; FI: ${p.fi_min} - ${p.fi_max} MHz ; mode: ${p.mode}`);
  lines.push('');
  lines.push('=== direct leak checks ===');
  if (p.ol >= p.fi_min && p.ol <= p.fi_max) lines.push("❌ OL DANS FI");
  else lines.push("✅ OL HORS FI");
  if (!(p.rf_max < p.fi_min || p.rf_min > p.fi_max)) lines.push("❌ RF chevauche FI");
  else lines.push("✅ RF hors FI");
  lines.push('');
  const grp={utile:[],image:[],spurious:[],fuite:[]};
  results.forEach(r=> grp[r.type].push(r));
  lines.push('=== Utile ==='); lines.push(`count ${grp.utile.length}`); grp.utile.forEach(u=>lines.push(`${u.m},${u.n},${u.RF_min},${u.RF_max}`));
  lines.push('');
  lines.push('=== Image ==='); lines.push(`count ${grp.image.length}`); grp.image.forEach(u=>lines.push(`${u.m},${u.n},${u.RF_min},${u.RF_max}`));
  lines.push('');
  lines.push('=== Spurious (triés) ==='); lines.push(`count ${grp.spurious.length}`); grp.spurious.forEach(s=>lines.push(`${s.m},${s.n},${s.RF_min},${s.RF_max},${s.power==null?'':s.power}`));
  lines.push('');
  return lines.join('');
}

function downloadReportAsFile(name='spurious_report.txt'){
  const txt = generateReportText();
  const blob = new Blob([txt], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ---------- UI interactions (updated wiring for instant updates + small UX niceties) ---------- */
function attachHandlers(){
  const ids = ['rf_min','rf_max','ol','fi_min','fi_max','m_max','n_max','mode'];
  // instant updates: directly call renderResults on input (no debounce) to keep calculations instant
  ids.forEach(id => { const el = document.getElementById(id); if(el) el.addEventListener('input', renderResults); });

  // table inputs: delegate input events so any change updates results immediately
  document.getElementById('power_table').addEventListener('input', (ev)=>{
    // mark empty inputs with visual hint
    const inp = ev.target; if (inp && inp.tagName === 'INPUT'){
      if (inp.value.trim() === '') inp.classList.add('missing-cell'); else inp.classList.remove('missing-cell');
    }
    renderResults();
  });

  // language selector (optionnel)
  const langSelect = document.getElementById('lang');
  if (langSelect) {
    langSelect.addEventListener('change', (ev) => {
      applyLang(ev.target.value);
    });
  }

  // always apply default language
  applyLang('fr');


  const themeSelect = document.getElementById('theme');
  if (themeSelect) {
    themeSelect.value = 'dark';
    themeSelect.disabled = true;
    // optional listener
    themeSelect.addEventListener('change', (ev) => {
      applyTheme(ev.target.value);
    });
  }

  // report buttons
  document.getElementById('download_report_right').addEventListener('click', ()=> downloadReportAsFile());
  document.getElementById('copy_report_right').addEventListener('click', ()=> {
    const txt = generateReportText();
    navigator.clipboard?.writeText(txt).then(()=> { const b=document.getElementById('copy_report_right'); b.textContent='Copié ✓'; setTimeout(()=> b.textContent='Copier',1200); }, ()=> alert('Échec copie'));
  });

  // PARAMS section buttons (only affect params)
  document.getElementById('reset_params').addEventListener('click', ()=> {
    document.getElementById('rf_min').value=6000; document.getElementById('rf_max').value=18000;
    document.getElementById('ol').value=10000; document.getElementById('fi_min').value=3500; document.getElementById('fi_max').value=4500;
    document.getElementById('m_max').value=3; document.getElementById('n_max').value=3; document.getElementById('mode').value='supradyne';
    renderResults();
  });

  document.getElementById('clear_params').addEventListener('click', ()=>{
    document.getElementById('rf_min').value=''; document.getElementById('rf_max').value='';
    document.getElementById('ol').value=''; document.getElementById('fi_min').value=''; document.getElementById('fi_max').value='';
    document.getElementById('m_max').value=''; document.getElementById('n_max').value=''; document.getElementById('mode').value='supradyne';
    renderResults();
  });

  // TABLE section buttons (only affect the power table)
  document.getElementById('reset_table').addEventListener('click', ()=>{ buildFixedPowerTable(DEFAULT_TABLE); renderResults(); highlightMissingCells(); });
  document.getElementById('clear_table').addEventListener('click', ()=>{ buildFixedPowerTable([[null,null,null,null,null,null],[null,null,null,null,null,null],[null,null,null,null,null,null],[null,null,null,null,null,null],[null,null,null,null,null,null]]); renderResults(); highlightMissingCells(); });

  document.getElementById('download_csv').addEventListener('click', ()=> {
    const table = parseFixedPowerTable();
    const header = ['n0','n1','n2','n3','n4','n5'];
    const lines = [header.join(',')].concat(table.map(r => r.map(v => (v===null? '' : v)).join(',')));
    const blob = new Blob([lines.join('')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='power_table.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  // visual nicety: highlight missing cells after initial build
  highlightMissingCells();
}

function highlightMissingCells(){
  const inputs = document.querySelectorAll('#power_table td input');
  inputs.forEach(inp=>{ if (inp.value.trim() === '') inp.classList.add('missing-cell'); else inp.classList.remove('missing-cell'); });
}

function debounce(fn, ms=200){ let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

/* init */
buildFixedPowerTable(DEFAULT_TABLE);
attachHandlers();
applyLang('fr');
applyTheme('dark');
renderResults();
