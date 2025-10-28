// ../javascript/surface_calculator.js
// Surface Calculator - final fix
// - computeBottomInstant recalculates continuellement selon le dernier champ édité
// - removal des boutons "copier" dans le résumé
// - normalisations existantes, preview SVG inchangé

document.addEventListener('DOMContentLoaded', () => {

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const els = {
    componentsList: $('#componentsList'),
    btnAddComp: $('#btnAddComp'),
    btnRemoveLast: $('#btnRemoveLast'),
    btnClearAll: $('#btnClearAll'),
    btnLoadExample: $('#btnLoadExample'),
    btnImport: $('#btnImport'),
    btnExport: $('#btnExport'),
    btnDownloadExample: $('#btnDownloadExample'),
    fileInput: $('#yamlFileInput'),
    status: $('#statusYaml'),

    // summary
    summaryTableBody: $('#summaryTable tbody'),
    totalSurfaceEl: $('#totalSurface'),
    unitSurfaceEl: $('#unitSurface'),

    // calculator bottom
    inputTargetSurface: $('#inputTargetSurface'),
    fixL: $('#fixL'),
    fixl: $('#fixl'),
    btnResetAdapt: $('#btnResetAdapt'),

    // preview
    previewCanvas: $('#previewCanvas'),
    previewL: $('#previewL'),
    previewl: $('#previewl')
  };

  function setStatus(msg, t = 1800) {
    if (!els.status) return;
    els.status.textContent = msg;
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => { if (els.status) els.status.textContent = ''; }, t);
  }

  function round(v, d = 2) {
    if (!isFinite(v)) return v;
    const p = Math.pow(10, d);
    return Math.round((v + Number.EPSILON) * p) / p;
  }

  function escapeHtml(s) {
    if (!s && s !== 0) return '';
    return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  }

  /* state */
  let components = [];
  let lastEdited = null; // 'L' | 'l' | 'target' | null

  const defaultComp = i => ({ name: `Comp ${i + 1}`, L: 5.0, l: 3.0, crown: 1.0, qty: 1 });

  /* calculations */
  function computeSurfaces() {
    const rows = [];
    let total = 0;
    for (const c of components) {
      const Lnum = Number(c.L || 0);
      const lnum = Number(c.l || 0);
      const crown = Number(c.crown || 0);
      const Ltot = Lnum + crown;
      const ltot = lnum + crown;
      const unit = Ltot * ltot;
      const totComp = unit * (Number(c.qty) || 1);
      rows.push({ ...c, Ltot, ltot, unit, totComp });
      total += totComp;
    }
    return { rows, total };
  }

  function formatNum(v) {
    if (!isFinite(v)) return '—';
    return round(v, 2).toLocaleString();
  }

  /* render summary (minimal) - NO copy button */
  /* render summary (minimal) - NO copy button + total qty */
  function renderSummary() {
    const res = computeSurfaces();
    const tbody = els.summaryTableBody;
    tbody.innerHTML = '';

    res.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td style="text-align:left;padding-left:8px">${escapeHtml(r.name)}</td>
        <td>${formatNum(r.crown)}</td>
        <td>${r.qty}</td>
        <td>${formatNum(r.totComp)} mm²</td>
      `;
      tbody.appendChild(tr);
    });

    // total surface
    const totalSurfaceText = res.rows.length ? `${formatNum(res.total)} mm²` : '— mm²';
    els.totalSurfaceEl && (els.totalSurfaceEl.textContent = totalSurfaceText);

    // total qty (somme des qty)
    const totalQty = res.rows.reduce((acc, rr) => acc + (Number(rr.qty) || 0), 0);
    const totalQtyText = res.rows.length ? totalQty.toLocaleString() : '—';
    const totalQtyEl = document.getElementById('totalQty') || null;
    if (totalQtyEl) totalQtyEl.textContent = totalQtyText;
    else {
      // si l'élément n'existe pas, on le crée discrètement dans le DOM (optionnel)
      // console.warn('Element #totalQty not found — ignore or add it to HTML to display total quantity.');
    }

    // unit surface (optional element) and dataset for calculator fallback
    els.unitSurfaceEl && (els.unitSurfaceEl.textContent = res.rows.length ? `${formatNum(res.rows[0].unit)} mm²` : '— mm²');
    document.body.dataset.totalSurface = String(res.total || 0);
  }


  /* components list creation */
  function makeRowElement(data, idx) {
    const row = document.createElement('div');
    row.className = 'component-row';
    row.dataset.index = idx;
    row.innerHTML = `
      <div class="idx">${idx + 1}</div>
      <input class="c_name" type="text" placeholder="Ex: R_0805">
      <input class="c_L" type="number" min="0" step="0.01" placeholder="Longueur (mm)">
      <input class="c_l" type="number" min="0" step="0.01" placeholder="Largeur (mm)">
      <input class="c_crown" type="number" min="0" step="0.01" placeholder="Couronne (mm)">
      <input class="c_qty" type="number" min="1" step="1" placeholder="Qté">
      <div style="display:flex;gap:6px;justify-content:center">
        <button class="delete-row" title="Supprimer" aria-label="Supprimer la ligne">✕</button>
      </div>
    `;

    const nameEl = row.querySelector('.c_name');
    const LEl = row.querySelector('.c_L');
    const lEl = row.querySelector('.c_l');
    const crownEl = row.querySelector('.c_crown');
    const qtyEl = row.querySelector('.c_qty');

    nameEl.value = data.name ?? '';
    LEl.value = (data.L !== undefined && data.L !== null) ? data.L : '';
    lEl.value = (data.l !== undefined && data.l !== null) ? data.l : '';
    crownEl.value = (data.crown !== undefined && data.crown !== null) ? data.crown : '';
    qtyEl.value = data.qty ?? 1;

    const updateState = debounce(() => {
      const i = Number(row.dataset.index);
      if (!Number.isFinite(i) || i < 0 || i >= components.length) return;
      components[i].name = nameEl.value.trim() || `Comp ${i + 1}`;
      components[i].L = Math.max(0, parseFloat(LEl.value) || 0);
      components[i].l = Math.max(0, parseFloat(lEl.value) || 0);
      components[i].crown = Math.max(0, parseFloat(crownEl.value) || 0);
      components[i].qty = Math.max(1, Math.floor(Math.abs(parseInt(qtyEl.value, 10) || 1)));
      renderSummary();
    }, 150);

    [nameEl, LEl, lEl, crownEl, qtyEl].forEach(inp => inp.addEventListener('input', () => updateState()));

    row.querySelector('.delete-row').addEventListener('click', () => {
      const i = Number(row.dataset.index);
      if (!Number.isFinite(i)) return;
      components.splice(i, 1);
      renderComponentsList();
      renderSummary();
      requestAnimationFrame(() => { els.componentsList.querySelector('.component-row .c_name')?.focus(); });
      setStatus('Composant supprimé');
    });

    return row;
  }

  function renderComponentsList() {
    els.componentsList.innerHTML = '';
    components.forEach((c, idx) => els.componentsList.appendChild(makeRowElement(c, idx)));
  }

  /* actions */
  function addComponent(data) {
    components.push(Object.assign({}, defaultComp(components.length), (data || {})));
    renderComponentsList();
    renderSummary();
    requestAnimationFrame(() => els.componentsList.querySelector('.component-row:last-child .c_name')?.focus());
  }

  function removeLast() {
    if (!components.length) return;
    components.pop();
    renderComponentsList();
    renderSummary();
  }

  function clearAll() {
    if (!confirm('Réinitialiser tous les composants ?')) return;
    components = [];
    renderComponentsList();
    renderSummary();
    setStatus('Réinitialisé');
  }

  /* ---------- computeBottomInstant with lastEdited logic ---------- */
  function computeBottomInstant() {
    const targetStr = String(els.inputTargetSurface.value ?? '').trim();
    const Lstr = String(els.fixL.value ?? '').trim();
    const lStr = String(els.fixl.value ?? '').trim();

    const targetVal = (targetStr === '') ? NaN : Number(targetStr);
    const Lval = (Lstr === '') ? NaN : Number(Lstr);
    const lVal = (lStr === '') ? NaN : Number(lStr);

    const targetDefined = isFinite(targetVal) && targetVal > 0;
    const Ldefined = isFinite(Lval) && Lval > 0;
    const ldefined = isFinite(lVal) && lVal > 0;

    // fallback to totalSurface if target empty
    let target = NaN;
    if (targetDefined) target = targetVal;
    else {
      const ds = document.body.dataset.totalSurface || '0';
      target = Number(ds);
      if (!isFinite(target)) {
        const cleaned = String(ds).replace(/[^\d\.\-eE]/g, '');
        target = parseFloat(cleaned) || 0;
      }
    }

    // nothing meaningful to do
    if (!Ldefined && !ldefined && !targetDefined) {
      updatePreview(null, null);
      return;
    }

    // If target present -> prefer keeping surface constant: lastEdited is source
    if (isFinite(target) && target > 0) {
      // if only L provided -> compute l
      if (Ldefined && !ldefined) {
        if (Lval <= 0) { setStatus('L invalide'); return; }
        const newl = target / Lval;
        if (!isFinite(newl) || newl <= 0) { setStatus('Pas possible'); return; }
        const newl_r = round(newl, 3);
        // write computed value (programmatic set does NOT fire input), update preview
        els.fixl.value = newl_r;
        updatePreview(Lval, newl_r);
        setStatus('l calculé automatiquement (mm)');
        return;
      }

      // if only l provided -> compute L
      if (ldefined && !Ldefined) {
        if (lVal <= 0) { setStatus('l invalide'); return; }
        const newL = target / lVal;
        if (!isFinite(newL) || newL <= 0) { setStatus('Pas possible'); return; }
        const newL_r = round(newL, 3);
        els.fixL.value = newL_r;
        updatePreview(newL_r, lVal);
        setStatus('L calculé automatiquement (mm)');
        return;
      }

      // if both provided -> adjust the one NOT edited to keep surface
      if (Ldefined && ldefined) {
        if (!lastEdited) {
          // default behaviour: treat L as source (i.e., recompute l)
          const newl = target / Lval;
          if (isFinite(newl) && newl > 0) {
            const newl_r = round(newl, 3);
            els.fixl.value = newl_r;
            updatePreview(Lval, newl_r);
            setStatus('l ajusté pour conserver la surface (mm)');
            return;
          }
        } else if (lastEdited === 'L') {
          // L edited -> recompute l
          const newl = target / Lval;
          if (!isFinite(newl) || newl <= 0) { setStatus('Impossible d\'ajuster l'); return; }
          const newl_r = round(newl, 3);
          els.fixl.value = newl_r;
          updatePreview(Lval, newl_r);
          setStatus('l ajusté pour conserver la surface (mm)');
          return;
        } else if (lastEdited === 'l') {
          // l edited -> recompute L
          const newL = target / lVal;
          if (!isFinite(newL) || newL <= 0) { setStatus('Impossible d\'ajuster L'); return; }
          const newL_r = round(newL, 3);
          els.fixL.value = newL_r;
          updatePreview(newL_r, lVal);
          setStatus('L ajusté pour conserver la surface (mm)');
          return;
        } else if (lastEdited === 'target') {
          // if target just edited, keep L as source and recompute l
          const newl = target / Lval;
          if (isFinite(newl) && newl > 0) {
            const newl_r = round(newl, 3);
            els.fixl.value = newl_r;
            updatePreview(Lval, newl_r);
            setStatus('l ajusté pour nouvelle surface (mm)');
            return;
          }
        }
      }
    }

    // If target not defined (or fallback) and both L & l defined -> compute surface
    if (Ldefined && ldefined) {
      const surf = Lval * lVal;
      const surf_r = round(surf, 3);
      if (targetStrEmpty(els.inputTargetSurface)) {
        els.inputTargetSurface.value = surf_r;
        setStatus(`Surface calculée (${surf_r} mm²)`);
      } else {
        setStatus(`Surface = ${surf_r} mm²`);
      }
      updatePreview(Lval, lVal);
      return;
    }

    // otherwise just update preview with available dimension
    updatePreview(Ldefined ? Lval : null, ldefined ? lVal : null);
  }

  function targetStrEmpty(inputEl) {
    const s = String(inputEl.value ?? '').trim();
    return s === '';
  }

  function resetAdapt() {
    els.inputTargetSurface.value = '';
    els.fixL.value = '';
    els.fixl.value = '';
    updatePreview(null, null);
    setStatus('Calculateur réinitialisé');
  }


    /* -------------------------
     SVG Preview (animated rectangle) + labels L / l
     - remplace l'ancien bloc SVG
  ------------------------- */
  const svg = els.previewCanvas;
  const svgNS = 'http://www.w3.org/2000/svg';

  let animRect = null;
  let borderRect = null;
  let labelTop = null;   // affiche L (au-dessus, centré)
  let labelRight = null; // affiche l (à droite, centré)

  // état d'animation et données courantes de preview (valeurs en mm)
  let animState = { x: 0, y: 0, w: 60, h: 40 };
  let targetState = { x: 0, y: 0, w: 60, h: 40 };
  let previewDims = { L: NaN, l: NaN }; // stocke les dernières valeurs mm pour les labels
  let rafId = null;

  (function setupSVG() {
    if (!svg) return;
    svg.innerHTML = '';

    // ensure viewBox exists (fallback to client size)
    try {
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (!vb || !isFinite(vb.width) || !isFinite(vb.height) || vb.width === 0 || vb.height === 0) {
        const w = Math.max(320, svg.clientWidth || 320);
        const h = Math.max(160, svg.clientHeight || 160);
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
    } catch (e) {
      const w = Math.max(320, svg.clientWidth || 320);
      const h = Math.max(160, svg.clientHeight || 160);
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    const vbNow = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : { width: svg.clientWidth || 320, height: svg.clientHeight || 160 };
    const viewW = isFinite(vbNow.width) ? vbNow.width : (svg.clientWidth || 320);
    const viewH = isFinite(vbNow.height) ? vbNow.height : (svg.clientHeight || 160);

    // --- NOTE: we intentionally DO NOT create a border rect here ---
    // This avoids the "fixed" rectangle; only the animated rect will be present.

    // animated rectangle (unique)
    animRect = document.createElementNS(svgNS, 'rect');
    animRect.setAttribute('rx', '4');
    animRect.setAttribute('ry', '4');
    animRect.setAttribute('fill', 'rgba(74,163,224,0.16)');
    animRect.setAttribute('stroke', 'rgba(74,163,224,0.72)');
    animRect.setAttribute('stroke-width', '1.2');
    svg.appendChild(animRect);

    // label top (L) - centered above rect
    labelTop = document.createElementNS(svgNS, 'text');
    labelTop.setAttribute('fill', '#e6eef6');
    labelTop.setAttribute('font-size', '12');
    labelTop.setAttribute('font-weight', '600');
    labelTop.setAttribute('text-anchor', 'middle');
    labelTop.setAttribute('dominant-baseline', 'alphabetic');
    svg.appendChild(labelTop);

    // label right (l) - to the right of rect, vertically centered
    labelRight = document.createElementNS(svgNS, 'text');
    labelRight.setAttribute('fill', '#e6eef6');
    labelRight.setAttribute('font-size', '12');
    labelRight.setAttribute('font-weight', '600');
    labelRight.setAttribute('text-anchor', 'start');
    labelRight.setAttribute('dominant-baseline', 'middle');
    svg.appendChild(labelRight);

    // initial centered sizes
    const margin = 24;
    const initialW = Math.max(40, Math.min(160, viewW - margin * 2));
    const initialH = Math.max(24, Math.min(96, viewH - margin * 2));
    const cx = (viewW - initialW) / 2;
    const cy = (viewH - initialH) / 2;
    targetState = { x: cx, y: cy, w: initialW, h: initialH };
    animState = { ...targetState };

    // set initial attributes safely
    animRect.setAttribute('x', String(Number(animState.x || 0)));
    animRect.setAttribute('y', String(Number(animState.y || 0)));
    animRect.setAttribute('width', String(Math.max(1, Number(animState.w || 1))));
    animRect.setAttribute('height', String(Math.max(1, Number(animState.h || 1))));

    // initial labels empty
    labelTop.textContent = '';
    labelRight.textContent = '';
  })();


  // RAF loop + update labels positions
  function ensureAnimLoop() {
    if (rafId || !animRect) return;
    function loop() {
      const ease = 0.18;
      animState.x = Number(animState.x || 0) + (Number(targetState.x || 0) - Number(animState.x || 0)) * ease;
      animState.y = Number(animState.y || 0) + (Number(targetState.y || 0) - Number(animState.y || 0)) * ease;
      animState.w = Number(animState.w || 0) + (Number(targetState.w || 0) - Number(animState.w || 0)) * ease;
      animState.h = Number(animState.h || 0) + (Number(targetState.h || 0) - Number(animState.h || 0)) * ease;

      // sanitize
      const sx = isFinite(animState.x) ? animState.x : 0;
      const sy = isFinite(animState.y) ? animState.y : 0;
      const sw = isFinite(animState.w) ? Math.max(1, animState.w) : 1;
      const sh = isFinite(animState.h) ? Math.max(1, animState.h) : 1;

      animRect.setAttribute('x', String(sx));
      animRect.setAttribute('y', String(sy));
      animRect.setAttribute('width', String(sw));
      animRect.setAttribute('height', String(sh));

      // update labels content & positions using previewDims
      // top label: centered above rect
      const topX = sx + sw / 2;
      const topY = sy - 6; // 6px above rect
      const Ltxt = isFinite(previewDims.L) ? `${round(previewDims.L, 2)} mm` : '— mm';
      labelTop.textContent = `L = ${Ltxt}`;
      labelTop.setAttribute('x', String(topX));
      labelTop.setAttribute('y', String(topY));

      // right label: to the right, centered vertically
      const rightX = sx + sw + 8; // small gap
      const rightY = sy + sh / 2;
      const ltxt = isFinite(previewDims.l) ? `${round(previewDims.l, 2)} mm` : '— mm';
      labelRight.textContent = `l = ${ltxt}`;
      labelRight.setAttribute('x', String(rightX));
      labelRight.setAttribute('y', String(rightY));

      // stop condition
      const close = Math.abs(Number(targetState.x || 0) - sx) < 0.5 &&
                    Math.abs(Number(targetState.y || 0) - sy) < 0.5 &&
                    Math.abs(Number(targetState.w || 0) - sw) < 0.5 &&
                    Math.abs(Number(targetState.h || 0) - sh) < 0.5;

      if (!close) {
        rafId = requestAnimationFrame(loop);
      } else {
        // snap exactly and clear rafId
        animState = { x: Number(targetState.x || 0), y: Number(targetState.y || 0), w: Math.max(1, Number(targetState.w || 1)), h: Math.max(1, Number(targetState.h || 1)) };
        animRect.setAttribute('x', String(animState.x));
        animRect.setAttribute('y', String(animState.y));
        animRect.setAttribute('width', String(animState.w));
        animRect.setAttribute('height', String(animState.h));

        // final label snap
        labelTop.setAttribute('x', String(animState.x + animState.w / 2));
        labelTop.setAttribute('y', String(animState.y - 6));
        labelRight.setAttribute('x', String(animState.x + animState.w + 8));
        labelRight.setAttribute('y', String(animState.y + animState.h / 2));

        rafId = null;
      }
    }
    rafId = requestAnimationFrame(loop);
  }

  // updatePreview sets previewDims (L,l) and targetState, then lance l'anim
  function updatePreview(L, l) {
    // update textual preview outside svg
    els.previewL && (els.previewL.textContent = (isFinite(L) ? `${round(L, 2)} mm` : '— mm'));
    els.previewl && (els.previewl.textContent = (isFinite(l) ? `${round(l, 2)} mm` : '— mm'));

    // store numeric dims for labels
    previewDims.L = isFinite(L) ? Number(L) : NaN;
    previewDims.l = isFinite(l) ? Number(l) : NaN;

    if (!svg || !animRect) return;

    const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
    const viewW = vb && isFinite(vb.width) ? vb.width : (svg.clientWidth || 320);
    const viewH = vb && isFinite(vb.height) ? vb.height : (svg.clientHeight || 160);
    const margin = 24;

    if (!isFinite(previewDims.L) && !isFinite(previewDims.l)) {
      const w = Math.max(40, Math.min(140, viewW - margin * 2));
      const h = Math.max(24, Math.min(96, viewH - margin * 2));
      const x = (viewW - w) / 2;
      const y = (viewH - h) / 2;
      targetState = { x, y, w, h };
      ensureAnimLoop();
      return;
    }

    let Lval = isFinite(previewDims.L) ? previewDims.L : (isFinite(previewDims.l) ? previewDims.l : 10);
    let lval = isFinite(previewDims.l) ? previewDims.l : (isFinite(previewDims.L) ? previewDims.L : 10);

    // clamp ratio
    const ratio = Lval / Math.max(1e-6, lval);
    const maxRatio = 6;
    if (ratio > maxRatio) Lval = lval * maxRatio;
    if (ratio < 1 / maxRatio) lval = Lval * maxRatio;

    const availableW = Math.max(40, viewW - margin * 2);
    const availableH = Math.max(24, viewH - margin * 2);
    const scale = Math.min(availableW / Math.max(1e-6, Lval), availableH / Math.max(1e-6, lval));
    let wpx = Math.max(12, Lval * scale);
    let hpx = Math.max(8, lval * scale);

    if (!isFinite(wpx) || wpx <= 0) wpx = Math.max(12, Math.min(availableW, 60));
    if (!isFinite(hpx) || hpx <= 0) hpx = Math.max(8, Math.min(availableH, 40));

    const x = (viewW - wpx) / 2;
    const y = (viewH - hpx) / 2;

    targetState = { x, y, w: wpx, h: hpx };
    ensureAnimLoop();
  }









  /* import / export */
  function exportYAML() {
    try {
      const res = computeSurfaces();
      const payload = {
        meta: { exportedAt: (new Date()).toISOString(), tool: 'surface_calculator' },
        components,
        computed: { total_mm2: res.total }
      };
      const yaml = jsyaml.dump(payload, { noRefs: true, sortKeys: false });
      const blob = new Blob([yaml], { type: 'text/yaml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'surface_export.yaml';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 600);
      setStatus('Export YAML téléchargé');
    } catch (e) {
      console.error(e);
      alert('Erreur lors de l\'export YAML');
    }
  }

  function downloadExampleYAML() {
    const example = {
      meta: { note: 'Exemple de fichier pour Surface Calculator' },
      components: [
        { name: 'R_0805', L: 2.0, l: 1.25, crown: 0.5, qty: 10 },
        { name: 'C_0603', L: 1.6, l: 0.8, crown: 0.5, qty: 15 },
        { name: 'U_QFN', L: 5.0, l: 5.0, crown: 1.0, qty: 1 }
      ]
    };
    const yaml = jsyaml.dump(example, { noRefs: true, sortKeys: false });
    const blob = new Blob([yaml], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'surface_example.yaml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 600);
    setStatus('Exemple YAML téléchargé');
  }

  function openImportDialog() {
    if (!els.fileInput) { alert('Aucun input de fichier disponible'); return; }
    els.fileInput.onchange = (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const allowed = /\.(ya?ml|json)$/i.test(f.name);
      if (!allowed) { setStatus('Fichier non supporté (YAML/JSON seulement)', 2200); els.fileInput.value = ''; return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        const txt = e.target.result;
        try {
          let obj;
          try { obj = JSON.parse(txt); } catch (_) { obj = jsyaml.load(txt); }
          handleImportedObject(obj);
        } catch (err) {
          console.error(err);
          alert('Fichier non reconnu (JSON ou YAML attendu)');
        }
      };
      reader.readAsText(f, 'utf-8');
      els.fileInput.value = '';
    };
    els.fileInput.click();
  }

  function handleImportedObject(obj) {
    if (!obj) { alert('Fichier vide'); return; }
    if (Array.isArray(obj.components)) {
      components = obj.components.map((c, i) => normalizeComp(c, i));
      renderComponentsList(); renderSummary(); setStatus('Fichier importé (components)'); return;
    }
    if (Array.isArray(obj)) {
      components = obj.map((c, i) => normalizeComp(c, i));
      renderComponentsList(); renderSummary(); setStatus('Fichier importé (array)'); return;
    }
    if (obj.computed && Array.isArray(obj.computed.perComponent)) {
      components = obj.computed.perComponent.map((c, i) => normalizeComp(c, i));
      renderComponentsList(); renderSummary(); setStatus('Fichier importé (computed)'); return;
    }
    alert('Structure du fichier non reconnue');
  }

  function normalizeComp(c, idx) {
    return {
      name: (c.name || c.nom || `Comp ${idx + 1}`).toString(),
      L: Math.max(0, Number(c.L !== undefined ? c.L : (c.longueur !== undefined ? c.longueur : 0)) || 0),
      l: Math.max(0, Number(c.l !== undefined ? c.l : (c.largeur !== undefined ? c.largeur : 0)) || 0),
      crown: Math.max(0, Number(c.crown !== undefined ? c.crown : (c.couronne !== undefined ? c.couronne : 0)) || 0),
      qty: Math.max(1, Number(c.qty !== undefined ? c.qty : (c.quantity !== undefined ? c.quantity : 1)) || 1)
    };
  }

  function debounce(fn, wait = 120) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  /* events wiring */
  els.btnImport && els.btnImport.addEventListener('click', openImportDialog);
  els.btnExport && els.btnExport.addEventListener('click', exportYAML);
  els.btnDownloadExample && els.btnDownloadExample.addEventListener('click', downloadExampleYAML);

  els.btnAddComp && els.btnAddComp.addEventListener('click', () => addComponent());
  els.btnRemoveLast && els.btnRemoveLast.addEventListener('click', () => removeLast());
  els.btnClearAll && els.btnClearAll.addEventListener('click', () => clearAll());
  els.btnLoadExample && els.btnLoadExample.addEventListener('click', () => {
    components = [
      { name: 'R_0805', L: 2.0, l: 1.25, crown: 0.5, qty: 10 },
      { name: 'C_0603', L: 1.6, l: 0.8, crown: 0.5, qty: 15 },
      { name: 'U_QFN', L: 5.0, l: 5.0, crown: 1.0, qty: 1 }
    ];
    renderComponentsList(); renderSummary(); setStatus('Exemple chargé');
  });

  // set lastEdited on input events and trigger compute
  const computeBottomDebounced = debounce(() => computeBottomInstant(), 100);
  els.inputTargetSurface && els.inputTargetSurface.addEventListener('input', () => { lastEdited = 'target'; computeBottomDebounced(); });
  els.fixL && els.fixL.addEventListener('input', () => { lastEdited = 'L'; computeBottomDebounced(); });
  els.fixl && els.fixl.addEventListener('input', () => { lastEdited = 'l'; computeBottomDebounced(); });
  els.btnResetAdapt && els.btnResetAdapt.addEventListener('click', resetAdapt);

  // drag & drop
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    if (!e.dataTransfer?.files?.length) return;
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (!/\.(ya?ml|json)$/i.test(f.name)) { setStatus('Fichier déposé non supporté (YAML/JSON seulement)', 2000); return; }
    const r = new FileReader();
    r.onload = ev => {
      const txt = ev.target.result;
      try {
        let obj;
        try { obj = JSON.parse(txt); } catch { obj = jsyaml.load(txt); }
        handleImportedObject(obj);
      } catch (err) {
        console.error(err);
        setStatus('Fichier déposé non reconnu', 2200);
      }
    };
    r.readAsText(f, 'utf-8');
  });

  // resize svg handling
  window.addEventListener('resize', () => {
    if (!svg) return;
    const border = svg.querySelector('rect');
    if (border) {
      const w = svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : svg.clientWidth;
      const h = svg.viewBox.baseVal && svg.viewBox.baseVal.height ? svg.viewBox.baseVal.height : svg.clientHeight;
      border.setAttribute('width', Math.max(0, w - 8));
      border.setAttribute('height', Math.max(0, h - 8));
    }
    computeBottomInstant();
  });

  /* init */
  if (!components.length) {
    components = [
      { name: 'R_1206', L: 3.2, l: 1.6, crown: 0.5, qty: 5 },
      { name: 'C_0805', L: 2.0, l: 1.25, crown: 0.5, qty: 8 }
    ];
  }
  renderComponentsList();
  renderSummary();
  computeBottomInstant();

}); // DOMContentLoaded end
