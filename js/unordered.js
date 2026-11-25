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

function buildZhShape(kind) {
  ensureA4();
  const S = hooks.getState();
  // 矩形
  const rect = [[220, 560], [1020, 560], [1020, 1160], [220, 1160]];
  // 缺角四边形：矩形右上角挖去一个正方形缺口（正方形边长 240）
  const notch = [[220, 560], [780, 560], [780, 800], [1020, 800], [1020, 1160], [220, 1160]];
  // 直角梯形：上底 720、下底 440，左侧竖直
  const trap = [[260, 560], [980, 560], [700, 1160], [260, 1160]];
  const map = { rect, notch, trap };
  const pts = (map[kind] || rect).map(([x, y]) => ({ x, y }));
  S.segments = [];
  S.notes = [];
  S.totals = [];
  S.multi = [];
  S.selected = null;
  S.zhDrawing = false;
  for (let i = 0; i < pts.length; i++) {
    S.segments.push({ a: { ...pts[i] }, b: { ...pts[(i + 1) % pts.length] }, len: null, adj: '' });
  }
  S.selected = { kind: 'seg', idx: 0 };
  updateModeBars();
  hooks.render(); hooks.refreshList();
  const names = { rect: '矩形', notch: '缺角四边形（挖去正方形缺口）', trap: '直角梯形' };
  hooks.setStatus('宅基地（' + (names[kind] || '矩形') + '）：点选边 → 输入/测量绑定长度；要编辑点「转手绘」');
}

function rotateZhShape() {
  const S = hooks.getState();
  if (!S.segments.length) return;
  const pts = S.segments.map(s => ({ x: s.a.x, y: s.a.y }));
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const rot = (p) => ({ x: cx + (p.y - cy), y: cy - (p.x - cx) });
  const newPts = pts.map(rot);
  const lens = S.segments.map(s => s.len);
  const adjs = S.segments.map(s => s.adj);
  S.segments = newPts.map((p, i) => ({
    a: { ...p },
    b: { ...newPts[(i + 1) % newPts.length] },
    len: lens[i],
    adj: adjs[i],
  }));
  hooks.render(); hooks.refreshList();
  hooks.setStatus('已旋转 90°（缺口/斜边方向可调到四个角）');
}

function bindZhBar() {
  const r = document.getElementById('btnZhRect');
  const c = document.getElementById('btnZhCut');
  if (r) r.onclick = () => buildZhShape('rect');
  if (c) c.onclick = () => buildZhShape('notch');
  const rot = document.getElementById('btnZhRot');
  if (rot) rot.onclick = rotateZhShape;
  const tr = document.getElementById('btnZhTrap');
  if (tr) tr.onclick = () => buildZhShape('trap');
  const td = document.getElementById('btnZhToDraw');
  if (td) td.onclick = () => {
    S().zhDrawing = true;
    S().mode = 'select';
    updateModeBars();
    hooks.render(); hooks.refreshList();
    hooks.setStatus('宅基地已转手绘：可点选/拖动端点/加线/分割/点注/平差');
  };
}

function updateModeBars() {
  const app = S().app;
  const jg = app === 'jg';
  const plan = app === 'plan';
  const sketch = app === 'sketch';
  const zh = app === 'zh';
  const el = (id) => document.getElementById(id);
  const drawMode = sketch || (zh && S().zhDrawing);
  if (el('editBar')) el('editBar').style.display = drawMode ? 'flex' : 'none';
  if (el('fcBar')) el('fcBar').style.display = plan ? 'flex' : 'none';
  if (el('jgBar')) el('jgBar').style.display = jg ? 'flex' : 'none';
  if (el('sketchBar')) el('sketchBar').style.display = drawMode ? 'flex' : 'none';
  if (el('zhBar')) el('zhBar').style.display = zh ? 'flex' : 'none';
  if (el('panel')) el('panel').style.display = (plan || jg || sketch || zh) ? '' : 'none';
  if (el('thickBar')) el('thickBar').style.display = (plan || jg || sketch || zh) ? 'flex' : 'none';
  if (window.WS && window.WS.resizeCanvas) requestAnimationFrame(() => window.WS.resizeCanvas());
}

function setApp(mode) {
  S().app = mode;
  const isPlan = (mode === 'plan' || mode === 'sketch' || mode === 'zh');
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
  } else if (v === 'zh') {
    setApp('zh');
    S().app = 'zh';
    S().mode = 'select';
    S().zhDrawing = false;
    const sz = document.getElementById('appModeSel'); if (sz) sz.value = 'zh';
    updateModeBars();
    bindZhBar();
    zhOpenInit();
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
['szAdjE', 'szAdjS', 'szAdjW', 'szAdjN'].forEach(id => {
  const b = document.getElementById(id);
  if (b) b.onclick = () => {
    const on = b.dataset.on !== '1';
    b.dataset.on = on ? '1' : '0';
    b.textContent = on ? '有邻建' : '无邻建';
    b.classList.toggle('on', on);
    const di = document.getElementById('szDoor' + id.slice(-1));
    if (di) di.style.display = on ? '' : 'none';
  };
});
// ================= 农村宅基地：进门填写 =================
function zhOpenInit() {
  const S = hooks.getState();
  let savedNo = '';
  let savedFloors = '';
  try {
    savedNo = localStorage.getItem('zh_houseNo') || '';
    savedFloors = localStorage.getItem('zh_floors') || '';
  } catch (e) {}
  const noEl = document.getElementById('zhHouseNo');
  const flEl = document.getElementById('zhFloors');
  if (noEl) noEl.value = S.houseNo || savedNo || '';
  if (flEl) flEl.value = S.floorCount || savedFloors || '1';
  document.getElementById('zhInitModal').classList.add('open');
}
function zhConfirmInit() {
  const S = hooks.getState();
  const no = (document.getElementById('zhHouseNo').value || '').trim();
  const fl = parseInt(document.getElementById('zhFloors').value || '1', 10) || 1;
  S.houseNo = no;
  S.floorCount = Math.max(1, Math.min(30, fl));
  try {
    localStorage.setItem('zh_houseNo', no);
    localStorage.setItem('zh_floors', String(S.floorCount));
  } catch (e) {}
  document.getElementById('zhInitModal').classList.remove('open');
  S.floorIdx = 1;
  buildZhShape('rect');
  zhSetFloors(S.floorCount);
  hooks.render(); hooks.refreshList();
  hooks.setStatus('宅基地：门牌号已记录 #' + (no || '-') + '，共 ' + S.floorCount + ' 层；点「门牌」再点位置放置');
}
const _zhOk = document.getElementById('zhInitOk');
if (_zhOk) _zhOk.onclick = zhConfirmInit;
const _zhCancel = document.getElementById('zhInitCancel');
if (_zhCancel) _zhCancel.onclick = () => document.getElementById('zhInitModal').classList.remove('open');

// ================= 农村宅基地：楼层 =================
function zhSnapshot() {
  const S = hooks.getState();
  return {
    segments: S.segments, notes: S.notes, doors: S.doors, sizhi: S.sizhi, totals: S.totals,
  };
}
function zhApplySnap(st) {
  const S = hooks.getState();
  S.segments = st.segments || [];
  S.notes = st.notes || [];
  S.doors = st.doors || [];
  S.sizhi = st.sizhi || null;
  S.totals = st.totals || [];
  S.selected = null;
  S.multi = [];
  hooks.render(); hooks.refreshList();
}
function zhBBox(segs) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  segs.forEach(sg => [sg.a, sg.b].forEach(p => {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }));
  return { minx, miny, maxx, maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2 };
}
function zhMakeUpperFloor(baseSegs) {
  const outline = baseSegs.map(sg => ({
    a: { ...sg.a }, b: { ...sg.b }, len: null, adj: sg.adj || '',
  }));
  const b = zhBBox(outline);
  // 内部长：一横一竖，默认 ++
  outline.push({ a: { x: b.minx + 40, y: b.cy }, b: { x: b.maxx - 40, y: b.cy }, len: null, adj: '++' });
  outline.push({ a: { x: b.cx, y: b.miny + 40 }, b: { x: b.cx, y: b.maxy - 40 }, len: null, adj: '++' });
  return outline;
}
function zhUpdateFloorSel() {
  const S = hooks.getState();
  const sel = document.getElementById('zhFloorSel');
  if (!sel) return;
  const opts = [];
  for (let i = 1; i <= (S.floorCount || 1); i++) opts.push('<option value="' + i + '">' + i + ' 层</option>');
  opts.push('<option value="roof">天面</option>');
  sel.innerHTML = opts.join('');
  sel.value = String(S.floorIdx || 1);
}
function zhSwitchFloor(target) {
  const S = hooks.getState();
  if (String(target) === String(S.floorIdx)) return;
  S.floors = S.floors || {};
  if (!S.floors[S.floorIdx]) S.floors[S.floorIdx] = zhSnapshot();
  let st = S.floors[target];
  if (!st) {
    if (target === 'roof') {
      const segs = (S.floors[2] ? S.floors[2].segments : S.segments)
        .filter(sg => !(sg.adj === '++'));
      st = { segments: segs.map(sg => ({ a: { ...sg.a }, b: { ...sg.b }, len: null, adj: '' })), notes: [], doors: [], sizhi: null, totals: [] };
    } else {
      st = zhSnapshot();
    }
    S.floors[target] = st;
  }
  S.floorIdx = target;
  zhApplySnap(st);
  zhUpdateFloorSel();
  hooks.setStatus(target === 'roof' ? '天面层（暂按一层图形显示）' : ('当前编辑 ' + target + ' 层'));
}
function zhSetFloors(count) {
  const S = hooks.getState();
  const n = Math.max(1, Math.min(30, parseInt(count, 10) || 1));
  S.floorCount = n;
  S.floors = S.floors || {};
  // 一层快照：以当前一层为准
  if (S.floorIdx !== 1) zhSwitchFloor(1);
  S.floors[1] = zhSnapshot();
  const f1 = S.floors[1];
  // 二层 = 一层轮廓 + 内部长
  const upper = zhMakeUpperFloor(f1.segments);
  S.floors[2] = { segments: upper, notes: [], doors: [], sizhi: null, totals: [] };
  // 三层及以上共用二层数组（改二层自动同步）
  for (let i = 3; i <= n; i++) S.floors[i] = S.floors[2];
  // 天面：一层轮廓快照
  S.floors['roof'] = {
    segments: f1.segments.map(sg => ({ a: { ...sg.a }, b: { ...sg.b }, len: null, adj: '' })),
    notes: [], doors: [], sizhi: null, totals: [],
  };
  zhUpdateFloorSel();
  hooks.setStatus('共 ' + n + ' 层 + 天面；二层起图形与一层一致，内部长默认 ++');
}
function zhInitFloors() {
  const S = hooks.getState();
  S.floorCount = 1;
  S.floorIdx = 1;
  S.floors = { 1: zhSnapshot() };
  S.floors['roof'] = {
    segments: S.segments.map(sg => ({ a: { ...sg.a }, b: { ...sg.b }, len: null, adj: '' })),
    notes: [], doors: [], sizhi: null, totals: [],
  };
  zhUpdateFloorSel();
}

const _flBtn = document.getElementById('btnZhFloors');
if (_flBtn) _flBtn.onclick = () => {
  const S = hooks.getState();
  const v = prompt('总层数（含一层，1~30）', String(S.floorCount || 1));
  if (v == null) return;
  zhSetFloors(v);
};
const _flSel = document.getElementById('zhFloorSel');
if (_flSel) _flSel.onchange = () => zhSwitchFloor(_flSel.value);
function rebuildSizhiDims() {
  const S = hooks.getState();
  S.segments = S.segments.filter(sg => !sg.sizhiDim);
  if (!S.sizhi || !S.segments.length) return;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  S.segments.forEach(sg => [sg.a, sg.b].forEach(p => {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }));
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const far = 260;
  const sides = ['up', 'right', 'down', 'left'];
  sides.forEach(side => {
    const it = S.sizhi[side];
    if (!it || !it.adj || !it.adj.on) return;
    const margin = 50;
    let a, b;
    // 相对右手侧：从屋外看向建筑时的右手端
    if (side === 'up') { const x = maxx - margin; a = { x, y: miny }; b = { x, y: miny - far }; }
    else if (side === 'down') { const x = minx + margin; a = { x, y: maxy }; b = { x, y: maxy + far }; }
    else if (side === 'left') { const y = maxy - margin; a = { x: minx, y }; b = { x: minx - far, y }; }
    else { const y = miny + margin; a = { x: maxx, y }; b = { x: maxx + far, y }; }
    S.segments.push({ a, b, len: null, adj: '', sizhiDim: side });
  });
}

const SZ_SIDES = ['up', 'right', 'down', 'left'];
const SZ_IDS = { up: ['szUp', 'szAdjU', 'szDoorU', 'szHintUp'], right: ['szRight', 'szAdjR', 'szDoorR', 'szHintR'], down: ['szDown', 'szAdjD', 'szDoorD', 'szHintDown'], left: ['szLeft', 'szAdjL', 'szDoorL', 'szHintL'] };
function szCardinal() {
  const S = hooks.getState();
  const north = (typeof S.north === 'number') ? S.north : 0;
  const CARD = { '北': 0, '东': 90, '南': 180, '西': 270 };
  const names = ['北', '东', '南', '西'];
  const bear = { up: north, right: north + 90, down: north + 180, left: north + 270 };
  const out = {};
  SZ_SIDES.forEach(side => {
    const b = ((bear[side] % 360) + 360) % 360;
    let best = '北', bd = 999;
    names.forEach(n => {
      const c = CARD[n];
      let d = Math.abs(((b - c) % 360 + 360) % 360);
      d = Math.min(d, 360 - d);
      if (d < bd) { bd = d; best = n; }
    });
    out[side] = best;
  });
  return out;
}
function szSetAdj(btn, on) {
  if (!btn) return;
  btn.dataset.on = on ? '1' : '0';
  btn.textContent = on ? '有邻建' : '无邻建';
  btn.classList.toggle('on', !!on);
}
const _szBtn = document.getElementById('btnZhSizhi');
if (_szBtn) _szBtn.onclick = () => {
  if (hooks.getState().floorIdx !== 1) { hooks.setStatus('四至只在一层设置'); return; }
  const S = hooks.getState();
  if (!S.segments.length) { hooks.setStatus('先建好宅基地形状'); return; }
  const cur = S.sizhi || {};
  const cards = szCardinal();
  SZ_SIDES.forEach(side => {
    const [inp, adjBtn, doorInp, hint] = SZ_IDS[side].map(id => document.getElementById(id));
    const item = cur[side] || {};
    if (inp) inp.value = item.text || '巷';
    if (hint) hint.textContent = '（' + cards[side] + '）';
    const adj = item.adj || {};
    szSetAdj(adjBtn, adj.on);
    if (doorInp) { doorInp.style.display = adj.on ? '' : 'none'; doorInp.value = adj.door || ''; }
  });
  document.getElementById('sizhiModal').classList.add('open');
};
SZ_SIDES.forEach(side => {
  const [, adjId, doorId] = SZ_IDS[side];
  const b = document.getElementById(adjId);
  if (b) b.onclick = () => {
    const on = b.dataset.on !== '1';
    szSetAdj(b, on);
    const di = document.getElementById(doorId);
    if (di) di.style.display = on ? '' : 'none';
  };
});
const _szSave = document.getElementById('szSave');
if (_szSave) _szSave.onclick = () => {
  const S = hooks.getState();
  const next = {};
  SZ_SIDES.forEach(side => {
    const [inp, adjBtn, doorInp] = SZ_IDS[side].map(id => document.getElementById(id));
    next[side] = {
      text: (inp ? inp.value.trim() : '') || '巷',
      adj: { on: adjBtn && adjBtn.dataset.on === '1', door: doorInp ? (doorInp.value || '').trim() : '' },
    };
  });
  S.sizhi = next;
  rebuildSizhiDims();
  document.getElementById('sizhiModal').classList.remove('open');
  hooks.render(); hooks.refreshList();
  hooks.setStatus('已生成四至（按图面上/右/下/左）');
};
const _szClear = document.getElementById('szClear');
if (_szClear) _szClear.onclick = () => {
  const S0 = hooks.getState();
  S0.sizhi = null;
  S0.segments = S0.segments.filter(sg => !sg.sizhiDim);
  document.getElementById('sizhiModal').classList.remove('open');
  hooks.render(); hooks.refreshList();
  hooks.setStatus('已清除四至');
};
const _szClose = document.getElementById('szClose');
if (_szClose) _szClose.onclick = () => document.getElementById('sizhiModal').classList.remove('open');
const _zhUndo = document.getElementById('btnZhUndo');
if (_zhUndo) _zhUndo.onclick = () => {
  if (window.INT && window.INT.undo) window.INT.undo();
};
const _stairBtn = document.getElementById('btnZhStair');
if (_stairBtn) _stairBtn.onclick = () => {
  const S = hooks.getState();
  if (String(S.floorIdx) !== 'roof') { hooks.setStatus('梯屋只在天面层使用，请先切换到天面'); return; }
  if (!S.segments.length) { hooks.setStatus('天面还没有图形'); return; }
  S.mode = 'stairhouse';
  S.stairStart = null;
  S.stairPrev = null;
  S.stair = true;
  hooks.setStatus('梯屋：先点墙线上一点（50px 内）');
};
const _balBtn = document.getElementById('btnZhBalcony');
if (_balBtn) _balBtn.onclick = () => {
  const S = hooks.getState();
  if (!S.segments.length) { hooks.setStatus('先建好宅基地轮廓'); return; }
  S.balconyFirst = null;
  S.mode = 'balcony';
  hooks.setStatus('阳台：先点房屋边上一点');
};
const _doorBtn = document.getElementById('btnZhDoor');
if (_doorBtn) _doorBtn.onclick = () => {
  if (hooks.getState().floorIdx !== 1) { hooks.setStatus('门牌只在一层设置'); return; }
  const S = hooks.getState();
  if (!S.houseNo) { zhOpenInit(); return; }
  S.doorPending = String(S.houseNo);
  S.mode = 'door';
  hooks.setStatus('门牌 #' + S.houseNo + '：在图形上方点一个位置');
};
const _cmpBtn = document.getElementById('btnCompass');
if (_cmpBtn) _cmpBtn.onclick = compassOpen;
const _cmpSave = document.getElementById('compassSave');
if (_cmpSave) _cmpSave.onclick = compassSave;
const _cmpFlip = document.getElementById('compassFlip');
if (_cmpFlip) _cmpFlip.onclick = () => { window.__compassFlip = !window.__compassFlip; };
const _cmpClose = document.getElementById('compassClose');
if (_cmpClose) _cmpClose.onclick = () => document.getElementById('compassModal').classList.remove('open');
try { bindZhBar(); } catch (e) {}
function edgeMathAngle(sg) {
  const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y;
  return Math.atan2(-dy, dx) * 180 / Math.PI;   // 数学角（y 向上）
}

function compassCompute() {
  const S = hooks.getState();
  const sel = S.selected && S.selected.kind === 'seg' ? S.selected.idx : 0;
  const sg = S.segments[sel];
  if (!sg) return null;
  const H = (window.COMPASS.heading + 360) % 360;

  // 图形质心（图纸坐标），用于判断参考边的“室内”一侧
  let cx = 0, cy = 0, np = 0;
  S.segments.forEach(s => { cx += s.a.x + s.b.x; cy += s.a.y + s.b.y; np += 2; });
  cx /= Math.max(1, np); cy /= Math.max(1, np);

  const mx = (sg.a.x + sg.b.x) / 2, my = (sg.a.y + sg.b.y) / 2;
  const ux = sg.b.x - sg.a.x, uy = sg.b.y - sg.a.y;
  const L = Math.hypot(ux, uy) || 1;
  // 数学坐标下的单位切向
  const mu = { x: ux / L, y: -uy / L };
  const n1 = { x: -mu.y, y: mu.x };
  const toC = { x: cx - mx, y: -(cy - my) };  // 指向质心（数学坐标）
  const n = (n1.x * toC.x + n1.y * toC.y) >= 0 ? n1 : { x: -n1.x, y: -n1.y };
  const phiN = Math.atan2(n.y, n.x) * 180 / Math.PI;   // 室内法线数学角

  // 约定：左长边贴外墙、屋外、屏幕朝上 → 实际室内法线方位 = H - 90
  // 推导：北向角 N = H - 180 + φn
  const north = ((H - 180 + phiN) % 360 + 360) % 360;
  return { H, phiN, north, sel };
}

function compassOpen() {
  const m = document.getElementById('compassModal');
  if (!m) return;
  const S = hooks.getState();
  const sel = S.selected && S.selected.kind === 'seg' ? S.selected.idx : 0;
  const sg = S.segments[sel];
  document.getElementById('compassRef').textContent = sg ? ('段' + (sel + 1)) : '未选（默认段1）';
  m.classList.add('open');
  if (window.COMPASS) window.COMPASS.start((st) => {
    const hd = document.getElementById('compassHeading');
    const stt = document.getElementById('compassStatus');
    hd.textContent = st.heading.toFixed(1) + '°';
    const spread = st.spread;
    stt.textContent = spread == null ? '采样中…' : (spread < 3 ? '稳定' : (spread < 8 ? '轻微抖动' : '跳动大：请 8 字校准或远离金属'));
    const r = compassCompute();
    if (r) document.getElementById('compassNorth').textContent = r.north.toFixed(1) + '°';
  });
  if (window.COMPASS && !window.COMPASS.ready) {
    document.getElementById('compassStatus').textContent = '等待传感器…（请保持平板水平）';
  }
}

function compassSave() {
  const S = hooks.getState();
  const r = compassCompute();
  if (!r) { hooks.setStatus('先选中一条参考边'); return; }
  S.north = r.north;
  document.getElementById('compassModal').classList.remove('open');
  hooks.render(); hooks.refreshList();
  hooks.setStatus('北向角已设为 ' + r.north.toFixed(1) + '°（左长边贴外墙·屋外约定）');
}

function toHandDraw(from) {
  const S = hooks.getState();
  S.app = 'sketch';
  S.zhDrawing = false;
  S.mode = 'select';
  ensureA4();
  const sel = document.getElementById('appModeSel');
  if (sel) sel.value = 'sketch';
  updateModeBars();
  hooks.render(); hooks.refreshList();
  hooks.setStatus(from + '已转手绘：可点选/拖动端点/加线/分割/点注/平差');
}
['btnFcToDraw', 'btnJgToDraw'].forEach(id => {
  const b = document.getElementById(id);
  if (b) b.onclick = () => toHandDraw(id === 'btnFcToDraw' ? '附图识别' : '竣工图');
});
document.getElementById('uoClear').onclick = () => {
  S().lengths = []; S().uoCands = []; S().uoCandIdx = -1;
  renderUnordered(); renderUoCands(); drawUoPreview(); hooks.setStatus('已清空无序长度');
};



  window.UOR = {
    init(h) { hooks = h; },
    renderUnordered,
    uoMatch,
    setApp,
    updateModeBars,
    zhSetFloors: (n) => zhSetFloors(n),
    rebuildSizhiDims: () => rebuildSizhiDims(),
    zhSwitchFloor: (k) => zhSwitchFloor(k),
    drawUoPreview,
  };
})();
