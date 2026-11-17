/* 无序识别 UI：模式切换、长度收集、识别/预览/转手绘 */
(function () {
  let hooks = null;
  const S = () => hooks.getState();
// ================= 无序识别（长度 → 常见房屋模板）=================
function uoMatch(...args) { return window.UOM.uoMatch(...args); }

function renderUnordered() {
  const box = document.getElementById('uoLengths');
  if (!box) return;
  box.innerHTML = S().lengths.map((v, i) => `<span>${i + 1}. ${v.toFixed(4)}</span>`).join('');
  const st = document.getElementById('uoStatus');
  if (st) st.textContent = S().lengths.length ? `共 ${S().lengths.length} 个长度` : '还没有长度';
}

function drawUoPreview() {
  const cvs = document.getElementById('uoPreview');
  if (!cvs) return;
  const g = cvs.getContext('2d');
  g.clearRect(0, 0, cvs.width, cvs.height);
  const c = S().uoCands[S().uoCandIdx];
  if (!c) return;
  const vs = c.vertices;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  vs.forEach(([x, y]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); });
  const pad = 34;
  const s = Math.min((cvs.width - 2 * pad) / Math.max(0.1, maxx - minx),
                     (cvs.height - 2 * pad) / Math.max(0.1, maxy - miny));
  const ox = (cvs.width - (maxx - minx) * s) / 2;
  const oy = (cvs.height - (maxy - miny) * s) / 2;
  const T = ([x, y]) => ({ x: ox + (x - minx) * s, y: cvs.height - oy - (y - miny) * s });
  const pts = vs.map(T);
  g.strokeStyle = '#1565c0'; g.lineWidth = 2;
  g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y));
  g.closePath(); g.stroke();
  g.fillStyle = '#123a63'; g.font = 'bold 12px Consolas, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    let ang = Math.atan2(q.y - p.y, q.x - p.x);
    if (ang > Math.PI / 2) ang -= Math.PI;
    else if (ang < -Math.PI / 2) ang += Math.PI;
    const L = c.assignment[i] ? c.assignment[i].fitted : 0;
    g.save();
    g.translate((p.x + q.x) / 2, (p.y + q.y) / 2);
    g.rotate(ang);
    g.fillText(L.toFixed(3), 0, -8);
    g.restore();
  });
}

  function uoTypeOf(c) {
    const name = String(c.template || '') + String(c.name || '');
    return (name.indexOf('T') >= 0 || name.indexOf('矩形') >= 0) ? '外凸' : '内凹';
  }

  function renderUoCands() {
    const typeSel = document.getElementById('uoType');
    const varSel = document.getElementById('uoVariant');
    if (!typeSel || !varSel) return;
    const groups = { '内凹': [], '外凸': [] };
    S().uoCands.forEach((c, i) => groups[uoTypeOf(c)].push(i));
    const types = Object.keys(groups).filter(k => groups[k].length);
    const label = k => k === '外凸' ? '外凸(T/矩形)' : '内凹(U/L/阶梯)';
    typeSel.innerHTML = types.map(k => `<option value="${k}">${label(k)}</option>`).join('');
    const cur = S().uoCands[S().uoCandIdx];
    const curType = cur ? uoTypeOf(cur) : types[0];
    if (types.length) typeSel.value = types.includes(curType) ? curType : types[0];

    function fillVariants() {
      const typ = typeSel.value;
      const list = groups[typ] || [];
      varSel.innerHTML = list.map(i => {
        const c = S().uoCands[i];
        return `<option value="${i}">${c.name}｜面积 ${c.area.toFixed(1)} m²｜残差 ${c.residual_mm.toFixed(1)} mm</option>`;
      }).join('');
      if (list.length) {
        const sel = list.includes(S().uoCandIdx) ? S().uoCandIdx : list[0];
        varSel.value = String(sel);
        S().uoCandIdx = sel;
      }
      drawUoPreview();
    }
    fillVariants();
    typeSel.onchange = fillVariants;
    varSel.onchange = () => { S().uoCandIdx = Number(varSel.value); drawUoPreview(); };
  }


function ensureA4() {
  const S = window.WS.S;
  if (S.img) return;
  const c = document.createElement('canvas');
  c.width = 1240; c.height = 1754;   // 约 A4 150dpi
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d0d7e2';
  g.lineWidth = 2;
  g.strokeRect(1, 1, c.width - 2, c.height - 2);
  S.img = c;
  window.WS.fitView();
}

function updateModeBars() {
  const app = S().app;
  const jg = app === 'jg';
  const plan = app === 'plan';
  const sketch = app === 'sketch';
  const el = (id) => document.getElementById(id);
  if (el('editBar')) el('editBar').style.display = (jg || plan || sketch) ? 'flex' : 'none';
  if (el('fcBar')) el('fcBar').style.display = plan ? 'flex' : 'none';
  if (el('jgBar')) el('jgBar').style.display = jg ? 'flex' : 'none';
  if (el('sketchBar')) el('sketchBar').style.display = sketch ? 'flex' : 'none';
  if (el('panel')) el('panel').style.display = (plan || jg || sketch) ? '' : 'none';
}

function setApp(mode) {
  S().app = mode;
  const isPlan = (mode === 'plan' || mode === 'sketch');
  document.getElementById('panel').style.display = isPlan ? '' : 'none';
  document.getElementById('unorderedPanel').style.display = isPlan ? 'none' : 'flex';
  document.getElementById('stage').style.display = isPlan ? '' : 'none';
  const sel = document.getElementById('appModeSel');
  if (sel) sel.value = S().app;
  updateModeBars();
  if (isPlan) requestAnimationFrame(() => requestAnimationFrame(window.WS.resizeCanvas));
  else renderUnordered();
}

function uoToSketch() {
  const c = S().uoCands[S().uoCandIdx];
  if (!c) { hooks.setStatus('先点「识别」并选一个候选'); return; }
  const verts = c.vertices;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  verts.forEach(([x, y]) => {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  });
  // 切回看图模式后按画布大小缩放
  setApp('plan');
  const r = hooks.cv.getBoundingClientRect();
  const s = Math.min((r.width * 0.9) / Math.max(0.1, maxx - minx),
                     (r.height * 0.9) / Math.max(0.1, maxy - miny));
  const ox = (r.width - (maxx - minx) * s) / 2;
  const oy = (r.height - (maxy - miny) * s) / 2;
  const T = ([x, y]) => ({ x: ox + (x - minx) * s, y: r.height - oy - (y - miny) * s });
  S().img = null;
  S().crop = null;
  S().segments = [];
  S().notes = [];
  const pts = verts.map(T);
  for (let i = 0; i < pts.length; i++) {
    S().segments.push({
      a: pts[i], b: pts[(i + 1) % pts.length],
      len: c.assignment[i] ? c.assignment[i].fitted : null, adj: '',
    });
  }
  S().selected = null;
  S().lengths = [];
  S().uoCands = []; S().uoCandIdx = -1;
  renderUnordered(); renderUoCands();
  hooks.render(); hooks.refreshList();
  hooks.setStatus(`已转为手绘编辑：${S().segments.length} 段，可点选测量/加线/分割`);
}

document.getElementById('appModeSel').onchange = (e) => {
  const v = e.target.value;
  if (v === 'jg') {
    setApp('plan');
    S().app = 'jg';
    const sel = document.getElementById('appModeSel');
    if (sel) sel.value = 'jg';
    updateModeBars();
    window.WS.setStatus('竣工图识别：打开图纸 → 框选范围 → 识别（墙+柱）');
    window.WS.render();
  } else if (v === 'unordered') {
    setApp('unordered');
  } else if (v === 'sketch') {
    ensureA4();
    setApp('sketch');
  {
    S().app = 'sketch';
    const sel = document.getElementById('appModeSel');
    if (sel) sel.value = 'sketch';
    updateModeBars();
  }
    S().app = 'sketch';
    S().mode = 'draw';
    const s2 = document.getElementById('appModeSel'); if (s2) s2.value = 'sketch';
    updateModeBars();
    window.WS.setStatus('手绘模式：点第一个点，之后连续点自动连线');
  } else {
    S().app = 'plan';
    setApp('plan');
    updateModeBars();
  }
};
document.getElementById('uoAdd').onclick = () => {
  const txt = document.getElementById('uoInput').value || '';
  const nums = txt.split(/[\s,，;；]+/).map(Number).filter(v => isFinite(v) && v > 0);
  if (!nums.length) { hooks.setStatus('没有可添加的长度'); return; }
  S().lengths.push(...nums);
  document.getElementById('uoInput').value = '';
  renderUnordered();
};
document.getElementById('uoMatch').onclick = () => {
  const minimal = document.getElementById('uoMinimal') ? document.getElementById('uoMinimal').checked : true;
    const r = uoMatch(S().lengths, 15, minimal ? 'minimal' : 'full');
  const st = document.getElementById('uoStatus');
  if (r.error) { if (st) st.textContent = r.error; hooks.setStatus(r.error); return; }
  S().uoCands = r.candidates;
  S().uoCandIdx = S().uoCands.length ? 0 : -1;
  renderUoCands(); drawUoPreview();
  const msg = S().uoCands.length
    ? `识别到 ${S().uoCands.length} 个候选，选一个后点「转手绘」`
    : `没有匹配（当前 ${S().lengths.length} 个长度）`;
  if (st) st.textContent = msg;
  hooks.setStatus(msg);
};
document.getElementById('uoToSketch').onclick = uoToSketch;
document.getElementById('uoClear').onclick = () => {
  S().lengths = []; S().uoCands = []; S().uoCandIdx = -1;
  renderUnordered(); renderUoCands(); drawUoPreview(); hooks.setStatus('已清空无序长度');
};



  window.UOR = {
    init(h) { hooks = h; },
    renderUnordered,
    uoMatch,
    setApp,
    drawUoPreview,
  };
})();
