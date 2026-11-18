/* 交互层：撤销/打开图纸/自动描线入口/画布事件/工具栏绑定 */
(function () {
  let W = null;
  const S = () => W.getState();
  const cv = document.getElementById('cv');
  const $ = (id) => document.getElementById(id);
// ---------- 撤销 ----------
function pushUndo() {
  S().undo.push(JSON.stringify({ segments: S().segments, notes: S().notes, totals: S().totals }));
  if (S().undo.length > 50) S().undo.shift();
}
function undo() {
  if (!S().undo.length) { W.setStatus('没有可撤回的操作'); return; }
  const snap = JSON.parse(S().undo.pop());
  S().segments = snap.segments; S().notes = snap.notes; S().totals = snap.totals || [];
  S().selected = null; W.render(); W.refreshList(); W.setStatus('已撤回');
}

// ---------- 打开图纸 ----------
async function openFile(file) {
  try {
    if (!file) return;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const data = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, 3000 / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      window.__pdfPage = page; window.__pdfVp = vp;
      const off = document.createElement('canvas');
      off.width = Math.round(vp.width); off.height = Math.round(vp.height);
      await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
      S().img = off;
      W.setStatus(`已加载 ${file.name}（${off.width}×${off.height}）`);
    } else {
      window.__pdfPage = null; window.__pdfVp = null;
      const bmp = await createImageBitmap(file);
      const maxDim = 3000;
      const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const off = document.createElement('canvas');
      off.width = Math.round(bmp.width * k); off.height = Math.round(bmp.height * k);
      off.getContext('2d').drawImage(bmp, 0, 0, off.width, off.height);
      S().img = off;
      W.setStatus(`已加载 ${file.name}（${off.width}×${off.height}）`);
    }
    S().segments = []; S().notes = []; S().selected = null; S().undo = []; S().pending = null;
    $('hint').style.display = 'none';
    W.fitView(); W.refreshList();
  } catch (e) {
    alert('打开失败：' + e.message);
    W.setStatus('打开失败');
    console.error(e);
  }
}

// ---------- 自动描线（附图：单线灰度） ----------
// 合并同一面墙的两条平行线（1~4px 内的重复线）
function dedupeParallel(segs, tol, overlapRatio) {
  const H = segs.filter(s => Math.abs(s.a.y - s.b.y) < Math.abs(s.a.x - s.b.x));
  const V = segs.filter(s => !(Math.abs(s.a.y - s.b.y) < Math.abs(s.a.x - s.b.x)));
  function collapse(group, vertical) {
    group = group.map(s => {
      const a0 = vertical ? Math.min(s.a.y, s.b.y) : Math.min(s.a.x, s.b.x);
      const a1 = vertical ? Math.max(s.a.y, s.b.y) : Math.max(s.a.x, s.b.x);
      const c = vertical ? (s.a.x + s.b.x) / 2 : (s.a.y + s.b.y) / 2;
      return { a0, a1, c };
    }).sort((p, q) => p.c - q.c || p.a0 - q.a0);
    const out = [];
    for (const s of group) {
      let merged = false;
      for (const o of out) {
        if (Math.abs(o.c - s.c) <= tol) {
          const ov = Math.min(o.a1, s.a1) - Math.max(o.a0, s.a0);
          const shorter = Math.min(o.a1 - o.a0, s.a1 - s.a0);
          if (shorter > 0 && ov > overlapRatio * shorter) {
            const l1 = Math.max(1, o.a1 - o.a0), l2 = Math.max(1, s.a1 - s.a0);
            o.c = (o.c * l1 + s.c * l2) / (l1 + l2);
            o.a0 = Math.min(o.a0, s.a0);
            o.a1 = Math.max(o.a1, s.a1);
            merged = true;
            break;
          }
        }
      }
      if (!merged) out.push({ ...s });
    }
    return out.map(o => vertical
      ? { a: { x: o.c, y: o.a0 }, b: { x: o.c, y: o.a1 }, len: null, adj: '' }
      : { a: { x: o.a0, y: o.c }, b: { x: o.a1, y: o.c }, len: null, adj: '' });
  }
  return collapse(H, false).concat(collapse(V, true));
}

// 合并共线（同一直线上断开的两段）
function mergeCollinear(segs, ctol, gap) {
  const H = segs.filter(s => Math.abs(s.a.y - s.b.y) < Math.abs(s.a.x - s.b.x));
  const V = segs.filter(s => !(Math.abs(s.a.y - s.b.y) < Math.abs(s.a.x - s.b.x)));
  function merge(group, vertical) {
    group = group.map(s => {
      const a0 = vertical ? Math.min(s.a.y, s.b.y) : Math.min(s.a.x, s.b.x);
      const a1 = vertical ? Math.max(s.a.y, s.b.y) : Math.max(s.a.x, s.b.x);
      const c = vertical ? (s.a.x + s.b.x) / 2 : (s.a.y + s.b.y) / 2;
      return { a0, a1, c };
    }).sort((p, q) => p.c - q.c || p.a0 - q.a0);
    const out = [];
    for (const s of group) {
      let merged = false;
      for (const o of out) {
        if (Math.abs(o.c - s.c) <= ctol && s.a0 <= o.a1 + gap && s.a1 >= o.a0 - gap) {
          const l1 = Math.max(1, o.a1 - o.a0), l2 = Math.max(1, s.a1 - s.a0);
          o.c = (o.c * l1 + s.c * l2) / (l1 + l2);
          o.a0 = Math.min(o.a0, s.a0);
          o.a1 = Math.max(o.a1, s.a1);
          merged = true;
          break;
        }
      }
      if (!merged) out.push({ ...s });
    }
    return out.map(o => vertical
      ? { a: { x: o.c, y: o.a0 }, b: { x: o.c, y: o.a1 }, len: null, adj: '' }
      : { a: { x: o.a0, y: o.c }, b: { x: o.a1, y: o.c }, len: null, adj: '' });
  }
  return merge(H, false).concat(merge(V, true));
}

function autoTrace(useCrop, returnOnly) {
  if (!S().img) { W.setStatus('先打开图纸'); return; }
  const segs = window.REC.traceLinesJS(useCrop);
  if (!segs.length) { W.setStatus('没描到线，可能图片太淡或阈值不合适'); return; }
  if (returnOnly) return segs;
  pushUndo();
  S().segments = segs.slice(0, 600);
  S().notes = []; S().selected = null;
  S().mode = 'select';
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === 'select'));
  W.render(); W.refreshList();
  W.setStatus(`识别完成：${S().segments.length} 条`);
}

// ---------- 内部识别（白区泛洪 + 轮廓） ----------
function distToSeg(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const L2 = abx * abx + aby * aby || 1;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / L2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + abx * t, qy = a.y + aby * t;
  return { d: Math.hypot(p.x - qx, p.y - qy), t };
}

function hitSegment(pt) {
  let best = null;
  S().segments.forEach((sg, i) => {
    const a = W.i2s(sg.a), b = W.i2s(sg.b);
    const r = distToSeg(pt, a, b);
    if (r.d <= 24 && (!best || r.d < best.d)) best = { idx: i, d: r.d, t: r.t };
  });
  return best;
}

function hitNote(pt) {
  let best = null;
  S().notes.forEach((nt, i) => {
    const q = W.i2s(nt.pos);
    const d = Math.hypot(pt.x - q.x, pt.y - q.y);
    if (d <= 30 && (!best || d < best.d)) best = { idx: i, d };
  });
  return best ? best.idx : null;
}

function nextSegId() { const s = S(); s.segSeq = (s.segSeq || 1) + 1; return 's' + s.segSeq; }
function recordSplitTotal(sg, id1, id2) {
  const s = S();
  const id0 = sg.id || nextSegId();
  s.totals.push({ a: { ...sg.a }, b: { ...sg.b }, len: sg.len, adj: sg.adj, children: [id1, id2], id: id0 });
  s.totals.forEach(tt => {
    if (tt.children) tt.children = tt.children.flatMap(c => c === id0 ? [id1, id2] : [c]);
  });
}
function splitSegment(i, t) {
  const sg = S().segments[i];
  if (t < 0.08 || t > 0.92) { W.setStatus('分割点太靠端点'); return; }
  pushUndo();
  const pp = { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
  const id1 = nextSegId(), id2 = nextSegId();
  recordSplitTotal(sg, id1, id2);
  const s1 = { a: { ...sg.a }, b: { ...pp }, len: null, adj: sg.adj, id: id1 };
  const s2 = { a: { ...pp }, b: { ...sg.b }, len: null, adj: sg.adj, id: id2 };
  S().segments.splice(i, 1, s1, s2);
  S().selected = { kind: 'seg', idx: i };
  W.render(); W.refreshList(); W.setStatus('已分割');
}

// 把点吸附到已有横/竖线上（屏幕距离 <= tol）
function snapToLines(ip) {
  let best = null;
  for (const sg of S().segments) {
    const ah = Math.abs(sg.a.y - sg.b.y) < Math.abs(sg.a.x - sg.b.x);
    let qx, qy;
    if (ah) {
      qx = Math.max(Math.min(sg.a.x, sg.b.x), Math.min(Math.max(sg.a.x, sg.b.x), ip.x));
      qy = sg.a.y;
    } else {
      qx = sg.a.x;
      qy = Math.max(Math.min(sg.a.y, sg.b.y), Math.min(Math.max(sg.a.y, sg.b.y), ip.y));
    }
    const a = W.i2s({ x: qx, y: qy });
    const d = Math.hypot(a.x - W.i2s(ip).x, a.y - W.i2s(ip).y);
    if (d <= 30 && (!best || d < best.d)) best = { d, p: { x: qx, y: qy } };
  }
  return best ? best.p : ip;
}

// 新线端点落到已有线上时，把已有线在该点断开（T 形接头）
function splitAtPointInAll(ip) {
  const tol = 8;
  for (let i = 0; i < S().segments.length; i++) {
    const sg = S().segments[i];
    const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    let tt = ((ip.x - ax) * dx + (ip.y - ay) * dy) / L2;
    if (tt <= 0.02 || tt >= 0.98) continue;
    const q = { x: ax + dx * tt, y: ay + dy * tt };
    if (Math.hypot(ip.x - q.x, ip.y - q.y) > tol) continue;
    const id1 = nextSegId(), id2 = nextSegId();
    recordSplitTotal(sg, id1, id2);
    S().segments[i] = { a: { ...sg.a }, b: { ...q }, len: null, adj: sg.adj, id: id1 };
    S().segments.splice(i + 1, 0, { a: { ...q }, b: { ...sg.b }, len: null, adj: sg.adj, id: id2 });
    i++;
  }
}

function snapToGeometry(ip) {
  // 1) 端点优先（30 屏幕像素内）
  let best = null;
  const cands = [];
  S().segments.forEach(sg => { cands.push(sg.a, sg.b); });
  S().notes.forEach(nt => { if (nt.a) cands.push(nt.a); if (nt.b) cands.push(nt.b); });
  for (const c of cands) {
    const a = W.i2s(c), b = W.i2s(ip);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= 30 && (!best || d < best.d)) best = { d, p: { x: c.x, y: c.y }, kind: '端点' };
  }
  if (best) return best;
  // 2) 线段：任意角度投影（含斜线）
  for (const sg of S().segments) {
    const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    let tt = ((ip.x - ax) * dx + (ip.y - ay) * dy) / L2;
    tt = Math.max(0, Math.min(1, tt));
    const q = { x: ax + dx * tt, y: ay + dy * tt };
    const a = W.i2s(q), b = W.i2s(ip);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= 30 && (!best || d < best.d)) best = { d, p: q, kind: '线上' };
  }
  return best;
}

function handleTap(pt) {
  const ip = W.s2i(pt);

  if (S().mode === 'crop') {
    if (!S().cropFirst) {
      S().cropFirst = ip;
      W.setStatus('框选范围：点对角第二个点');
      return;
    }
    const a = S().cropFirst; S().cropFirst = null;
    S().crop = {
      x0: Math.min(a.x, ip.x), y0: Math.min(a.y, ip.y),
      x1: Math.max(a.x, ip.x), y1: Math.max(a.y, ip.y),
    };
    W.setStatus('已框选范围（自动描线只识别框内）');
    W.render();
    return;
  }

  if (S().mode === 'draw') {
    if (!S().anchor) {
      S().anchor = ip;
      W.setStatus('手绘：继续点，相邻点自动连线');
      W.render();
      return;
    }
    // 手绘强制横平竖直：取变化大的方向
    const a0 = S().anchor;
    const b0 = (Math.abs(ip.x - a0.x) >= Math.abs(ip.y - a0.y))
      ? { x: ip.x, y: a0.y }
      : { x: a0.x, y: ip.y };
    if (Math.hypot(b0.x - a0.x, b0.y - a0.y) < 4) { W.setStatus('点得太近，往横向或纵向再点一下'); return; }
    pushUndo();
    S().segments.push({ a: { ...a0 }, b: { ...b0 }, len: null, adj: '' });
    S().selected = { kind: 'seg', idx: S().segments.length - 1 };
    S().anchor = { ...b0 };
    W.setStatus('已加线段（横平竖直），可继续点下一点');
    W.render(); W.refreshList();
    return;
  }

  if (S().mode === 'free') {
    const snap = snapToGeometry(ip);
    if (!snap) { W.setStatus('斜线：起点必须靠近已有端点或线（30px 内）'); return; }
    if (!S().freeFrom) {
      S().freeFrom = snap.p;
      W.setStatus('斜线：起点已吸附到' + snap.kind + '，再点终点');
      W.render();
      return;
    }
    const a = S().freeFrom, b = snap.p;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) { W.setStatus('两点太近'); return; }
    pushUndo();
    splitAtPointInAll(a);
    splitAtPointInAll(b);
    S().segments.push({ a: { ...a }, b: { ...b }, len: null, adj: '' });
    S().selected = { kind: 'seg', idx: S().segments.length - 1 };
    S().freeFrom = null;
    W.render(); W.refreshList();
    W.setStatus('已画斜线（两端吸附到' + snap.kind + '）');
    return;
  }

  if (S().mode === 'note') {
    if (!S().pending) {
      S().pending = ip;
      W.setStatus('点注：点第二个点');
      W.render();
      return;
    }
    const first = S().pending;
    S().pending = null;
    const mid = { x: (first.x + ip.x) / 2, y: (first.y + ip.y) / 2 };
    const s = prompt('输入长度（米，可留空稍后填）');
    let v = null;
    if (s != null && s.trim() !== '') {
      const n = parseFloat(String(s).replace(/m/ig, ''));
      if (!isNaN(n)) v = n;
    }
    pushUndo();
    S().notes.push({ pos: mid, a: first, b: ip, len: v, adj: '' });
    S().selected = { kind: 'note', idx: S().notes.length - 1 };
    W.setStatus('已放数字，可点选后按徕卡测量');
    W.render(); W.refreshList();
    return;
  }

  if (S().mode === 'addline') {
    if (!S().addFrom) {
      { const sn = snapToGeometry(ip); S().addFrom = sn ? sn.p : ip; }
      W.setStatus('加线：起点已定，再点终点（自动吸附、横平竖直）');
      W.render();
      return;
    }
    const a = S().addFrom;
    const snB = snapToGeometry(ip); const b = snB ? snB.p : ip;
    S().addFrom = null;
    let seg;
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
      seg = { a: { x: Math.min(a.x, b.x), y: a.y }, b: { x: Math.max(a.x, b.x), y: a.y } };
    } else {
      seg = { a: { x: a.x, y: Math.min(a.y, b.y) }, b: { x: a.x, y: Math.max(a.y, b.y) } };
    }
    if (Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) < 4) return;
    pushUndo();
    splitAtPointInAll(seg.a);
    splitAtPointInAll(seg.b);
    S().segments.push({ a: { ...seg.a }, b: { ...seg.b }, len: null, adj: '' });
    S().selected = { kind: 'seg', idx: S().segments.length - 1 };
    W.render(); W.refreshList();
    W.setStatus(`已加线并选中第 ${S().segments.length} 段，可直接测量`);
    return;
  }

  if (S().mode === 'split') {
    if (!S().selected || S().selected.kind !== 'seg') {
      W.setStatus('分割：先点选一条线段，再点分割位置');
      return;
    }
    const idx = S().selected.idx;
    const sg = S().segments[idx];
    const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y;
    const L2 = dx * dx + dy * dy || 1;
    let tt = ((ip.x - sg.a.x) * dx + (ip.y - sg.a.y) * dy) / L2;
    tt = Math.max(0, Math.min(1, tt));
    splitSegment(idx, tt);
    return;
  }

  // 点选
  const hit = hitSegment(pt);
  if (hit) {
    S().selected = { kind: 'seg', idx: hit.idx };
    W.setStatus(`已选第 ${hit.idx + 1} 段，按徕卡测量绑定`);
    W.render(); W.refreshList(); return;
  }
  const ni = hitNote(pt);
  if (ni != null) {
    S().selected = { kind: 'note', idx: ni };
    W.setStatus(`已选注记第 ${ni + 1} 条`);
    W.render(); W.refreshList(); return;
  }
  S().selected = null;
  W.render(); W.refreshList();
}

// ---------- 画布触摸/鼠标交互 ----------
function canvasPoint(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  const pt = canvasPoint(e);
  S().pointers.set(e.pointerId, pt);
  S().moved = false;
  S().downPt = pt;
  if (S().pointers.size === 2) {
    const pts = [...S().pointers.values()];
    S().pinch = {
      d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    };
  }
  if (S().mode === 'crop' && S().img && S().pointers.size === 1) {
    S().cropDragStart = W.s2i(pt);
    S().cropDragCur = { ...S().cropDragStart };
    W.render();
  }
});

cv.addEventListener('pointermove', (e) => {
  if (!S().pointers.has(e.pointerId) || !S().img) return;
  const prev = S().pointers.get(e.pointerId);
  const now = canvasPoint(e);
  S().pointers.set(e.pointerId, now);
  if (S().pointers.size === 2 && S().pinch) {
    const pts = [...S().pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    S().view.tx += mid.x - S().pinch.mid.x;
    S().view.ty += mid.y - S().pinch.mid.y;
    if (S().pinch.d > 10) W.zoomAt(mid, d / S().pinch.d);
    S().pinch.d = d; S().pinch.mid = mid;
    S().moved = true;
    return;
  }
  if (S().mode === 'crop' && S().cropDragStart) {
    S().cropDragCur = W.s2i(now);
    W.render();
    return;
  }
  const dx = now.x - prev.x, dy = now.y - prev.y;
  const movedFromDown = Math.hypot(now.x - (S().downPt ? S().downPt.x : now.x),
                                   now.y - (S().downPt ? S().downPt.y : now.y));
  if (movedFromDown > 10) {
    S().view.tx += dx; S().view.ty += dy;
    S().moved = true;
    W.render();
  }
});

cv.addEventListener('pointerup', (e) => {
  const pt = S().pointers.get(e.pointerId);
  S().pointers.delete(e.pointerId);
  if (S().pointers.size < 2) S().pinch = null;
  if (S().mode === 'crop' && S().cropDragStart) {
    const a = S().cropDragStart, b = S().cropDragCur || a;
    const dist = Math.hypot((W.i2s(a).x - W.i2s(b).x), (W.i2s(a).y - W.i2s(b).y));
    S().cropDragStart = null;
    S().cropDragCur = null;
    if (dist > 20) {
      S().crop = {
        x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
        x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
      };
      W.setStatus('已框选范围（自动描线只识别框内）');
      W.render();
      return;
    }
    W.render();
  }
  if (pt && !S().moved && (S().img || S().app === 'sketch')) handleTap(pt);
});

cv.addEventListener('pointercancel', (e) => {
  S().pointers.delete(e.pointerId);
  S().pinch = null;
});

function closeLoop() {
  if (S().segments.length < 2) { W.setStatus('线段太少'); return; }
  const key = p => `${Math.round(p.x / 6)},${Math.round(p.y / 6)}`;
  const deg = new Map();
  S().segments.forEach(sg => {
    [sg.a, sg.b].forEach(p => {
      const k = key(p);
      deg.set(k, (deg.get(k) || 0) + 1);
    });
  });
  const ends = [];
  S().segments.forEach(sg => {
    [sg.a, sg.b].forEach(p => { if (deg.get(key(p)) === 1) ends.push(p); });
  });
  if (ends.length < 2) { W.setStatus('没有可闭合的开口端点'); return; }
  // 只连接距离最近的一对端点（小缺口优先）
  let best = null;
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const d = Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y);
      if (!best || d < best.d) best = { i, j, d };
    }
  }
  pushUndo();
  S().segments.push({
    a: { ...ends[best.i] }, b: { ...ends[best.j] }, len: null, adj: '',
  });
  S().selected = { kind: 'seg', idx: S().segments.length - 1 };
  W.render(); W.refreshList();
  W.setStatus(`已闭合最近的缺口（${best.d.toFixed(0)} 像素），可再点一次继续闭合`);
}

// ---------- 事件绑定 ----------
$('btnOpen').onclick = () => $('fileInput').click();
$('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };
$('btnFit').onclick = () => W.fitView();
$('btnRot').onclick = () => { S().view.rot = (S().view.rot + 90) % 360; W.render(); };
$('btnJgCrop').onclick = () => { S().mode = 'crop'; W.setStatus('竣工图框选：点第一个角，再点对角'); };
$('btnJgTrace').onclick = () => { const b = $('btnCropTrace'); if (b) b.onclick(); };
$('btnJgAdaptive').onclick = () => {
  const r = window.JG.recognize(!!S().crop);
  if (!r.segs.length) { W.setStatus('灰/黄/黑识别：没识别到墙线'); return; }
  pushUndo();
  S().segments = r.segs; S().columns = r.cols; S().selected = null;
  W.render(); W.refreshList();
  W.setStatus(`灰/黄/黑识别：${r.segs.length} 条墙线，${r.cols.length} 个柱子`);
};
$('btnCropTrace').onclick = () => {
  if (S().app === 'jg') {
    (async () => {
      let r = null;
      try {
        if (window.__pdfPage && window.JGV) {
          W.setStatus('竣工图识别：读取 PDF 矢量…');
          r = await window.JGV.recognizeVector(window.__pdfPage, window.__pdfVp, S().crop);
          if (r && r.segs.length) r.vector = true;
        }
      } catch (e) {
        r = null;
      }
      if (!r || !r.segs.length) {
        r = window.JG.recognize(!!S().crop);
        r.vector = false;
      }
      if (!r.segs.length) { W.setStatus('竣工图识别：没识别到墙线'); return; }
      pushUndo();
      S().segments = r.segs;
      S().columns = r.cols;
      S().selected = null;
      W.render(); W.refreshList();
      W.setStatus(`竣工图识别（${r.vector ? '矢量' : '像素'}）：${r.segs.length} 条墙线，${r.cols.length} 个柱子`);
    })();
    return;
  }
  autoTrace(!!S().crop);
};
$('btnInterior').onclick = () => window.REC.interiorRecognize();
$('btnInteriorUndo').onclick = () => {
  if (S().interiorStart == null && !S().interior) { W.setStatus('当前没有内部识别结果'); return; }
  if (S().interiorStart != null) {
    S().segments.splice(S().interiorStart);
    S().interiorStart = null;
  }
  S().interior = null;
  S().selected = null;
  W.render(); W.refreshList();
  W.setStatus('已撤回内部识别，只保留外框');
};
$('btnClose').onclick = closeLoop;
$('btnUndo').onclick = undo;
$('btnBleToggle').onclick = () => {
  const dev = S().bleDevice;
  if (dev && dev.gatt && dev.gatt.connected) {
    window.BLE.disconnect();
    S().bleDevice = null; S().bleChar = null;
    W.setStatus('蓝牙已断开');
  } else {
    window.BLE.connect();
  }
};
$('btnBleLog').onclick = () => {
  const el = document.getElementById('bleLog');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
  if (el.style.display !== 'none') {
    el.textContent = S().blePackets.map((p, i) =>
      `${i + 1}. [${p.uuid}] f32=${isFinite(p.dist) ? p.dist.toFixed(4) : 'NaN'}  ${p.hex}`
    ).join('\n');
    el.scrollTop = el.scrollHeight;
  }
};

$('btnZoomIn').onclick = () => {
  if (!S().img) { W.setStatus('先打开图纸'); return; }
  const r = cv.getBoundingClientRect();
  W.zoomAt({ x: r.width / 2, y: r.height / 2 }, 1.25);
};
$('btnZoomOut').onclick = () => {
  if (!S().img) { W.setStatus('先打开图纸'); return; }
  const r = cv.getBoundingClientRect();
  W.zoomAt({ x: r.width / 2, y: r.height / 2 }, 0.8);
};
$('btnCropClear').onclick = () => { S().crop = null; W.setStatus('已清除框选'); W.render(); };
$('btnInputLen').onclick = () => {
  const it = W.itemOf(S().selected);
  if (!it) { W.setStatus('先选中一条'); return; }
  const s = prompt('输入长度（米）', it.len == null ? '' : String(it.len));
  if (s == null) return;
  const v = parseFloat(String(s).replace(/m/ig, ''));
  if (isNaN(v)) { W.setStatus('长度无效'); return; }
  pushUndo();
  it.len = v;
  W.render(); W.refreshList(); W.setStatus('已输入长度');
};
$('btnClearAll').onclick = () => {
  if (!S().segments.length && !S().notes.length) return;
  if (!confirm('清空所有线段和注记？')) return;
  pushUndo();
  S().segments = []; S().notes = []; S().selected = null; S().anchor = null; S().crop = null;
  W.render(); W.refreshList(); W.setStatus('已清空');
};
$('btnPhoto').onclick = () => {
  if (!S().selected) { W.setStatus('先选中一条再拍照'); return; }
  $('photoInput').click();
};
$('btnPickPhoto').onclick = () => {
  if (!S().selected) { W.setStatus('先选中一条再选图片'); return; }
  $('photoInput').click();
};
$('photoInput').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const it = W.itemOf(S().selected);
  if (!it) return;
  const rd = new FileReader();
  rd.onload = () => {
    it.photo = rd.result;
    it.photoName = f.name;
    W.refreshList(); W.setStatus('已关联照片：' + f.name);
  };
  rd.readAsDataURL(f);
};
$('btnViewPhoto').onclick = () => {
  const it = W.itemOf(S().selected);
  if (!it || !it.photo) { W.setStatus('该条没有照片'); return; }
  const w = window.open('');
  w.document.write('<title>照片</title><img style="max-width:100%" src="' + it.photo + '">');
};

document.querySelectorAll('[data-mode]').forEach(btn => {
  btn.onclick = () => {
    S().mode = btn.dataset.mode;
    S().pending = null;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
    S().pending = null;
    if (S().mode !== 'draw') S().anchor = null;
    W.setStatus({
      draw: '手绘：连续点，相邻点自动连线',
      select: '点选：点线或数字选中',
      addline: '加线：点起点（自动吸附）、点终点，自动横平竖直并断开 T 形接头',
      split: '分割：先点选一条线，再点分割位置',
      note: '点注：点两个点，数字放中间',
      crop: '框选范围：点第一个角，再点对角',
        free: '斜线：点起点（靠近端点/线），再点终点',
    }[S().mode]);
    W.render();
  };
});

$('btnDelete').onclick = () => {
  if (!S().selected) { W.setStatus('先选中一条'); return; }
  pushUndo();
  if (S().selected.kind === 'seg') S().segments.splice(S().selected.idx, 1);
  else S().notes.splice(S().selected.idx, 1);
  S().selected = null;
  W.render(); W.refreshList(); W.setStatus('已删除');
};

$('btnAutoAcc').onclick = () => {
  S().autoAcc = !S().autoAcc;
  $('btnAutoAcc').textContent = '自动累加:' + (S().autoAcc ? '开' : '关');
  W.setStatus(S().autoAcc
    ? '自动累加已开：每按一次测量，读数累加到当前选中项'
    : '自动累加已关：取设备最新读数（徕卡 + 模式已自带累加）');
};
$('btnAccMinus').onclick = () => {
  S().accSign = -1;
  W.setStatus('下一笔测量将做减法（只减一次）');
};
$('btnAccZero').onclick = () => {
  S().accValue = 0;
  S().accSel = null;
  S().accSign = 1;
  const it = W.itemOf(S().selected);
  if (it) it.len = null;
  W.render(); W.refreshList();
  W.setStatus('累加已归零');
};
$('adj').onchange = () => {
  if (!S().selected) { W.setStatus('先在图上或列表里选中一条'); return; }
  const it = W.itemOf(S().selected);
  if (!it) { W.setStatus('先选中一条'); return; }
  pushUndo();
  it.adj = $('adj').value;
  W.render(); W.refreshList();
  W.setStatus(it.adj ? `已设置属性 ${it.adj}` : '已清除属性');
};
$('btnApplyAdj').onclick = () => {
  const it = W.itemOf(S().selected);
  if (!it) { W.setStatus('先选中一条'); return; }
  it.adj = $('adj').value;
  W.render(); W.refreshList();
  W.setStatus('已设置属性 ' + (it.adj || '无'));
};

$('btnCsv').onclick = () => window.EXP.exportCsv();
$('btnPdf').onclick = () => window.EXP.exportPdf();

$('btnPanel').onclick = () => {
  const p = $('panel');
  p.classList.toggle('collapsed');
  $('btnPanel').textContent = p.classList.contains('collapsed') ? '展开' : '收起';
  requestAnimationFrame(() => requestAnimationFrame(W.resizeCanvas));
};

window.__waice = {
  get state() { return S; },
  autoTrace,
  loadTestImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const off = document.createElement('canvas');
        off.width = im.width; off.height = im.height;
        off.getContext('2d').drawImage(im, 0, 0);
        S().img = off;
        W.fitView();
        autoTrace(false);
        resolve({ segments: S().segments.length, crop: S().crop });
      };
      im.onerror = reject;
      im.src = src;
    });
  },
};

if (location.search.includes('autotest')) {
  setTimeout(() => {
    window.__waice.loadTestImage('test.png').then(r => {
      const st = window.__traceStats || {};
      W.setStatus('STATS ' + JSON.stringify(st));
      document.title = 'AUTOTEST_OK ' + JSON.stringify(st);
    }).catch(e => { document.title = 'AUTOTEST_FAIL ' + e.message; });
  }, 300);
}

$('btnUndoPoint').onclick = () => {
  const st = S();
  if (st.anchor && st.segments.length) {
    const last = st.segments[st.segments.length - 1];
    st.segments.pop();
    st.anchor = last.a;
    W.render(); W.refreshList(); W.setStatus('已撤销上一点');
  } else {
    W.setStatus('没有可撤销的点');
  }
};
$('btnFinishDraw').onclick = () => {
  const st = S();
  st.anchor = null;
  W.render(); W.setStatus('绘制完成，可点选线段输入/测量长度');
};
function renderInfoBar() {
  const bar = document.getElementById('infoBar');
  if (!bar) return;
  const it = W.itemOf(S().selected);
  if (!it) {
    document.getElementById('infoTitle').textContent = '未选中';
    document.getElementById('infoLen').textContent = '';
    document.getElementById('infoAdj').textContent = '';
    const tot0 = document.getElementById('infoTotal');
    if (tot0) tot0.textContent = '';
    const link0 = document.getElementById('infoPhotoLink');
    link0.style.display = 'none';
    return;
  }
  const kind = S().selected.kind;
  const isSeg = kind === 'seg';
  const idx = S().selected.idx + 1;
  let title = (kind === 'total' ? '总长' : (isSeg ? '段' : '点')) + idx;
  let lenTxt = it.len == null ? '长度：未测' : '长度：' + it.len.toFixed(4) + ' m';
  let adjTxt = it.adj ? '属性：' + it.adj : '';
  if (it.len != null && it.adj) adjTxt += '　修正后：' + W.corrected(it).toFixed(4) + ' m';
  document.getElementById('infoTitle').textContent = title;
  document.getElementById('infoLen').textContent = lenTxt;
  document.getElementById('infoAdj').textContent = adjTxt;
  const totEl = document.getElementById('infoTotal');
  if (totEl) {
    const sumT = (S().totals || []).reduce((acc, x) => acc + (x.len || 0), 0);
    if (S().totals && S().totals.length) {
      let warn = false;
      S().totals.forEach(tt => {
        if (tt.len == null || !tt.children) return;
        const kids = tt.children.map(cid => S().segments.find(x => x.id === cid)).filter(Boolean);
        if (kids.length && kids.every(k => k.len != null)) {
          const ksum = kids.reduce((a, k) => a + (k.len || 0), 0);
          if (Math.abs(ksum - tt.len) > 0.01) warn = true;
        }
      });
      totEl.textContent = '总长：' + sumT.toFixed(4) + ' m（' + S().totals.length + ' 段）' + (warn ? ' !' : '');
    } else totEl.textContent = '';
  }
  const link = document.getElementById('infoPhotoLink');
  if (it.photo) { link.style.display = ''; link.href = it.photo; }
  else link.style.display = 'none';
}
function openPhotoModal() {
  const it = W.itemOf(S().selected);
  if (!it || !it.photo) { W.setStatus('该条没有照片'); return; }
  document.getElementById('photoModalImg').src = it.photo;
  document.getElementById('photoModal').classList.add('open');
}
$('photoModalClose').onclick = () => {
  document.getElementById('photoModal').classList.remove('open');
  document.getElementById('photoModalImg').src = '';
};
document.getElementById('infoPhotoLink').onclick = (e) => { e.preventDefault(); openPhotoModal(); };
$('btnInfoPhoto').onclick = () => { $('btnPhoto').onclick(); };
$('btnInfoPick').onclick = () => { $('btnPickPhoto').onclick(); };
$('btnSign').onclick = () => { if (window.SIGN) window.SIGN.open(); };
function adjustPolygon(segs) {
  // 需要闭合且每段都有长度
  for (let i = 0; i < segs.length; i++) {
    const cur = segs[i], nxt = segs[(i + 1) % segs.length];
    if (Math.hypot(cur.b.x - nxt.a.x, cur.b.y - nxt.a.y) > 25) return { error: '线段没有首尾相接，请先点「闭合」' };
    if (cur.len == null) return { error: '还有线段没有长度' };
  }
  const dirs = segs.map(s => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const n = Math.hypot(dx, dy) || 1;
    return { x: dx / n, y: dy / n };
  });
  const ratios = [];
  segs.forEach((s, i) => {
    const drawn = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    if (drawn > 5 && s.len) ratios.push(drawn / s.len);
  });
  const sc = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
  const pts = [{ x: segs[0].a.x, y: segs[0].a.y }];
  segs.forEach((s, i) => {
    const prev = pts[pts.length - 1];
    pts.push({ x: prev.x + dirs[i].x * s.len * sc, y: prev.y + dirs[i].y * s.len * sc });
  });
  const cx = pts[pts.length - 1].x - pts[0].x;
  const cy = pts[pts.length - 1].y - pts[0].y;
  const cum = [0];
  segs.forEach(s => cum.push(cum[cum.length - 1] + s.len));
  const total = cum[cum.length - 1] || 1;
  const out = [{ x: pts[0].x, y: pts[0].y }];
  for (let k = 1; k < pts.length; k++) {
    const f = cum[k] / total;
    out.push({ x: pts[k].x - cx * f, y: pts[k].y - cy * f });
  }
  return { pts: out };
}
$('btnAdjust').onclick = () => {
  const st = S();
  if (st.segments.length < 3) { W.setStatus('至少 3 条线段才能平差'); return; }
  const r = adjustPolygon(st.segments);
  if (r.error) { W.setStatus(r.error); return; }
  pushUndo();
  st.segments.forEach((s, i) => {
    s.a = { ...r.pts[i] };
    s.b = { ...r.pts[(i + 1) % st.segments.length] };
  });
  W.render(); W.refreshList();
  W.setStatus('已平差：按各段长度重新分配点位');
};
$('btnRelay').onclick = () => {
  if (window.RELAY.active) {
    window.RELAY.disconnect();
    W.setStatus('已断开手机连接');
    return;
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  window.RELAY.connect(code, 'tablet');
  W.setStatus('手机配对码：' + code + '（手机端输入此码）');
};
$('btnMore').onclick = () => {
  const m = $('moreRow');
  m.classList.toggle('open');
  $('btnMore').textContent = m.classList.contains('open') ? '收起更多' : '更多';
  requestAnimationFrame(() => requestAnimationFrame(W.resizeCanvas));
};
if (window.ResizeObserver) {
  new ResizeObserver(() => requestAnimationFrame(W.resizeCanvas))
    .observe(document.getElementById('stage'));
}
if (location.search.includes('uotest')) setTimeout(() => {
  const cases = [
    ['rect2', [3, 4]],
    ['L4', [10, 8, 3, 2]],
    ['U5', [10, 8, 2, 3, 6]],
    ['T5', [10, 4, 5, 2, 2]],
    ['L6', [10, 8, 3, 2, 7, 6]],
    ['U8', [10, 8, 2, 6, 5, 6, 3, 8]],
    ['T8', [10, 4, 5, 2, 2, 2, 3, 4]],
    ['stair8', [10, 8, 3, 2, 4, 2, 7, 6]],
  ];
  const out = cases.map(([name, lens]) => {
    try {
      const r = window.UOR.uoMatch(lens, 20);
      const names = (r.candidates || []).slice(0, 3).map(c => `${c.name}/${c.residual_mm.toFixed(1)}`);
      return `${name}(${lens.length}): ${names.length ? names.join('|') : (r.error || 'none')}`;
    } catch (e) {
      return `${name}: ERR ${e.message}`;
    }
  });
  const el = document.getElementById('list');
  if (el) el.textContent = 'UOTEST ' + out.join(' ; ');
}, 300);
// BLE 接口层：将来做成 App 时换成本地插件实现，上层不用改


  function clearAll() {
    const s = S();
    if (typeof pushUndo === 'function') pushUndo();
    s.segments = []; s.notes = []; s.totals = []; s.selected = null;
    s.interior = null; s.interiorStart = null; s.crop = null;
    s.pending = null; s.anchor = null; s.addFrom = null;
    W.render(); W.refreshList(); W.setStatus('已清空');
  }

  window.INT = {
    init(h) { W = h; },
    autoTrace,
    handleTap,
    renderInfoBar,
    pushUndo,
    undo,
    clearAll,
    saveState: null,
  };
})();
