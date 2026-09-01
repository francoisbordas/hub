/* plotter_chart.js — Plotter : état → points tracés (unités + lissage), rendu Chart.js
   (plugin annotations inline + chartjs-plugin-zoom), exports PNG / CSV / LaTeX pgfplots.
   API (window.plotterChart) :
     palettes, fmtNum, smooth(points,k), interpolateY(points,x), buildPlotData(state),
     render(pd, canvas, {onRangeChange}), toPNG(chart, scale), toCSV(pd, sep), toLaTeX(pd, {maxPoints})
   Tolère l'absence de Chart.js (render renvoie null) : parse/CSV/LaTeX restent utilisables.
*/
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;

  const palettes = {
    pastel:  ['#2b8cc4', '#f2a541', '#9b5de5', '#4cc9f0', '#52b788', '#e76f51'],
    vives:   ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'],
    sombres: ['#0b1228', '#7f1d1d', '#1e3a8a', '#14532d', '#4b5563', '#78350f'],
    mono:    ['#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db']
  };
  const fmtNum = v => Number.isFinite(v) ? String(+v.toPrecision(10)) : '';
  const fmtShort = v => Number.isFinite(v) ? String(+v.toPrecision(4)) : '';
  const num = v => (v === null || v === undefined || v === '') ? NaN : Number(v);
  const fin = v => Number.isFinite(v) ? v : undefined;

  /* ---------- traitement ---------- */
  // moyenne glissante centrée sur 2k+1 points, fenêtre rétrécie aux bords (sommes préfixes : O(n))
  function smooth(points, k) {
    k = Math.max(0, k | 0); const n = points.length;
    if (!k || n < 3) return points;
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + points[i].y;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - k), hi = Math.min(n - 1, i + k);
      out[i] = { x: points[i].x, y: (pre[hi + 1] - pre[lo]) / (hi - lo + 1) };
    }
    return out;
  }
  // interpolation linéaire sur des points triés par x ; null hors plage
  function interpolateY(points, x) {
    const n = points.length;
    if (!n || !(x >= points[0].x && x <= points[n - 1].x)) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].x <= x) lo = mid; else hi = mid; }
    const a = points[lo], b = points[hi];
    return (b.x === a.x) ? a.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
  }

  /* ---------- pipeline unique : state -> données tracées (consommées par Chart.js, CSV, LaTeX) ---------- */
  function buildPlotData(state) {
    const t = state.table, ax = state.axes;
    const pal = palettes[state.palette] || palettes.pastel;
    const kx = (num(ax.x.unitIn) || 1) / (num(ax.x.unitOut) || 1);
    const ky = 1 / (num(ax.y.scale) || 1);
    const series = [];
    if (t) {
      const xs = t.cols[state.x] || [];
      state.series.forEach((s, idx) => {
        if (!s.on || s.col === state.x) return;
        const ys = t.cols[s.col]; if (!ys) return;
        const pts = [];
        for (let r = 0; r < xs.length; r++) {
          const x = xs[r], y = ys[r];
          if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x: x * kx, y: y * ky });
        }
        pts.sort((a, b) => a.x - b.x);
        series.push({ col: s.col, label: s.label || t.names[s.col] || `Col ${s.col + 1}`, color: s.color || pal[idx % pal.length], k: s.k | 0, points: smooth(pts, s.k | 0) });
      });
    }
    const ann = [];
    for (const a of state.ann) {
      const color = a.color || '#e11d48';
      if (a.kind === 'v') { const x = num(a.x); if (Number.isFinite(x)) ann.push({ kind: 'v', x, label: a.label || '', color }); }
      else if (a.kind === 'h') { const y = num(a.y); if (Number.isFinite(y)) ann.push({ kind: 'h', y, label: a.label || '', color }); }
      else {
        const x = num(a.x); let y = num(a.y);
        const bound = (a.series !== null && a.series !== undefined && a.series !== '');
        const sr = bound ? series.find(s => s.col === Number(a.series)) : null;
        if (bound) { if (!sr) continue; const yi = interpolateY(sr.points, x); if (yi === null) continue; y = yi; }
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        ann.push({ kind: 'm', x, y, label: a.label || `${fmtShort(x)} ; ${fmtShort(y)}`, color: a.color || (sr ? sr.color : '#e11d48') });
      }
    }
    return {
      title: ax.title || '',
      x: { title: ax.x.title || '', min: num(ax.x.min), max: num(ax.x.max), step: num(ax.x.step) },
      y: { title: ax.y.title || '', min: num(ax.y.min), max: num(ax.y.max), step: num(ax.y.step) },
      series, ann
    };
  }

  /* ---------- plugin Chart.js : fond blanc (PNG opaque) + lignes / marqueurs ---------- */
  const annPlugin = {
    id: 'ann',
    beforeDraw(chart) {
      const { ctx, width, height } = chart;
      ctx.save(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); ctx.restore();
    },
    afterDatasetsDraw(chart, _args, opts) {
      const items = (opts && opts.items) || [];
      if (!items.length) return;
      const { ctx, chartArea: ca, scales: { x: sx, y: sy } } = chart;
      ctx.save();
      ctx.beginPath(); ctx.rect(ca.left, ca.top, ca.right - ca.left, ca.bottom - ca.top); ctx.clip();
      ctx.font = '12px sans-serif'; ctx.lineWidth = 1.5;
      for (const a of items) {
        ctx.strokeStyle = a.color; ctx.fillStyle = a.color;
        if (a.kind === 'v') {
          const px = sx.getPixelForValue(a.x);
          ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(px, ca.top); ctx.lineTo(px, ca.bottom); ctx.stroke(); ctx.setLineDash([]);
          if (a.label) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(a.label, px + 4, ca.top + 4); }
        } else if (a.kind === 'h') {
          const py = sy.getPixelForValue(a.y);
          ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(ca.left, py); ctx.lineTo(ca.right, py); ctx.stroke(); ctx.setLineDash([]);
          if (a.label) { ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(a.label, ca.left + 4, py - 3); }
        } else {
          const px = sx.getPixelForValue(a.x), py = sy.getPixelForValue(a.y);
          ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 2 * Math.PI); ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.lineWidth = 1.5;
          if (a.label) { ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(a.label, px + 7, py - 6); }
        }
      }
      ctx.restore();
    }
  };

  /* ---------- rendu ---------- */
  let chart = null;
  // nombre de décimales du pas (0.25 -> 2, 5 -> 0, 1e-7 -> 7) pour libeller les graduations sans arrondi trompeur
  function decimalsOf(step) { const s = String(+step.toPrecision(10)); const e = s.indexOf('e-'); if (e >= 0) return Number(s.slice(e + 2)); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function tickOpts(step, min, max) {
    const o = { color: '#111' };
    const tooMany = Number.isFinite(min) && Number.isFinite(max) && (max - min) / step > 500;
    if (Number.isFinite(step) && step > 0 && !tooMany) {
      o.stepSize = step; o.maxTicksLimit = 1000; o.autoSkip = false;
      const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: Math.min(20, decimalsOf(step)) });
      o.callback = v => nf.format(v);
    }
    return o;
  }
  function axisOpts(a, step) {
    return {
      type: 'linear', min: fin(a.min), max: fin(a.max),
      title: { display: !!a.title, text: a.title, color: '#111', font: { size: 13 } },
      ticks: tickOpts(step, a.min, a.max),
      grid: { color: 'rgba(0,0,0,0.12)' }, border: { color: '#444' }
    };
  }
  function render(pd, canvas, hooks) {
    const Chart = root.Chart;
    if (!Chart || !canvas) return null;
    const datasets = pd.series.map(s => ({
      label: s.label, data: s.points, borderColor: s.color, backgroundColor: s.color,
      borderWidth: 2, pointRadius: 0, pointHitRadius: 8, tension: 0, fill: false, parsing: false
    }));
    const onRange = () => {
      if (hooks && hooks.onRangeChange && chart) {
        hooks.onRangeChange({ xMin: chart.scales.x.min, xMax: chart.scales.x.max, yMin: chart.scales.y.min, yMax: chart.scales.y.max });
      }
    };
    const options = {
      animation: false, responsive: true, maintainAspectRatio: false, normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        title: { display: !!pd.title, text: pd.title, color: '#111', font: { size: 15, weight: '700' } },
        legend: { display: pd.series.length > 0, position: 'top', labels: { color: '#111', boxWidth: 18, boxHeight: 3 } },
        ann: { items: pd.ann },
        zoom: {
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy', onZoomComplete: onRange },
          pan: { enabled: true, mode: 'xy', onPanComplete: onRange }
        }
      },
      scales: { x: axisOpts(pd.x, pd.x.step), y: axisOpts(pd.y, pd.y.step) }
    };
    if (chart && chart.canvas !== canvas) { chart.destroy(); chart = null; }
    if (!chart) chart = new Chart(canvas.getContext('2d'), { type: 'line', data: { datasets }, options, plugins: [annPlugin] });
    else { chart.data.datasets = datasets; chart.options = options; chart.update('none'); }
    return chart;
  }

  /* ---------- exports ---------- */
  function toPNG(ch, scale) {
    const prev = ch.options.devicePixelRatio;
    ch.options.devicePixelRatio = scale || 2; ch.resize();
    const url = ch.toBase64Image('image/png', 1);
    ch.options.devicePixelRatio = prev; ch.resize();
    return url;
  }

  function escapeCsv(cell, sep) {
    const s = String(cell === undefined || cell === null ? '' : cell);
    return (s.includes(sep) || s.includes('"') || /[\r\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // colonnes alignées sur l'union des X (cellule vide si une série n'a pas ce X)
  function toCSV(pd, sep) {
    sep = sep || ',';
    const xsSet = new Set();
    const maps = pd.series.map(s => { const m = new Map(); for (const p of s.points) { m.set(p.x, p.y); xsSet.add(p.x); } return m; });
    const xs = Array.from(xsSet).sort((a, b) => a - b);
    const lines = [[pd.x.title || 'x', ...pd.series.map(s => s.label)].map(c => escapeCsv(c, sep)).join(sep)];
    for (const x of xs) lines.push([fmtNum(x), ...maps.map(m => m.has(x) ? fmtNum(m.get(x)) : '')].join(sep));
    return lines.join('\n');
  }

  const TEX_MAP = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '_': '\\_', '%': '\\%', '&': '\\&', '#': '\\#', '$': '\\$', '^': '\\^{}', '~': '\\~{}' };
  const texEscape = s => String(s === undefined || s === null ? '' : s).replace(/[\\{}_%&#$^~]/g, m => TEX_MAP[m]);
  function texColor(hex) {
    const h = String(hex || '#000000').replace('#', '');
    const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
    const r = parseInt(f.slice(0, 2), 16), g = parseInt(f.slice(2, 4), 16), b = parseInt(f.slice(4, 6), 16);
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  }
  function toLaTeX(pd, opts) {
    const maxPts = Math.max(50, (opts && opts.maxPoints) || 2000);
    const ax = [
      'width=12cm', 'height=8cm',
      `title={${texEscape(pd.title)}}`, `xlabel={${texEscape(pd.x.title)}}`, `ylabel={${texEscape(pd.y.title)}}`,
      'grid=both', 'major grid style={dashed,gray!30}', 'minor grid style={dotted,gray!50}',
      'legend style={at={(0.5,-0.18)},anchor=north,legend columns=2,font=\\small}', 'legend cell align=left'
    ];
    if (Number.isFinite(pd.x.min)) ax.push(`xmin=${fmtNum(pd.x.min)}`);
    if (Number.isFinite(pd.x.max)) ax.push(`xmax=${fmtNum(pd.x.max)}`);
    if (Number.isFinite(pd.y.min)) ax.push(`ymin=${fmtNum(pd.y.min)}`);
    if (Number.isFinite(pd.y.max)) ax.push(`ymax=${fmtNum(pd.y.max)}`);
    if (Number.isFinite(pd.x.step) && pd.x.step > 0) ax.push(`xtick distance=${fmtNum(pd.x.step)}`);
    if (Number.isFinite(pd.y.step) && pd.y.step > 0) ax.push(`ytick distance=${fmtNum(pd.y.step)}`);
    const out = [
      '\\documentclass[tikz,border=3mm]{standalone}',
      '\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}',
      '\\usepackage{pgfplots}', '\\pgfplotsset{compat=1.17}',
      '\\begin{document}', '\\begin{tikzpicture}', '\\begin{axis}[',
      ...ax.map(o => '  ' + o + ','),
      ']'
    ];
    for (const s of pd.series) {
      const n = s.points.length;
      const stride = Math.max(1, Math.ceil(n / maxPts));
      if (stride > 1) out.push(`% ${texEscape(s.label)} : décimé 1/${stride} (${n} points)`);
      if (s.k) out.push(`% ${texEscape(s.label)} : lissage moyenne glissante ±${s.k} points`);
      out.push(`\\addplot[color=${texColor(s.color)}, thick, no markers] table {`, 'x y');
      for (let i = 0; i < n; i += stride) out.push(`${fmtNum(s.points[i].x)} ${fmtNum(s.points[i].y)}`);
      if (n > 1 && (n - 1) % stride !== 0) out.push(`${fmtNum(s.points[n - 1].x)} ${fmtNum(s.points[n - 1].y)}`);
      out.push('};', `\\addlegendentry{${texEscape(s.label)}}`);
    }
    for (const a of pd.ann) {
      const c = texColor(a.color), l = texEscape(a.label);
      if (a.kind === 'v') out.push(`\\draw[dashed, color=${c}] ({axis cs:${fmtNum(a.x)},0}|-{rel axis cs:0,0}) -- ({axis cs:${fmtNum(a.x)},0}|-{rel axis cs:0,1}) node[pos=0.97, anchor=north west, font=\\small, color=${c}] {${l}};`);
      else if (a.kind === 'h') out.push(`\\draw[dashed, color=${c}] ({rel axis cs:0,0}|-{axis cs:0,${fmtNum(a.y)}}) -- ({rel axis cs:1,0}|-{axis cs:0,${fmtNum(a.y)}}) node[pos=0.03, anchor=south west, font=\\small, color=${c}] {${l}};`);
      else out.push(`\\node[circle, fill=${c}, inner sep=1.8pt, label={[font=\\small, color=${c}]above right:{${l}}}] at (axis cs:${fmtNum(a.x)},${fmtNum(a.y)}) {};`);
    }
    out.push('\\end{axis}', '\\end{tikzpicture}', '\\end{document}');
    return out.join('\n');
  }

  root.plotterChart = { palettes, fmtNum, smooth, interpolateY, buildPlotData, render, toPNG, toCSV, toLaTeX, texEscape, getChart: () => chart };
})();
