
const ta1 = document.getElementById('ta1');
const ta2 = document.getElementById('ta2');
const file1 = document.getElementById('file1');
const file2 = document.getElementById('file2');
const file1_top = document.getElementById('file1_top');
const file2_top = document.getElementById('file2_top');

const len1El = document.getElementById('len1');
const len2El = document.getElementById('len2');
const totalLines = document.getElementById('totalLines');
const diffCount = document.getElementById('diffCount');
const diffList = document.getElementById('diffList');
const col1 = document.getElementById('col1');
const col2 = document.getElementById('col2');

const autoToggleTop = document.getElementById('autoToggleTop');
const compareBtnTop = document.getElementById('compareBtnTop');
const copyBtnTop = document.getElementById('copyBtnTop');
const downloadBtnTop = document.getElementById('downloadBtnTop');
const resetBtnTop = document.getElementById('resetBtnTop');

const copyDiff = document.getElementById('copyDiff');
const downloadDiff = document.getElementById('downloadDiff');

/* ---------- state ---------- */
let autoCompare = true;
let ignoreScroll = false;

/* ---------- helpers ---------- */
function readFileInput(input, targetTextarea){
  const f = input.files && input.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    targetTextarea.value = String(e.target.result).replace(/\r\n/g, '\n');
    updateLineCounts();
    if (autoCompare) debounceCompare();
  };
  reader.readAsText(f, 'utf-8');
}
[file1, file1_top].forEach(el => el.addEventListener('change', ()=> readFileInput(el, ta1)));
[file2, file2_top].forEach(el => el.addEventListener('change', ()=> readFileInput(el, ta2)));

function splitLines(text){
  return String(text === undefined || text === null ? '' : text).replace(/\r\n/g,'\n').split('\n');
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ---------- render / compare ---------- */
function updateLineCounts(){
  const l1 = splitLines(ta1.value).length;
  const l2 = splitLines(ta2.value).length;
  len1El.textContent = l1;
  len2El.textContent = l2;
}

function renderComparison(){
  const lines1 = splitLines(ta1.value);
  const lines2 = splitLines(ta2.value);
  const maxLen = Math.max(lines1.length, lines2.length);
  col1.innerHTML = '';
  col2.innerHTML = '';
  const diffs = [];

  for (let i=0;i<maxLen;i++){
    const l1 = (i < lines1.length) ? lines1[i] : '<-- ligne absente -->';
    const l2 = (i < lines2.length) ? lines2[i] : '<-- ligne absente -->';
    const isDiff = l1 !== l2;

    if (isDiff) diffs.push(i+1);

    // left
    const d1 = document.createElement('div');
    d1.className = 'line ' + (isDiff ? (i >= lines2.length ? 'add' : 'diff') : 'same') + (i >= lines1.length ? ' missing' : '');
    d1.dataset.line = i+1;
    d1.innerHTML = `<div class="ln">${i+1}</div><div class="lc">${escapeHtml(l1)}</div>`;
    col1.appendChild(d1);

    // right
    const d2 = document.createElement('div');
    d2.className = 'line ' + (isDiff ? (i >= lines1.length ? 'add' : 'diff') : 'same') + (i >= lines2.length ? ' missing' : '');
    d2.dataset.line = i+1;
    d2.innerHTML = `<div class="ln">${i+1}</div><div class="lc">${escapeHtml(l2)}</div>`;
    col2.appendChild(d2);
  }

  totalLines.textContent = `Lignes : ${lines1.length} / ${lines2.length}`;
  diffCount.textContent = `Différences : ${diffs.length}`;
  renderDiffList(diffs);
  return diffs;
}

function renderDiffList(diffs){
  diffList.innerHTML = '';
  if (!diffs.length){
    diffList.textContent = 'Aucune différence';
    return;
  }
  diffs.forEach(n => {
    const b = document.createElement('button');
    b.textContent = `L ${n}`;
    b.addEventListener('click', ()=> scrollToLine(n));
    diffList.appendChild(b);
  });
}

/* ---------- scroll sync & navigate ---------- */
function syncScroll(source, target){
  if (ignoreScroll) return;
  ignoreScroll = true;
  target.scrollTop = source.scrollTop;
  setTimeout(()=> ignoreScroll = false, 40);
}
col1.addEventListener('scroll', ()=> syncScroll(col1, col2));
col2.addEventListener('scroll', ()=> syncScroll(col2, col1));

function scrollToLine(n){
  const el1 = col1.querySelector('.line[data-line="'+n+'"]');
  const el2 = col2.querySelector('.line[data-line="'+n+'"]');
  if (el1){
    const offset = el1.offsetTop - col1.clientHeight/2 + el1.clientHeight/2;
    col1.scrollTop = Math.max(0, offset);
  }
  if (el2){
    const offset = el2.offsetTop - col2.clientHeight/2 + el2.clientHeight/2;
    col2.scrollTop = Math.max(0, offset);
  }
  // highlight flash
  [el1, el2].forEach(el => {
    if (!el) return;
    el.style.transition = 'box-shadow .25s ease';
    el.style.boxShadow = '0 0 0 4px rgba(255,255,255,0.06)';
    setTimeout(()=> el.style.boxShadow = '', 350);
  });
}

/* ---------- compare triggers ---------- */
let debounceTimer = null;
function debounceCompare(){ if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(()=> { compareNow(); debounceTimer = null; }, 200); }

function compareNow(){
  updateLineCounts();
  const diffs = renderComparison();
  return diffs;
}

/* ---------- UI events ---------- */
ta1.addEventListener('input', ()=> { updateLineCounts(); if (autoCompare) debounceCompare(); });
ta2.addEventListener('input', ()=> { updateLineCounts(); if (autoCompare) debounceCompare(); });

compareBtnTop.addEventListener('click', ()=> compareNow());
resetBtnTop.addEventListener('click', ()=> {
  ta1.value = ''; ta2.value = '';
  col1.innerHTML = ''; col2.innerHTML = ''; diffList.innerHTML = '';
  len1El.textContent = '0'; len2El.textContent = '0';
  totalLines.textContent = 'Lignes : 0 / 0'; diffCount.textContent = 'Différences : 0';
});

autoToggleTop.addEventListener('click', ()=> {
  autoCompare = !autoCompare;
  autoToggleTop.textContent = `Auto: ${autoCompare ? 'ON' : 'OFF'}`;
  autoToggleTop.classList.toggle('ghost', !autoCompare);
});

/* file inputs (top and per-editor are wired to same handlers above) */
[file1, file1_top].forEach(el => el.addEventListener('change', ()=> readFileInput(el, ta1)));
[file2, file2_top].forEach(el => el.addEventListener('change', ()=> readFileInput(el, ta2)));

/* copy & download summary */
function buildDiffSummary(){
  const lines1 = splitLines(ta1.value);
  const lines2 = splitLines(ta2.value);
  const maxLen = Math.max(lines1.length, lines2.length);
  let out = '';
  let differences = 0;
  for (let i=0;i<maxLen;i++){
    const l1 = (i<lines1.length) ? lines1[i] : '<-- ligne absente -->';
    const l2 = (i<lines2.length) ? lines2[i] : '<-- ligne absente -->';
    if (l1 !== l2){
      differences++;
      out += `\nLigne ${i+1} :\n  Fichier1.txt | ${l1}\n  Fichier2.txt | ${l2}\n`;
    }
  }
  if (differences === 0) out = '✅ Aucun écart : les deux textes sont identiques.\n';
  out += `\nNombre total de lignes différentes : ${differences}\n`;
  return out;
}

copyBtnTop.addEventListener('click', ()=> {
  const txt = buildDiffSummary();
  navigator.clipboard?.writeText(txt).then(()=> alert('Diff copié dans le presse-papier.'), ()=> alert('Impossible de copier.'));
});
copyDiff.addEventListener('click', ()=> copyBtnTop.click());

downloadBtnTop.addEventListener('click', ()=> {
  const content = buildDiffSummary();
  const blob = new Blob([content], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'diff_results.txt'; document.body.appendChild(a); a.click();
  setTimeout(()=> { URL.revokeObjectURL(url); a.remove(); }, 500);
});
downloadDiff.addEventListener('click', ()=> downloadBtnTop.click());

/* ---------- init demo content ---------- */
ta1.value = `Ligne identique
Une ligne différente A
Ligne commune 3
Ligne commune 4
Fin A`;
ta2.value = `Ligne identique
Une ligne différente B
Ligne commune 3
Ligne commune 4
Fin B
Ligne supplémentaire 6`;
updateLineCounts();
compareNow();
