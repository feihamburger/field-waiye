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
      ? { a: { x: o.c, y: o.a0 }, b: { x: o.c, y: o.a1 }, len: null, adj: (window.defAdj ? window.defAdj() : '') }
      : { a: { x: o.a0, y: o.c }, b: { x: o.a1, y: o.c }, len: null, adj: (window.defAdj ? window.defAdj() : '') });
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
      ? { a: { x: o.c, y: o.a0 }, b: { x: o.c, y: o.a1 }, len: null, adj: (window.defAdj ? window.defAdj() : '') }
      : { a: { x: o.a0, y: o.c }, b: { x: o.a1, y: o.c }, len: null, adj: (window.defAdj ? window.defAdj() : '') });
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
    if (sg.noMeasure || sg.neighborStair) return;
    const a = W.i2s(sg.a), b = W.i2s(sg.b);
    const r = distToSeg(pt, a, b);
    if (r.d <= 24 && (!best || r.d < best.d)) best = { idx: i, d: r.d, t: r.t };
  });
  return best;
}

function hitTotal(pt) {
  const S2 = S();
  if (!S2.totals || !S2.totals.length) return null;
  let cxx = 0, cyy = 0, np2 = 0;
  S2.segments.forEach(sg => {
    if (sg.balcony || sg.stair || sg.sizhiDim || sg.neighborWall) return;
    cxx += sg.a.x + sg.b.x; cyy += sg.a.y + sg.b.y; np2 += 2;
  });
  cxx /= Math.max(1, np2); cyy /= Math.max(1, np2);
  let best = null;
  S2.totals.forEach((tt, idx) => {
    if (!tt.a || !tt.b) return;
    const dx = tt.b.x - tt.a.x, dy = tt.b.y - tt.a.y;
    const L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    const midx = (tt.a.x + tt.b.x) / 2, midy = (tt.a.y + tt.b.y) / 2;
    if ((midx - cxx) * nx + (midy - cyy) * ny < 0) { nx = -nx; ny = -ny; }
    const a = W.i2s({ x: tt.a.x + nx * 70, y: tt.a.y + ny * 70 });
    const b = W.i2s({ x: tt.b.x + nx * 70, y: tt.b.y + ny * 70 });
    const r = distToSeg(pt, a, b);
    if (r.d <= 26 && (!best || r.d < best.d)) best = { idx, d: r.d };
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
  s.totals.push({ a: { ...sg.a }, b: { ...sg.b }, len: sg.len, adj: sg.adj || '+0+0', children: [id1, id2], id: id0 });
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
  const dadj = sg.adj || '+0+0';
  const s1 = { a: { ...sg.a }, b: { ...pp }, len: null, adj: dadj, id: id1 };
  const s2 = { a: { ...pp }, b: { ...sg.b }, len: null, adj: dadj, id: id2 };
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
function stairAdd(a, b, withLabel) {
  const s = S();
  const gid = s.stairGid;
  const near = (p, q) => Math.abs(p.x - q.x) < 1 && Math.abs(p.y - q.y) < 1;
  let merged = false;
  for (let i = s.segments.length - 1; i >= 0; i--) {
    const sg = s.segments[i];
    if (!sg.stair || sg.stairId !== gid) continue;
    const sameA = near(sg.a, a), sameB = near(sg.b, a);
    if (!sameA && !sameB) continue;
    const other = sameA ? sg.b : sg.a;
    const dir = { x: a.x - other.x, y: a.y - other.y };
    const newDir = { x: b.x - a.x, y: b.y - a.y };
    const sameOrient = (Math.abs(sg.a.y - sg.b.y) < 1) === (Math.abs(b.y - a.y) < 1);
    const forward = dir.x * newDir.x + dir.y * newDir.y > 0;
    if (sameOrient && forward) {
      if (sameA) sg.a = { ...b }; else sg.b = { ...b };
      if (withLabel) sg.stairLabel = true;
      merged = true;
    }
    break;
  }
  if (!merged) {
    s.segments.push({ a: { ...a }, b: { ...b }, len: null, adj: (window.defAdj ? window.defAdj() : ''), stair: true, stairLabel: !!withLabel, stairId: gid });
  }
  return true;
}

function tidyStair(gid) {
  const s = S();
  let removed = 0;
  s.segments = s.segments.filter(sg => {
    if (sg.stair && sg.stairId === gid) {
      const d = Math.hypot(sg.a.x - sg.b.x, sg.a.y - sg.b.y);
      if (d < 1) { removed++; return false; }
    }
    return true;
  });
  return removed;
}


function shrinkImage(file, cb) {
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxD = 1200;
      const sc2 = Math.min(1, maxD / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc2);
      c.height = Math.round(img.height * sc2);
      const g2 = c.getContext('2d');
      g2.drawImage(img, 0, 0, c.width, c.height);
      // 当天日期时间水印（烧录进照片，不可修改）
      const d = new Date();
      const pad = (n) => (n < 10 ? '0' + n : '' + n);
      const wtxt = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      const fs = Math.max(14, Math.round(c.width * 0.028));
      g2.font = 'bold ' + fs + 'px sans-serif';
      const tw = g2.measureText(wtxt).width;
      const px = c.width - tw - fs, py = c.height - fs * 0.9;
      g2.fillStyle = 'rgba(0,0,0,0.45)';
      g2.fillRect(c.width - tw - fs * 1.6, c.height - fs * 1.8, tw + fs * 1.2, fs * 1.5);
      g2.fillStyle = '#fff';
      g2.textAlign = 'left'; g2.textBaseline = 'alphabetic';
      g2.fillText(wtxt, px, py);
      cb(c.toDataURL('image/jpeg', 0.75));
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

function wallDirName(sg) {
  const S0 = S();
  let cx = 0, cy = 0, np = 0;
  S0.segments.forEach(g => {
    if (g.balcony || g.stair || g.sizhiDim || g.neighborWall) return;
    cx += g.a.x + g.b.x; cy += g.a.y + g.b.y; np += 2;
  });
  cx /= Math.max(1, np); cy /= Math.max(1, np);
  const mx = (sg.a.x + sg.b.x) / 2, my = (sg.a.y + sg.b.y) / 2;
  let ang = Math.atan2(mx - cx, -(my - cy)) * 180 / Math.PI;
  const north = (typeof S0.north === 'number') ? S0.north : 0;
  let bearing = ((north + ang) % 360 + 360) % 360;
  const names = ['北', '东', '南', '西'];
  let bi = 0, bd = 1e9;
  [0, 90, 180, 270].forEach((b, i) => {
    let d = Math.abs(((bearing - b) % 360 + 360) % 360);
    d = Math.min(d, 360 - d);
    if (d < bd) { bd = d; bi = i; }
  });
  return names[bi];
}

function splitAtPointInAll(ip, recordTotals, defAdj) {
  const tol = 8;
  for (let i = 0; i < S().segments.length; i++) {
    const sg = S().segments[i];
    if (sg.neighborWall || sg.noMeasure) continue;
    const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    let tt = ((ip.x - ax) * dx + (ip.y - ay) * dy) / L2;
    if (tt <= 0.02 || tt >= 0.98) continue;
    const q = { x: ax + dx * tt, y: ay + dy * tt };
    if (Math.hypot(ip.x - q.x, ip.y - q.y) > tol) continue;
    const id1 = nextSegId(), id2 = nextSegId();
    if (recordTotals !== false) recordSplitTotal(sg, id1, id2);
    const dadj = sg.adj || defAdj || '+0+0';
    S().segments[i] = { a: { ...sg.a }, b: { ...q }, len: null, adj: dadj, id: id1 };
    S().segments.splice(i + 1, 0, { a: { ...q }, b: { ...sg.b }, len: null, adj: dadj, id: id2 });
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
    if (d <= 45 && (!best || d < best.d)) best = { d, p: { x: c.x, y: c.y }, kind: '端点' };
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
    if (d <= 45 && (!best || d < best.d)) best = { d, p: q, kind: '线上' };
  }
  return best;
}

function balconyGroupHit(ip) {
  const st = S();
  const groups = [];
  st.segments.forEach(sg => {
    if (!sg.balcony) return;
    const key = sg.balconyId || 'g';
    let g = groups.find(x => x.id === key);
    if (!g) { g = { id: key, segs: [] }; groups.push(g); }
    g.segs.push(sg);
  });
  for (const g of groups) {
    const pts = [];
    g.segs.forEach(sg => { pts.push(sg.a, sg.b); });
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    if (ip.x >= Math.min(...xs) && ip.x <= Math.max(...xs) && ip.y >= Math.min(...ys) && ip.y <= Math.max(...ys)) {
      return g;
    }
  }
  return null;
}

function translateGroup(segs, dx, dy) {
  segs.forEach(sg => {
    sg.a = { x: sg.a.x + dx, y: sg.a.y + dy };
    sg.b = { x: sg.b.x + dx, y: sg.b.y + dy };
  });
}

function makeBalconyDraft() {
  const S2 = S();
  const segs = S2.segments.filter(sg => !sg.balcony);
  if (!segs.length) { W.setStatus('先建好宅基地轮廓'); return; }
  // 清掉旧的未提交草稿
  S2.segments = S2.segments.filter(sg => !(sg.balcony && sg.draft));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  segs.forEach(sg => [sg.a, sg.b].forEach(p => {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }));
  const W2 = maxx - minx, H2 = maxy - miny;
  const w = Math.max(120, W2 * 0.35);
  const d = Math.max(80, Math.min(H2 * 0.25, w * 0.8));
  const x0 = (minx + maxx) / 2 - w / 2;
  const y0 = miny + H2 * 0.18;
  const A = { x: x0, y: y0 }, B = { x: x0 + w, y: y0 };
  const C = { x: x0 + w, y: y0 + d }, D = { x: x0, y: y0 + d };
  const gid = 'balc' + Date.now();
  [[A, B], [B, C], [C, D], [D, A]].forEach(([p1, p2], idx) => {
    S2.segments.push({ a: { ...p1 }, b: { ...p2 }, len: null, adj: (window.defAdj ? window.defAdj() : ''), balcony: true, draft: true, balconyId: gid, balconyLabel: idx === 2 });
  });
  S2.balconyDragging = null;
  W.render();
  W.setStatus('已放置阳台（虚线框）：拖动它到墙边，松手自动吸附并分割墙面');
}

function draftTranslate(dx, dy) {
  const S2 = S();
  S2.segments.forEach(sg => {
    if (sg.balcony && sg.draft) {
      sg.a = { x: sg.a.x + dx, y: sg.a.y + dy };
      sg.b = { x: sg.b.x + dx, y: sg.b.y + dy };
    }
  });
}

function commitBalcony() {
  const S2 = S();
  const draftSegs = S2.segments.filter(sg => sg.balcony && sg.draft);
  if (!draftSegs.length) return;
  const pts = [];
  draftSegs.forEach(sg => { pts.push(sg.a, sg.b); });
  if (pts.length < 4) return;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  let cx = 0, cy = 0, np = 0;
  S2.segments.forEach(sg => { if (!sg.balcony && !sg.neighborWall && !sg.stair && !sg.sizhiDim) { cx += sg.a.x + sg.b.x; cy += sg.a.y + sg.b.y; np += 2; } });
  cx /= Math.max(1, np); cy /= Math.max(1, np);
  // 找最近外墙
  let best = null;
  S2.segments.forEach(sg => {
    if (sg.balcony || sg.neighborWall) return;
    const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1;
    let tt = ((cx - ax) * dx + (cy - ay) * dy) / L2;
    tt = Math.max(0, Math.min(1, tt));
    const q = { x: ax + dx * tt, y: ay + dy * tt };
    const d = Math.hypot(cx - q.x, cy - q.y);
    if (!best || d < best.d) best = { d, q, ax, ay, bx, by, L: Math.sqrt(L2) };
  });
  if (!best) return;
  const horizontal = Math.abs(best.by - best.ay) < Math.abs(best.bx - best.ax);
  const wDraft = x1 - x0, hDraft = y1 - y0;
  let shiftX = 0, shiftY = 0;
  if (horizontal) {
    // 贴到墙上，矩形在墙的内侧（质心一侧）
    const wallY = best.ay;
    const insideDown = cy > wallY;
    const targetTop = insideDown ? wallY : wallY - hDraft;
    shiftY = targetTop - y0;
    // 水平方向夹在墙段内
    const lo = Math.min(best.ax, best.bx), hi = Math.max(best.ax, best.bx);
    if (x0 < lo) shiftX = lo - x0;
    if (x1 > hi) shiftX = hi - x1;
  } else {
    const wallX = best.ax;
    const insideRight = cx > wallX;
    const targetLeft = insideRight ? wallX : wallX - wDraft;
    shiftX = targetLeft - x0;
    const lo = Math.min(best.ay, best.by), hi = Math.max(best.ay, best.by);
    if (y0 < lo) shiftY = lo - y0;
    if (y1 > hi) shiftY = hi - y1;
  }
  if (shiftX || shiftY) draftTranslate(shiftX, shiftY);
  const pts2 = [];
  draftSegs.forEach(sg => { pts2.push(sg.a, sg.b); });
  const nx0 = Math.min(...pts2.map(p => p.x)), nx1 = Math.max(...pts2.map(p => p.x));
  const ny0 = Math.min(...pts2.map(p => p.y)), ny1 = Math.max(...pts2.map(p => p.y));
  const A2 = { x: nx0, y: ny0 }, B2 = { x: nx1, y: ny0 }, C2 = { x: nx1, y: ny1 }, D2 = { x: nx0, y: ny1 };
  splitAtPointInAll(horizontal ? { x: nx0, y: best.ay } : { x: best.ax, y: ny0 }, false);
  splitAtPointInAll(horizontal ? { x: nx1, y: best.ay } : { x: best.ax, y: ny1 }, false);
  S2.segments.forEach(sg => { if (sg.balcony && sg.draft) { sg.draft = false; } });
  S2.balconies = S2.balconies || [];
  S2.balconies.push({ A: A2, B: B2, A2: D2, B2: C2 });
  W.render(); W.refreshList();
  W.setStatus('阳台已吸附并固定，墙面已分割');
}

let nbrEditing = null;
function openNbrEditor(side, idx) {
  const S2 = S();
  const it = S2.sizhi && S2.sizhi[side];
  if (!it || !it.adj) return;
  const labels = it.adj.labels || [];
  const lb = labels[idx] || {};
  nbrEditing = { side, idx };
  document.getElementById('nbrDoor').value = lb.door || '';
  document.getElementById('nbrStruct').value = lb.struct || '';
  document.getElementById('nbrFloors').value = lb.floors || '';
  document.getElementById('nbrModal').classList.add('open');
}

function textAnchorAt(ip) {
  const S2 = S();
  const segs = S2.segments.filter(sg => !sg.stair && !sg.balcony && !sg.sizhiDim && !sg.neighborWall);
  if (!segs.length) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  segs.forEach(sg => [sg.a, sg.b].forEach(p => {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }));
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const near = 150, far = 260;
  const anchors = [];
  if (S2.sizhi) {
    const tp = {
      up: [cx, miny - near], right: [maxx + near, cy],
      down: [cx, maxy + near], left: [minx - near, cy],
    };
    const np = {
      up: [cx, miny - far - 48], down: [cx, maxy + far + 48],
      left: [minx - far - 70, cy], right: [maxx + far + 70, cy],
    };
    ['up', 'right', 'down', 'left'].forEach(side => {
      const it = S2.sizhi[side];
      if (!it) return;
      anchors.push({ kind: 'sizhi', side, pos: { x: tp[side][0], y: tp[side][1] } });
      if (it.adj && it.adj.on) {
        const labels = it.adj.labels || [{ door: it.adj.door, struct: it.adj.struct, floors: it.adj.floors }];
        labels.forEach((lb, idx) => {
          if (!lb) return;
          const frac = idx === 0 ? 0.28 : 0.72;
          let p2;
          if (side === 'up') p2 = { x: minx + (maxx - minx) * frac, y: miny - far - 36 };
          else if (side === 'down') p2 = { x: minx + (maxx - minx) * frac, y: maxy + far + 36 };
          else if (side === 'left') p2 = { x: minx - far - 40, y: miny + (maxy - miny) * frac };
          else p2 = { x: maxx + far + 40, y: miny + (maxy - miny) * frac };
          anchors.push({ kind: 'nbr', side, idx, pos: p2 });
        });
      }
    });
  }
  (S2.doors || []).forEach((d, i) => anchors.push({ kind: 'door', idx: i, pos: d.pos }));
  let best = null;
  anchors.forEach(a => {
    const q = W.i2s(a.pos), b = W.i2s(ip);
    const d = Math.hypot(q.x - b.x, q.y - b.y);
    if (d <= 46 && (!best || d < best.d)) best = { ...a, d };
  });
  return best;
}


function roofLoopPolygon() {
  const segs = S().segments.filter(sg => !sg.stair && !sg.balcony && !sg.sizhiDim && !sg.neighborWall && !sg.roofOpen);
  if (!segs.length) return null;
  const key = (p) => p.x + ',' + p.y;
  const adj = new Map();
  segs.forEach((sg, i) => {
    const ka = key(sg.a), kb = key(sg.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ i, other: sg.b, pt: sg.a });
    adj.get(kb).push({ i, other: sg.a, pt: sg.b });
  });
  const first = segs[0];
  const pts = [{ ...first.a }];
  let curPt = { ...first.b };
  const used = new Set([0]);
  const firstKey = key(first.a);
  let guard = 0;
  while (guard++ < 400) {
    pts.push({ ...curPt });
    const nk = key(curPt);
    if (nk === firstKey) break;
    const cands = (adj.get(nk) || []).filter(c => !used.has(c.i));
    if (!cands.length) break;
    const nx = cands[0];
    used.add(nx.i);
    curPt = { ...nx.other };
  }
  return pts.length >= 3 ? pts : null;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const inter = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-12) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

function applyRoofPick(tapPt) {
  const S0 = S();
  const rp = S0.roofPick;
  if (!rp) return false;
  const poly = roofLoopPolygon();
  const chain0 = S0.segments.filter(sg => sg.stair && sg.stairId === rp.stairId);
  if (!poly || !chain0.length) { S0.mode = 'select'; S0.roofPick = null; W.render(); return true; }
  const kk = (p) => p.x + ',' + p.y;
  const remain = chain0.map(sg => ({ a: { ...sg.a }, b: { ...sg.b } }));
  let cur = rp.start ? { ...rp.start } : { ...remain[0].a };
  const chainPts = [{ ...cur }];
  const used = new Set();
  let guard = 0;
  while (used.size < remain.length && guard++ < 100) {
    const ni = remain.findIndex((sg, i) => !used.has(i) && (kk(sg.a) === kk(cur) || kk(sg.b) === kk(cur)));
    if (ni < 0) break;
    used.add(ni);
    cur = (kk(remain[ni].a) === kk(cur)) ? { ...remain[ni].b } : { ...remain[ni].a };
    chainPts.push({ ...cur });
  }
  const A = chainPts[0], B = chainPts[chainPts.length - 1];
  const idxOf = (pt) => poly.findIndex(p => Math.hypot(p.x - pt.x, p.y - pt.y) < 1);
  const ia = idxOf(A), ib = idxOf(B);
  if (ia < 0 || ib < 0) { W.setStatus('梯屋端点不在天面轮廓上'); S0.mode = 'select'; S0.roofPick = null; W.render(); return true; }
  const arc1 = [];
  for (let i = ia; ; i = (i + 1) % poly.length) { arc1.push(poly[i]); if (i === ib) break; }
  const arc2 = [];
  for (let i = ib; ; i = (i + 1) % poly.length) { arc2.push(poly[i]); if (i === ia) break; }
  const poly1 = arc1.concat(chainPts.slice(1, -1).reverse());
  const poly2 = arc2.concat(chainPts.slice(1, -1));
  const in1 = pointInPoly(tapPt, poly1);
  const in2 = pointInPoly(tapPt, poly2);
  const dashArc = in1 ? arc2 : arc1;
  const dashKeys = new Set();
  for (let i = 0; i + 1 < dashArc.length; i++) {
    dashKeys.add(kk(dashArc[i]) + '|' + kk(dashArc[i + 1]));
    dashKeys.add(kk(dashArc[i + 1]) + '|' + kk(dashArc[i]));
  }
  S0.segments.forEach(sg => {
    if (sg.stair || sg.balcony || sg.sizhiDim || sg.neighborWall) return;
    const k = kk(sg.a) + '|' + kk(sg.b);
    sg.roofOpen = dashKeys.has(k) || dashKeys.has(kk(sg.b) + '|' + kk(sg.a));
  });
  S0.mode = 'select';
  S0.roofPick = null;
  S0.selected = null;
  W.render(); W.refreshList();
  W.setStatus((in1 || in2) ? '已保留所选一侧：另一侧天面用虚线表示（露天）' : '点选位置不在天面内，请重试');
  return true;
}



function buildOutlineLoop() {
  const segs = S().segments.filter(sg => !sg.stair && !sg.balcony && !sg.sizhiDim && !sg.neighborWall && !sg.roofOpen);
  if (segs.length < 3) return null;
  const key = (p) => Math.round(p.x) + ',' + Math.round(p.y);
  const adj = new Map();
  segs.forEach((sg, i) => {
    const ka = key(sg.a), kb = key(sg.b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ i, other: sg.b });
    adj.get(kb).push({ i, other: sg.a });
  });
  let startK = null;
  for (const [k, list] of adj) { if (list.length === 2) { startK = k; break; } }
  if (!startK) return null;
  const pts = [startK];
  const used = new Set();
  let cur = startK;
  let guard = 0;
  while (guard++ < 500) {
    const cands = (adj.get(cur) || []).filter(e => !used.has(e.i));
    if (!cands.length) break;
    const e = cands[0];
    used.add(e.i);
    const nk = key(e.other);
    pts.push(nk);
    if (nk === startK) break;
    cur = nk;
  }
  if (pts.length < 4) return null;
  return pts.slice(0, -1).map(k => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
}

function chainOrdered(start, stairId) {
  const segs = S().segments.filter(sg => sg.stair && sg.stairId === stairId);
  if (!segs.length) return null;
  const kk = (p) => Math.round(p.x) + ',' + Math.round(p.y);
  const remain = segs.map(sg => ({ a: { ...sg.a }, b: { ...sg.b } }));
  const used = new Set();
  let cur = { ...start };
  const pts = [{ ...cur }];
  let guard = 0;
  while (used.size < remain.length && guard++ < 200) {
    const ni = remain.findIndex((sg, i) => !used.has(i) && (kk(sg.a) === kk(cur) || kk(sg.b) === kk(cur)));
    if (ni < 0) break;
    used.add(ni);
    cur = (kk(remain[ni].a) === kk(cur)) ? { ...remain[ni].b } : { ...remain[ni].a };
    pts.push({ ...cur });
  }
  return pts;
}

function splitRoofRegions(A, B) {
  const S0 = S();
  const loop = buildOutlineLoop();
  const rop = S0.roofPending;
  const stairId = S0.segments.filter(sg => sg.stair).slice(-1)[0] && S0.segments.filter(sg => sg.stair).slice(-1)[0].stairId;
  if (!loop) return false;
  const nearIdx = (pt) => {
    let bi = -1, bd = 1e9;
    loop.forEach((p, i) => {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < bd) { bd = d; bi = i; }
    });
    return bd <= 45 ? bi : -1;
  };
  const ia = nearIdx(A), ib = nearIdx(B);
  if (ia < 0 || ib < 0) return false;
  if (Math.hypot(A.x - B.x, A.y - B.y) < 5) return false;
  const id = stairId || (rop && rop.stairId);
  const chain = id ? chainOrdered(A, id) : [A, B];
  if (!chain || chain.length < 2) return false;
  let cpts = chain;
  // 方向：从 A 到 B
  if (Math.hypot(cpts[0].x - B.x, cpts[0].y - B.y) < Math.hypot(cpts[0].x - A.x, cpts[0].y - A.y)) cpts = cpts.slice().reverse();
  const inner = cpts.slice(1, -1);
  const arc1 = [], arc2 = [];
  for (let i = ia; ; i = (i + 1) % loop.length) { arc1.push(loop[i]); if (i === ib) break; }
  for (let i = ib; ; i = (i + 1) % loop.length) { arc2.push(loop[i]); if (i === ia) break; }
  const poly1 = arc1.concat(inner.slice().reverse());
  const poly2 = arc2.concat(inner);
  S0.roofSplit = { polys: [poly1, poly2], arcs: [arc1, arc2] };
  return true;
}

function commitRoofChoice(keepIndex) {
  const S0 = S();
  const rs = S0.roofSplit;
  if (!rs) return;
  const keepArc = rs.arcs[keepIndex];
  const otherArc = rs.arcs[1 - keepIndex];
  const kk = (p) => Math.round(p.x) + ',' + Math.round(p.y);
  const dashKeys = new Set();
  for (let i = 0; i + 1 < otherArc.length; i++) {
    dashKeys.add(kk(otherArc[i]) + '|' + kk(otherArc[i + 1]));
    dashKeys.add(kk(otherArc[i + 1]) + '|' + kk(otherArc[i]));
  }
  S0.segments.forEach(sg => {
    if (sg.stair || sg.balcony || sg.sizhiDim || sg.neighborWall) return;
    const k = kk(sg.a) + '|' + kk(sg.b);
    sg.roofOpen = dashKeys.has(k) || dashKeys.has(kk(sg.b) + '|' + kk(sg.a));
  });
  // 记录保留区域重心，作为天面层高标注位置
  const keepPoly = rs.polys[keepIndex];
  if (keepPoly && keepPoly.length) {
    let sx = 0, sy = 0;
    keepPoly.forEach(q => { sx += q.x; sy += q.y; });
    S0.roofHeightPos = { x: sx / keepPoly.length, y: sy / keepPoly.length };
  }
  S0.roofSplit = null;
  S0.mode = 'select';
  S0.selected = null;
  W.render(); W.refreshList();
  W.setStatus('已保留所选区域为实线，另一区域天面为虚线（露天）');
}

function handleTap(pt) {
  if (S().mode === 'roofpick') {
    const ip2 = W.s2i(pt);
    const rs = S().roofSplit;
    if (rs) {
      const inA = pointInPoly(ip2, rs.polys[0]);
      const inB = pointInPoly(ip2, rs.polys[1]);
      if (inA || inB) commitRoofChoice(inA ? 0 : 1);
      else W.setStatus('请点在两个天面区域内部');
    }
    return;
  }
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
    const gp = window.snapGridPt ? window.snapGridPt(ip) : ip;
    if (!S().anchor) {
      S().anchor = gp;
      W.setStatus('手绘：继续点，相邻点自动连线');
      W.render();
      return;
    }
    // 手绘强制横平竖直：取变化大的方向
    const a0 = S().anchor;
    const b0 = (Math.abs(gp.x - a0.x) >= Math.abs(gp.y - a0.y))
      ? { x: gp.x, y: a0.y }
      : { x: a0.x, y: gp.y };
    if (Math.hypot(b0.x - a0.x, b0.y - a0.y) < 4) { W.setStatus('点得太近，往横向或纵向再点一下'); return; }
    pushUndo();
    S().segments.push({ a: { ...a0 }, b: { ...b0 }, len: null, adj: (window.defAdj ? window.defAdj() : '') });
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
      S().freeFrom = window.snapGridPt ? window.snapGridPt(snap.p) : snap.p;
      W.setStatus('斜线：起点已吸附到' + snap.kind + '，再点终点');
      W.render();
      return;
    }
    const a = S().freeFrom, b = window.snapGridPt ? window.snapGridPt(snap.p) : snap.p;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) { W.setStatus('两点太近'); return; }
    pushUndo();
    splitAtPointInAll(a);
    splitAtPointInAll(b);
    S().segments.push({ a: { ...a }, b: { ...b }, len: null, adj: (window.defAdj ? window.defAdj() : '') });
    S().selected = { kind: 'seg', idx: S().segments.length - 1 };
    S().freeFrom = null;
    W.render(); W.refreshList();
    W.setStatus('已画斜线（两端吸附到' + snap.kind + '）');
    return;
  }

  if (S().mode === 'stairhouse') {
    const iss = ip;
    const nearestWall = () => {
      let best = null;
      S().segments.forEach(sg => {
        if (sg.stair) return;
        const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy || 1;
        let tt = ((iss.x - ax) * dx + (iss.y - ay) * dy) / L2;
        tt = Math.max(0, Math.min(1, tt));
        const q = { x: ax + dx * tt, y: ay + dy * tt };
        const a2 = W.i2s(q), b2 = W.i2s(iss);
        const d = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (d <= 55 && (!best || d < best.d)) best = { d, q, horiz: Math.abs(by - ay) < Math.abs(bx - ax), neighbor: !!sg.neighborWall, sg };
      });
      return best;
    };
    const hit = nearestWall();
    if (!S().stairStart) {
      if (!hit) { W.setStatus('梯屋：起点必须在墙线上（55px 内）'); return; }
      // 一层：点邻墙 → 直接画一段向外挑出的线段（长度=两侧短线 36）
      if (hit.neighbor && String(S().floorIdx) === '1') {
        let bx = 0, by = 0, np = 0;
        S().segments.forEach(sg => {
          if (sg.neighborWall || sg.sizhiDim || sg.stair) return;
          bx += sg.a.x + sg.b.x; by += sg.a.y + sg.b.y; np += 2;
        });
        bx /= Math.max(1, np); by /= Math.max(1, np);
        let nx = hit.q.x - bx, ny = hit.q.y - by;
        if (hit.horiz) { nx = 0; ny = ny >= 0 ? 1 : -1; }
        else { ny = 0; nx = nx >= 0 ? 1 : -1; }
        const L = 50;
        const a = { ...hit.q };
        const b = { x: a.x + nx * L, y: a.y + ny * L };
        pushUndo();
        S().segments.push({ a, b, len: null, adj: '', stair: true, neighborStair: true, noMeasure: true, stairId: 'nSt' + Date.now() });
        // 在梯屋两侧生成默认 "#? A?" 文本框
        const nside = hit.sg && hit.sg.neighborSide;
        if (nside && S().sizhi && S().sizhi[nside] && S().sizhi[nside].adj) {
          const adj2 = S().sizhi[nside].adj;
          const along = 230, out = 36;
          let p1, p2;
          if (nside === 'up') { p1 = { x: a.x - along, y: a.y - out }; p2 = { x: a.x + along, y: a.y - out }; }
          else if (nside === 'down') { p1 = { x: a.x - along, y: a.y + out }; p2 = { x: a.x + along, y: a.y + out }; }
          else if (nside === 'left') { p1 = { x: a.x - out, y: a.y - along }; p2 = { x: a.x - out, y: a.y + along }; }
          else { p1 = { x: a.x + out, y: a.y - along }; p2 = { x: a.x + out, y: a.y + along }; }
          adj2.labels = [
            { door: '?', struct: 'A', floors: '?', pos: p1 },
            { door: '?', struct: 'A', floors: '?', pos: p2 },
          ];
        }
        S().mode = 'select';
        W.render(); W.refreshList();
        W.setStatus('已添加邻墙梯屋线段（外挑 36）');
        return;
      }
      const gq = window.snapGridPt ? window.snapGridPt(hit.q) : { ...hit.q };
      if (hit.horiz) gq.y = hit.q.y; else gq.x = hit.q.x;
      gq.x = Math.round(gq.x / 50) * 50;
      gq.y = Math.round(gq.y / 50) * 50;
      pushUndo();
      splitAtPointInAll(gq, false);
      S().stairStart = { ...gq };
      S().stairPrev = { ...gq };
      S().roofHeightPos = null;
      S().stairGid = 'st' + Date.now();
      W.render();
      W.setStatus('梯屋：继续点内部转折点，会正交跟随；最后点墙上结束');
      return;
    }
    const prev = S().stairPrev;
    if (hit) {
      // 结束：正交落到点击处的墙上（必要时加一个肘点）
      const wallQ = { ...hit.q };
      const a = prev;
      const b = { ...wallQ };
      if (window.snapGridPt) {
        if (hit.horiz) b.x = window.snapGridPt(b).x; else b.y = window.snapGridPt(b).y;
      }
      if (Math.abs(b.x - a.x) < 4 && Math.abs(b.y - a.y) < 4) { W.setStatus('终点与上一点重合'); return; }
      pushUndo();
      splitAtPointInAll({ ...b }, false);
      const stAdj = window.defAdj ? window.defAdj() : '';
      if (Math.abs(b.x - a.x) > 4 || Math.abs(b.y - a.y) > 4) {
        if (hit.horiz) {
          const elbow = { x: b.x, y: a.y };
          stairAdd(a, elbow, false); stairAdd(elbow, b, true);
        } else if (Math.abs(b.y - a.y) > 4) {
          const elbow = { x: b.x, y: a.y };
          stairAdd(a, elbow, false); stairAdd(elbow, b, true);
        } else {
          stairAdd(a, b, true);
        }
      }
      const st2 = S().stairStart ? { ...S().stairStart } : null;
      tidyStair(S().stairGid);
      const isRoof = String(S().floorIdx) === 'roof';
      if (isRoof) {
        S().stairStart = null; S().stairPrev = null; S().stairGid = null;
        const ok = splitRoofRegions(st2, { ...b });
        if (ok) {
          S().mode = 'roofpick';
          W.render(); W.refreshList();
          W.setStatus('点一下要保留为实线的区域（另一区域为虚线露天天面）');
        } else {
          S().segments.forEach(sg => {
            if (sg.stair || sg.balcony || sg.sizhiDim || sg.neighborWall) return;
            sg.roofOpen = true;
          });
          S().mode = 'select';
          W.render(); W.refreshList();
          W.setStatus('天面轮廓切开失败，已按全部虚线处理');
        }
        return;
      }
      tidyStair(S().stairGid);
      S().stairStart = null; S().stairPrev = null; S().stairGid = null;
      S().mode = 'select';
      W.render(); W.refreshList();
      W.setStatus('梯屋已完成');
      return;
    }
    // 跟随拐弯：从上一点正交延伸（吸附最近格点）
    let cand = (Math.abs(iss.x - prev.x) >= Math.abs(iss.y - prev.y))
      ? { x: iss.x, y: prev.y }
      : { x: prev.x, y: iss.y };
    if (window.snapGridPt) {
      cand = (Math.abs(iss.x - prev.x) >= Math.abs(iss.y - prev.y))
        ? { x: Math.round(cand.x / 50) * 50, y: prev.y }
        : { x: prev.x, y: Math.round(cand.y / 50) * 50 };
    }
    if (Math.abs(cand.x - prev.x) < 4 && Math.abs(cand.y - prev.y) < 4) return;
    pushUndo();
    stairAdd(prev, cand, false);
    S().stairPrev = { ...cand };
    W.render(); W.refreshList();
    W.setStatus('梯屋：继续点，最后点墙上结束');
    return;
  }

  if (S().mode === 'balcony') {
    const ipb = ip;
    if (!S().balconyFirst) {
      // 先尝试吸附墙角（60 屏幕像素内）
      let corner = null;
      S().segments.forEach(sg => {
        if (sg.balcony || sg.neighborWall) return;
        [sg.a, sg.b].forEach(p2 => {
          const a2 = W.i2s(p2), b2 = W.i2s(ipb);
          const dd = Math.hypot(a2.x - b2.x, a2.y - b2.y);
          if (dd <= 60 && (!corner || dd < corner.d)) corner = { d: dd, p: { x: p2.x, y: p2.y } };
        });
      });
      // 找最近的墙，并投影到墙上
      let best = null;
      S().segments.forEach(sg => {
        if (sg.balcony || sg.neighborWall) return;
        const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy || 1;
        let tt = ((ipb.x - ax) * dx + (ipb.y - ay) * dy) / L2;
        tt = Math.max(0, Math.min(1, tt));
        const q = { x: ax + dx * tt, y: ay + dy * tt };
        const d = Math.hypot(ipb.x - q.x, ipb.y - q.y);
        if (!best || d < best.d) best = { d, q, ax, ay, bx, by, L: Math.sqrt(L2) };
      });
      if (!best) { W.setStatus('先建好轮廓'); return; }
      let cx = 0, cy = 0, np = 0;
      S().segments.forEach(sg => { if (!sg.balcony) { cx += sg.a.x + sg.b.x; cy += sg.a.y + sg.b.y; np += 2; } });
      cx /= Math.max(1, np); cy /= Math.max(1, np);
      const ux = (best.bx - best.ax) / best.L, uy = (best.by - best.ay) / best.L;
      let nx = -uy, ny = ux;
      if ((best.q.x - cx) * nx + (best.q.y - cy) * ny > 0) { nx = -nx; ny = -ny; } // 指向内部
      let startA;
      if (corner) startA = { ...corner.p };
      else {
        startA = { ...best.q };
        if (!window.snapGridPt) { /* noop */ }
        else if (Math.abs(best.bx - best.ax) >= Math.abs(best.by - best.ay)) {
          startA = { x: window.snapGridPt(startA).x, y: startA.y };
        } else {
          startA = { x: startA.x, y: window.snapGridPt(startA).y };
        }
      }
      S().balconyFirst = { A: startA, u: { x: ux, y: uy }, n: { x: nx, y: ny } };
      S().mode = 'balcony';
      W.render();
      W.setStatus('阳台：再点图形内部一点作为对角');
      return;
    }
    const bf = S().balconyFirst;
    S().balconyFirst = null;
    const gp = window.snapGridPt ? window.snapGridPt(ipb) : ipb;
    const du = (gp.x - bf.A.x) * bf.u.x + (gp.y - bf.A.y) * bf.u.y;
    let dn = (gp.x - bf.A.x) * bf.n.x + (gp.y - bf.A.y) * bf.n.y;
    if (dn < 0) { dn = -dn; bf.n = { x: -bf.n.x, y: -bf.n.y }; }
    if (Math.abs(du) < 20 || dn < 20) { S().mode = 'select'; W.setStatus('阳台太小，已取消'); return; }
    const P0 = { ...bf.A };
    const P1 = { x: P0.x + bf.u.x * du, y: P0.y + bf.u.y * du };
    const P3 = { x: P0.x + bf.n.x * dn, y: P0.y + bf.n.y * dn };
    const P2 = { x: P3.x + bf.u.x * du, y: P3.y + bf.u.y * du };
    pushUndo();
    // 阳台可能同时贴两面外墙：四个角所在的墙都要分割（并保留总长记录）
    splitAtPointInAll(P0, true, '++');
    splitAtPointInAll(P1, true, '++');
    splitAtPointInAll(P3, true, '++');
    splitAtPointInAll(P2, true, '++');
    const gid = 'balc' + Date.now();
    // 边若正好压在墙上（转角阳台贴两面墙），不重复画阳台边
    const onWall = (p1, p2) => {
      return S().segments.some(sg => {
        if (sg.balcony || sg.stair || sg.sizhiDim || sg.neighborWall) return false;
        const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy || 1;
        const dist = (p) => {
          let tt = ((p.x - ax) * dx + (p.y - ay) * dy) / L2;
          tt = Math.max(0, Math.min(1, tt));
          const q = { x: ax + dx * tt, y: ay + dy * tt };
          return Math.hypot(p.x - q.x, p.y - q.y);
        };
        return dist(p1) < 2 && dist(p2) < 2;
      });
    };
    const edges = [[P0, P3], [P3, P2], [P2, P1]];
    let added = 0;
    edges.forEach(([a1, b1], k) => {
      if (onWall(a1, b1)) return;
      added++;
      S().segments.push({ a: { ...a1 }, b: { ...b1 }, len: null, adj: (window.defAdj ? window.defAdj() : ''), balcony: true, balconyId: gid, balconyLabel: k === 2 });
    });
    if (!added) S().segments.push({ a: { ...P3 }, b: { ...P2 }, len: null, adj: (window.defAdj ? window.defAdj() : ''), balcony: true, balconyId: gid, balconyLabel: true });
    S().mode = 'select';
    W.render(); W.refreshList();
    W.setStatus('阳台已生成（墙面已分割），可点选阳台边输入长度');
    return;
  }

  if (S().mode === 'door') {
    const num = S().doorPending || '';
    if (!num) { W.setStatus('门牌：先点「门牌」输入号码'); return; }
    // 吸附到最近的外墙线
    let best = null;
    S().segments.forEach(sg => {
      if (sg.balcony || sg.stair || sg.sizhiDim || sg.neighborWall || sg.noMeasure) return;
      const ax = sg.a.x, ay = sg.a.y, bx = sg.b.x, by = sg.b.y;
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy || 1;
      let tt = ((ip.x - ax) * dx + (ip.y - ay) * dy) / L2;
      tt = Math.max(0, Math.min(1, tt));
      const q = { x: ax + dx * tt, y: ay + dy * tt };
      const d = Math.hypot(ip.x - q.x, ip.y - q.y);
      if (!best || d < best.d) best = { d, q, horiz: Math.abs(dy) < Math.abs(dx) };
    });
    if (!best) { W.setStatus('门牌：先画外墙'); return; }
    let pos;
    if (best.horiz) pos = { x: (window.snapGridPt ? window.snapGridPt(best.q).x : best.q.x), y: best.q.y };
    else pos = { x: best.q.x, y: (window.snapGridPt ? window.snapGridPt(best.q).y : best.q.y) };
    let cx = 0, cy = 0, np = 0;
    S().segments.forEach(sg => {
      if (sg.balcony || sg.stair || sg.sizhiDim || sg.neighborWall) return;
      cx += sg.a.x + sg.b.x; cy += sg.a.y + sg.b.y; np += 2;
    });
    cx /= Math.max(1, np); cy /= Math.max(1, np);
    pushUndo();
    S().doors = [{
      pos, num: String(num), horiz: best.horiz,
      in: best.horiz ? (cy - pos.y >= 0 ? 1 : -1) : (cx - pos.x >= 0 ? 1 : -1),
    }];
    S().doorPending = null;
    S().mode = 'select';
    W.render(); W.refreshList();
    W.setStatus('已放置门牌 #' + num + '（唯一，重新放置会替换）');
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
    S().notes.push({ pos: mid, a: first, b: ip, len: v, adj: (window.defAdj ? window.defAdj() : '') });
    S().selected = { kind: 'note', idx: S().notes.length - 1 };
    W.setStatus('已放数字，可点选后按徕卡测量');
    W.render(); W.refreshList();
    return;
  }

  if (S().mode === 'addline') {
    if (!S().addFrom) {
      { const sn = snapToGeometry(ip); const base = sn ? sn.p : ip; S().addFrom = window.snapGridPt ? window.snapGridPt(base) : base; }
      W.setStatus('加线：起点已定，再点终点（自动吸附、横平竖直）');
      W.render();
      return;
    }
    const a = S().addFrom;
    const snB = snapToGeometry(ip); const rawB = snB ? snB.p : ip; const b = window.snapGridPt ? window.snapGridPt(rawB) : rawB;
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
    S().segments.push({ a: { ...seg.a }, b: { ...seg.b }, len: null, adj: (window.defAdj ? window.defAdj() : '') });
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
    let ipS = window.snapGridPt ? window.snapGridPt(ip) : ip;
    // 保证落在该线段所在直线上（横墙记 y、竖墙记 x）
    if (Math.abs(sg.b.x - sg.a.x) >= Math.abs(sg.b.y - sg.a.y)) ipS = { x: ipS.x, y: sg.a.y };
    else ipS = { x: sg.a.x, y: ipS.y };
    const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y;
    const L2 = dx * dx + dy * dy || 1;
    let tt = ((ipS.x - sg.a.x) * dx + (ipS.y - sg.a.y) * dy) / L2;
    tt = Math.max(0, Math.min(1, tt));
    splitSegment(idx, tt);
    return;
  }

  // 点选图面文本（门牌/四至/邻建筑结构）→ 编辑
  const txt = textAnchorAt(ip);
  if (txt) {
    if (txt.kind === 'door') {
      S().selected = { kind: 'door', idx: txt.idx };
      W.render(); W.refreshList(); renderInfoBar();
      W.setStatus('已选门牌，可拍照或用「改号」修改号码');
      return;
    }
    if (txt.kind === 'sizhi') {
      const v = prompt('四至内容', S().sizhi[txt.side].text || '');
      if (v != null) { S().sizhi[txt.side].text = v.trim(); W.render(); W.refreshList(); W.setStatus('四至已修改'); }
      return;
    }
  }

  // 点选层高标注
  if (window.floorHeightAnchor) {
    const hp = window.floorHeightAnchor();
    if (hp) {
      const q = W.i2s(hp), b = W.i2s(ip);
      if (Math.hypot(q.x - b.x, q.y - b.y) <= 50) {
        S().selected = { kind: 'height' };
        W.setStatus('已选层高，可直接输入或用徕卡测量');
        W.render(); W.refreshList(); renderInfoBar(); return;
      }
    }
  }

  // 点选（总长优先，因为它偏移在墙外）
  const tot = hitTotal(pt);
  if (tot) {
    S().selected = { kind: 'total', idx: tot.idx };
    W.setStatus('已选总长 ' + (tot.idx + 1) + '，按徕卡测量或手动输入');
    W.render(); W.refreshList(); return;
  }
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
    return;
  }
  if (S().pointers.size === 1 && S().balconyDragging == null && S().mode !== 'select') {
    const ip0 = W.s2i(pt);
    const g = balconyGroupHit(ip0);
    if (g) {
      S().balconyDragging = { last: ip0, segs: g.segs };
      return;
    }
  }
  const drawEditing = S().app === 'sketch' || (S().app === 'zh' && S().zhDrawing);
  if (drawEditing && S().pointers.size === 1 && window.DRAW && S().mode === 'select' &&
      DRAW.beginVertexDrag(W.s2i(pt), S().mode)) {
    return;
  }
  if (S().mode === 'multiselect' && S().pointers.size === 1) {
    S().multiBox = { a: W.s2i(pt), b: W.s2i(pt) };
    return;
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
  if (S().balconyDragging) {
    const ip1 = W.s2i(now);
    translateGroup(S().balconyDragging.segs, ip1.x - S().balconyDragging.last.x, ip1.y - S().balconyDragging.last.y);
    S().balconyDragging.last = ip1;
    S().moved = true;
    W.render();
    return;
  }
  if (window.DRAW && DRAW.dragging) {
    DRAW.moveVertexDrag(W.s2i(now));
    S().moved = true;
    return;
  }
  if (S().mode === 'multiselect' && S().multiBox) {
    S().multiBox.b = W.s2i(now);
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
  if (S().mode === 'multiselect' && S().multiBox) {
    const a = S().multiBox.a, b = S().multiBox.b;
    S().multiBox = null;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const inside = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    S().multi = [];
    S().segments.forEach((sg, i) => { if (inside(sg.a) && inside(sg.b)) S().multi.push(i); });
    W.render(); W.refreshList();
    W.setStatus('已框选 ' + S().multi.length + ' 条线段（可镜像/复制/删除）');
    return;
  }
  if (S().balconyDragging) {
    const grp = S().balconyDragging.segs || [];
    S().balconyDragging = null;
    if (grp.some(sg => sg.draft)) commitBalcony();
    else W.setStatus('阳台已移动（重新吸附请拖到墙边松手）');
    return;
  }
  if (window.DRAW && DRAW.dragging) {
    const moved = DRAW.endVertexDrag();
    if (moved) return;
  }
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
    a: { ...ends[best.i] }, b: { ...ends[best.j] }, len: null, adj: (window.defAdj ? window.defAdj() : ''),
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
  const sel = S().selected;
  if (sel.kind === 'door') { S().photoTarget = { kind: 'door' }; $('photoInput').click(); return; }
  if (sel.kind === 'thick') { S().photoTarget = { kind: 'thick' }; $('photoInput').click(); return; }
  if (sel.kind === 'height') { S().photoTarget = { kind: 'structure', key: window.floorHeightKey() }; $('photoInput').click(); return; }
  const it = W.itemOf(sel);
  if (it && it.stair) { S().photoTarget = { kind: 'stair' }; $('photoInput').click(); return; }
  if (sel.kind === 'seg' && String(S().floorIdx) === '1') {
    const dir = wallDirName(it);
    S().photoTarget = { kind: 'wall', dir };
    $('photoInput').click(); return;
  }
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
  const tgt = S().photoTarget;
  S().photoTarget = null;
  shrinkImage(f, (url) => {
    const S0 = S();
    S0.photoBind = S0.photoBind || { door: null, walls: [], structure: {}, stair: null, thick: null };
    if (tgt && tgt.kind === 'door') {
      S0.photoBind.door = { url, name: '门牌' };
      W.setStatus('已保存门牌照片');
    } else if (tgt && tgt.kind === 'wall') {
      S0.photoBind.walls = S0.photoBind.walls || [];
      S0.photoBind.walls.push({ url, dir: tgt.dir, name: '一层' + tgt.dir + '墙' });
      W.setStatus('已保存一层' + tgt.dir + '墙照片');
    } else if (tgt && tgt.kind === 'structure') {
      S0.photoBind.structure = S0.photoBind.structure || {};
      S0.photoBind.structure[tgt.key] = { url, name: '内部结构' };
      W.setStatus('已保存内部结构照片');
    } else if (tgt && tgt.kind === 'stair') {
      S0.photoBind.stair = { url, name: '梯屋' };
      W.setStatus('已保存梯屋照片');
    } else if (tgt && tgt.kind === 'thick') {
      S0.photoBind.thick = { url, name: '墙厚' };
      W.setStatus('已保存墙厚照片');
    } else {
      const it = W.itemOf(S0.selected);
      if (!it) return;
      it.photo = url;
      it.photoName = f.name;
      W.refreshList();
      W.setStatus('已关联照片：' + f.name);
    }
    W.render(); W.refreshList(); renderInfoBar();
  });
};
$('btnViewPhoto').onclick = () => {
  const it = W.itemOf(S().selected);
  if (!it || !it.photo) { W.setStatus('该条没有照片'); return; }
  const w = window.open('');
  w.document.write('<title>照片</title><img style="max-width:100%" src="' + it.photo + '">');
};

function setPaintMode(mode) {
  S().mode = mode;
  S().pending = null;
  S().anchor = (mode === 'draw') ? S().anchor : null;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const txt = {
    draw: '手绘：连续点，相邻点自动连线',
    select: '点选：点线/端点选中，拖动端点可改形状',
    addline: '加线：点起点（自动吸附）、点终点，自动横平竖直并断开 T 形接头',
    split: '分割：先点选一条线，再点分割位置',
    note: '点注：点两个点，数字放中间',
    crop: '框选范围：点第一个角，再点对角',
    free: '斜线：点起点（靠近端点/线），再点终点',
    multiselect: '多选：在空白处拖框，选中框内整条线段（可镜像/复制/删除）',
  }[mode];
  if (txt) W.setStatus(txt);
  W.render();
}
document.querySelectorAll('[data-mode]').forEach(btn => {
  btn.onclick = () => setPaintMode(btn.dataset.mode);
});

$('btnMulti').onclick = () => setPaintMode('multiselect');
$('btnMirror').onclick = () => {
  const idx = (S().multi && S().multi.length) ? S().multi : (S().selected && S().selected.kind === 'seg' ? [S().selected.idx] : []);
  if (!idx.length) { W.setStatus('先框选或多选线段'); return; }
  pushUndo();
  const xs = [];
  idx.forEach(i => { const sg = S().segments[i]; xs.push(sg.a.x, sg.b.x); });
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  idx.forEach(i => {
    const sg = S().segments[i];
    sg.a = { x: 2 * cx - sg.a.x, y: sg.a.y };
    sg.b = { x: 2 * cx - sg.b.x, y: sg.b.y };
  });
  W.render(); W.refreshList();
  W.setStatus('已镜像 ' + idx.length + ' 条线段');
};
$('btnCopy').onclick = () => {
  const idx = (S().multi && S().multi.length) ? S().multi : (S().selected && S().selected.kind === 'seg' ? [S().selected.idx] : []);
  if (!idx.length) { W.setStatus('先框选或多选线段'); return; }
  pushUndo();
  const add = [];
  idx.forEach(i => {
    const sg = S().segments[i];
    add.push({
      a: { x: sg.a.x + 40, y: sg.a.y + 40 },
      b: { x: sg.b.x + 40, y: sg.b.y + 40 },
      len: sg.len, adj: sg.adj,
    });
  });
  S().segments.push(...add);
  S().multi = [];
  W.render(); W.refreshList();
  W.setStatus('已复制 ' + add.length + ' 条线段');
};
$('btnDelete').onclick = () => {
  if (S().multi && S().multi.length) {
    pushUndo();
    const n = S().multi.length;
    S().multi.slice().sort((x, y) => y - x).forEach(i => S().segments.splice(i, 1));
    S().multi = []; S().selected = null;
    W.render(); W.refreshList(); W.setStatus('已删除 ' + n + ' 条线段');
    return;
  }
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

const PHOTO_SHEET_ITEMS = ['门牌', '一层东墙', '一层南墙', '一层西墙', '一层北墙', '墙厚', '内部结构', '梯屋', '（预留）'];
function photoSheetItems() {
  const pb = S().photoBind || {};
  const out = [];
  if (pb.door && pb.door.url) out.push({ name: '门牌', url: pb.door.url });
  const walls = (pb.walls || []).filter(w => w && w.url);
  const seen = {};
  walls.forEach(w => {
    if (seen[w.dir]) return;
    seen[w.dir] = true;
    out.push({ name: '一层' + w.dir + '墙', url: w.url });
  });
  const st = pb.structure || {};
  let stKey = null;
  if (st[2] && st[2].url) stKey = 2;
  else {
    const ks = Object.keys(st);
    for (const k of ks) { if (st[k] && st[k].url) { stKey = k; break; } }
  }
  if (stKey && st[stKey].url) out.push({ name: '内部结构', url: st[stKey].url });
  if (pb.stair && pb.stair.url) out.push({ name: '梯屋', url: pb.stair.url });
  if (pb.thick && pb.thick.url) out.push({ name: '墙厚', url: pb.thick.url });
  return out;
}

function buildPhotoSheetGrid() {
  const g = document.getElementById('psGrid');
  if (!g) return;
  g.innerHTML = '';
  const items = photoSheetItems();
  if (!items.length) {
    const d = document.createElement('div');
    d.style.cssText = 'grid-column: 1 / -1; color:#90a4ae; font-size:14px; padding:12px; text-align:center;';
    d.textContent = '还没有拍摄照片：点门牌 / 一层墙 / 层高 / 梯屋 / 墙厚后拍照，会出现在这里';
    g.appendChild(d);
    return;
  }
  items.forEach(it => {
    const wrap = document.createElement('div');
    wrap.className = 'ps-item';
    const cell = document.createElement('div');
    cell.className = 'ps-cell';
    if (it && it.url) {
      cell.textContent = '';
      const img = document.createElement('img');
      img.src = it.url;
      img.style.cssText = 'max-width:100%; max-height:100%; border-radius:4px;';
      cell.appendChild(img);
    } else {
      cell.textContent = '（待拍）';
    }
    const cap = document.createElement('div');
    cap.className = 'ps-cap';
    cap.textContent = it && it.name ? it.name : name;
    wrap.appendChild(cell);
    wrap.appendChild(cap);
    g.appendChild(wrap);
  });
}
$('btnPhotoSheet').onclick = () => {
  const noEl = document.getElementById('psNo');
  if (noEl) noEl.value = S().projectNo || '';
  buildPhotoSheetGrid();
  document.getElementById('photoSheetModal').classList.add('open');
};
$('psExportXlsx').onclick = () => {
  const noEl = document.getElementById('psNo');
  S().projectNo = noEl ? noEl.value.trim() : '';
  window.EXP.exportPhotoSheetExcel(S().projectNo, photoSheetItems());
};
$('psClose').onclick = () => document.getElementById('photoSheetModal').classList.remove('open');
$('psExport').onclick = () => {
  const noEl = document.getElementById('psNo');
  S().projectNo = noEl ? noEl.value.trim() : '';
  window.EXP.exportPhotoSheet(S().projectNo, photoSheetItems());
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
function photoButtonLabel() {
  const S0 = S();
  const sel = S0.selected;
  const pb = S0.photoBind || {};
  if (!sel) return '拍照';
  if (sel.kind === 'door') return pb.door ? '覆盖' : '拍照';
  if (sel.kind === 'thick') return pb.thick ? '覆盖' : '拍照';
  if (sel.kind === 'height') {
    const k = window.floorHeightKey();
    return (pb.structure && pb.structure[k]) ? '覆盖' : '拍照';
  }
  const it = W.itemOf(sel);
  if (it && it.stair) return pb.stair ? '覆盖' : '拍照';
  if (sel.kind === 'seg' && String(S0.floorIdx) === '1' && it) {
    const dir = wallDirName(it);
    return (pb.walls || []).some(w => w.dir === dir) ? '覆盖' : '拍照';
  }
  if (it && it.photo) return '覆盖';
  return '拍照';
}

function renderInfoBar() {
  const bar = document.getElementById('infoBar');
  if (!bar) return;
  const selD = S().selected;
  if (selD && selD.kind === 'door') {
    const d = (S().doors || [])[selD.idx];
    document.getElementById('infoTitle').textContent = '门牌 #' + (d ? d.num : '');
    document.getElementById('infoLen').textContent = '一层门牌';
    document.getElementById('infoAdj').textContent = '';
    const liD = document.getElementById('infoLenInput');
    if (liD) { liD.disabled = true; liD.value = ''; liD.placeholder = '门牌号'; }
    const thD = document.getElementById('infoThick');
    if (thD) { thD.disabled = true; thD.value = ''; thD.placeholder = '默认'; }
    const dirD = document.getElementById('infoDir');
    if (dirD) dirD.textContent = '';
    const totD = document.getElementById('infoTotal');
    if (totD) totD.textContent = '';
    const pbD = document.getElementById('btnInfoPhoto');
    if (pbD) pbD.textContent = photoButtonLabel();
    return;
  }
  if (selD && selD.kind === 'thick') {
    const thv = document.getElementById('thick');
    document.getElementById('infoTitle').textContent = '墙厚';
    document.getElementById('infoLen').textContent = (thv ? thv.value : '') + ' cm（默认墙厚）';
    document.getElementById('infoAdj').textContent = '';
    const liT = document.getElementById('infoLenInput');
    if (liT) { liT.disabled = true; liT.value = ''; liT.placeholder = '墙厚'; }
    const thT = document.getElementById('infoThick');
    if (thT) { thT.disabled = true; thT.value = ''; thT.placeholder = '默认'; }
    const dirT = document.getElementById('infoDir');
    if (dirT) dirT.textContent = '';
    const totT = document.getElementById('infoTotal');
    if (totT) totT.textContent = '';
    const pbT = document.getElementById('btnInfoPhoto');
    if (pbT) pbT.textContent = photoButtonLabel();
    return;
  }
  const selH = S().selected;
  if (selH && selH.kind === 'height') {
    const key = window.floorHeightKey();
    const label = key === 'roof' ? '天面梯屋' : (key === 2 ? '二层及以上' : key + ' 层');
    const v = (S().heights || {})[key];
    document.getElementById('infoTitle').textContent = '层高（' + label + '）';
    document.getElementById('infoLen').textContent = '数值：' + (v == null ? '未测' : v.toFixed(4) + ' m');
    document.getElementById('infoAdj').textContent = '';
    const liH = document.getElementById('infoLenInput');
    if (liH) { liH.disabled = false; liH.placeholder = '米'; if (document.activeElement !== liH) liH.value = v == null ? '' : String(v); }
    const thH = document.getElementById('infoThick');
    if (thH) { thH.disabled = true; thH.value = ''; thH.placeholder = '默认'; }
    const dirH = document.getElementById('infoDir');
    if (dirH) dirH.textContent = '';
    const totH = document.getElementById('infoTotal');
    if (totH) totH.textContent = '';
    const pbH = document.getElementById('btnInfoPhoto');
    if (pbH) pbH.textContent = photoButtonLabel();
    return;
  }

  const it = W.itemOf(S().selected);
  if (!it) {
    document.getElementById('infoTitle').textContent = '未选中';
    document.getElementById('infoLen').textContent = '';
    const li0 = document.getElementById('infoLenInput');
    if (li0) { li0.value = ''; li0.disabled = true; li0.placeholder = '手动'; }
    document.getElementById('infoAdj').textContent = '';
    const tot0 = document.getElementById('infoTotal');
    if (tot0) tot0.textContent = '';
    const th0 = document.getElementById('infoThick');
    if (th0) { th0.value = ''; th0.disabled = true; th0.placeholder = '默认'; }
    const d0 = document.getElementById('infoDir');
    if (d0) d0.textContent = '';
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
  const lenInp = document.getElementById('infoLenInput');
  if (lenInp) {
    const segSel = S().selected && S().selected.kind === 'seg';
    lenInp.disabled = !segSel;
    if (document.activeElement !== lenInp) {
      lenInp.value = (segSel && it.len != null) ? it.len.toFixed(4) : '';
    }
  }
  document.getElementById('infoAdj').textContent = adjTxt;
  const thEl = document.getElementById('infoThick');
  if (thEl) {
    const isSeg2 = S().selected && S().selected.kind === 'seg';
    thEl.disabled = !isSeg2;
    thEl.value = (isSeg2 && it.thickCm != null) ? String(it.thickCm) : '';
    thEl.placeholder = '默认';
  }
  const dirEl = document.getElementById('infoDir');
  if (dirEl) {
    dirEl.textContent = (it.dir != null)
      ? ('方向：' + it.dir.toFixed(1) + '°' + (it.dirAcc != null ? ' ±' + it.dirAcc.toFixed(0) + '°' : '') + (it.dirSrc ? '（' + it.dirSrc + '）' : ''))
      : '';
  }
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
  const pbBtn = document.getElementById('btnInfoPhoto');
  if (pbBtn) pbBtn.textContent = photoButtonLabel();
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
$('infoThick').onchange = () => {
  const sel = S().selected;
  if (!sel || sel.kind !== 'seg') return;
  const sg = S().segments[sel.idx];
  if (!sg) return;
  const v = parseFloat($('infoThick').value);
  pushUndo();
  if (isNaN(v) || v <= 0) { sg.thickCm = null; W.setStatus('该墙恢复默认墙厚'); }
  else { sg.thickCm = v; W.setStatus('该墙墙厚已设为 ' + v + ' cm'); }
  W.render(); W.refreshList();
};
const _thickEl = document.getElementById('thick');
if (_thickEl) _thickEl.addEventListener('click', () => {
  S().selected = { kind: 'thick' };
  W.render(); W.refreshList(); renderInfoBar();
  W.setStatus('已选默认墙厚，可拍照');
});
window.thickOpenBound = true;
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
$('btnGeo').onclick = () => {
  if (!window.GEO) { W.setStatus('没有定位模块'); return; }
  const cur = window.GEO.current();
  if (cur) W.setStatus('定位中：±' + Math.round(cur.acc) + ' m（样本 ' + (cur.n || 1) + '）');
  window.GEO.start((s) => W.setStatus(s));
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then((p) => {
      if (p.state === 'denied') W.setStatus('定位被禁用：请到浏览器设置允许本站位置');
      else if (p.state === 'granted') W.setStatus('定位已允许，等待卫星…');
    }).catch(() => {});
  }
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
    s.segments = []; s.notes = []; s.totals = []; s.doors = []; s.balconies = []; s.sizhi = null; s.selected = null;
    s.interior = null; s.interiorStart = null; s.crop = null;
    s.pending = null; s.anchor = null; s.addFrom = null;
    W.render(); W.refreshList(); W.setStatus('已清空');
  }

  if (window.DRAW) {
    window.DRAW.init({
      getState: S,
      render: () => W.render(),
      refreshList: () => W.refreshList(),
      setStatus: (s) => W.setStatus(s),
      pushUndo,
      i2s: (p) => W.i2s(p),
      s2i: (p) => W.s2i(p),
      setPaintMode,
      paintTap: (ip) => handleTap(ip),
    });
  }

  // 手动输入长度（与蓝牙回传共用）
  (function bindInfoLen() {
    const inp = document.getElementById('infoLenInput');
    if (!inp) return;
    const commit = () => {
      const sel = S().selected;
      if (sel && sel.kind === 'height') {
        const key = window.floorHeightKey();
        S().heights = S().heights || {};
        const raw0 = (inp.value || '').trim();
        if (raw0 === '') delete S().heights[key];
        else {
          const v0 = parseFloat(raw0);
          if (isFinite(v0) && v0 > 0) S().heights[key] = v0;
        }
        W.render(); W.refreshList();
        return;
      }
      if (!sel || (sel.kind !== 'seg' && sel.kind !== 'total')) return;
      const it = sel.kind === 'total' ? S().totals[sel.idx] : S().segments[sel.idx];
      if (!it) return;
      const raw = (inp.value || '').trim();
      if (raw === '') {
        it.len = null;
      } else {
        const v = parseFloat(raw);
        if (!isFinite(v) || v <= 0) return;
        it.len = v;
      }
      W.render(); W.refreshList();
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); inp.blur(); } });
  })();

  const _rkS = document.getElementById('roofKeepSmall');
  if (_rkS) _rkS.onclick = () => {
    const rp = S().roofPending;
    if (rp) applyRoofChoice(rp.stairId, rp.start, rp.end, true);
    S().roofPending = null;
    document.getElementById('roofPickModal').classList.remove('open');
    W.render(); W.refreshList();
  };
  const _rkL = document.getElementById('roofKeepLarge');
  if (_rkL) _rkL.onclick = () => {
    const rp = S().roofPending;
    if (rp) applyRoofChoice(rp.stairId, rp.start, rp.end, false);
    S().roofPending = null;
    document.getElementById('roofPickModal').classList.remove('open');
    W.render(); W.refreshList();
  };

  window.__ROOFDBG = { buildOutlineLoop, chainOrdered, splitRoofRegions, pointInPoly };

  window.INT = {
    init(h) { W = h; },
    autoTrace,
    handleTap,
    renderInfoBar,
    makeBalconyDraft,
    commitBalcony,
    pushUndo,
    undo,
    clearAll,
    saveState: null,
  };
})();
