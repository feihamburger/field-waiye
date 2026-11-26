/* 状态与绘制核心：S、视图变换、画布渲染 */
(function () {
  'use strict';
const GRID_STEP = 50;
function snapGridPt(p) {
  return { x: Math.round(p.x / GRID_STEP) * GRID_STEP, y: Math.round(p.y / GRID_STEP) * GRID_STEP };
}
window.GRID_STEP = GRID_STEP;
window.snapGridPt = snapGridPt;

const S = {
  heights: {},
  photoBind: { door: null, walls: [], structure: {}, stair: null, thick: null },
  photoTarget: null,
  img: null,            // 已画到离屏 canvas 的图纸
  segments: [],         // {a:{x,y}, b:{x,y}, len, adj}
  notes: [],
    totals: [],
    multi: [],
    doors: [],
    sizhi: null,
    segSeq: 1,
    columns: [],            // {pos:{x,y}, a,b, len, adj}
  selected: null,       // {kind:'seg'|'note', idx}
  mode: 'select',
  view: { scale: 1, tx: 0, ty: 0, rot: 0 },
  undo: [],
  pending: null,        // 手绘/点注第一个点
  pointers: new Map(),
  pinch: null,
  moved: false,
  crop: null,          // {x0,y0,x1,y1} 图像坐标
  anchor: null,        // 手绘连续点锚点
  blePackets: [],
  bleDevice: null,
  bleChar: null,
  interior: null,
  interiorStart: null,
  accum: 0,
  lastMeas: null,
  accSel: null,
  accValue: 0,
  accSign: 1,
  app: 'plan',
  lengths: [],
  uoCands: [],
  uoCandIdx: -1,
  autoAcc: false,      // 内部识别轮廓（图像坐标点数组）
  addFrom: null,
  cropDragStart: null,
  cropDragCur: null,
  downPt: null,
};

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const bleEl = $('bleState');

function setStatus(t) { statusEl.textContent = t; }
function setBle(t, on) {
  bleEl.textContent = t;
  bleEl.classList.toggle('on', !!on);
  const btn = document.getElementById('btnBleToggle');
  if (btn) btn.textContent = on ? '断开' : '连接徕卡';
}

// ---------- 视图 ----------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function fitView() {
  if (!S.img) return;
  const r = cv.getBoundingClientRect();
  const s = Math.min(r.width / S.img.width, r.height / S.img.height) * 0.95;
  S.view.scale = s;
  S.view.tx = r.width / 2;
  S.view.ty = r.height / 2;
  S.view.rot = 0;
  render();
}

function rotPoint(x, y) {
  const rad = S.view.rot * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}

function i2s(p) {
  if (!S.img) return { x: p.x, y: p.y };
  const vx = (p.x - S.img.width / 2) * S.view.scale;
  const vy = (p.y - S.img.height / 2) * S.view.scale;
  const q = rotPoint(vx, vy);
  return { x: q.x + S.view.tx, y: q.y + S.view.ty };
}

function s2i(p) {
  if (!S.img) return { x: p.x, y: p.y };
  const dx = p.x - S.view.tx, dy = p.y - S.view.ty;
  const rad = -S.view.rot * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const vx = dx * c - dy * s, vy = dx * s + dy * c;
  return { x: vx / S.view.scale + S.img.width / 2, y: vy / S.view.scale + S.img.height / 2 };
}

function zoomAt(pt, factor) {
  const before = s2i(pt);
  S.view.scale = Math.min(20, Math.max(0.05, S.view.scale * factor));
  const rad = S.view.rot * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const vx = (before.x - S.img.width / 2) * S.view.scale;
  const vy = (before.y - S.img.height / 2) * S.view.scale;
  S.view.tx = pt.x - (vx * c - vy * s);
  S.view.ty = pt.y - (vx * s + vy * c);
  render();
}

// ---------- 绘制 ----------
function floorHeightKey() {
  const f = S.floorIdx;
  if (String(f) === 'roof') return 'roof';
  const n = parseInt(f, 10) || 1;
  return n >= 3 ? 2 : n;
}
window.floorHeightKey = floorHeightKey;

function floorHeightAnchor() {
  if (String(S.floorIdx) === 'roof' && S.roofHeightPos) return { ...S.roofHeightPos };
  const segs = S.segments.filter(sg => !sg.sizhiDim && !sg.neighborWall);
  if (!segs.length) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  segs.forEach(sg => [sg.a, sg.b].forEach(p => {
    minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
    miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
  }));
  const W = maxx - minx, H = maxy - miny;
  if (W <= 0 || H <= 0) return null;
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const dseg = (p, sg) => {
    const dx = sg.b.x - sg.a.x, dy = sg.b.y - sg.a.y;
    const L2 = dx * dx + dy * dy || 1;
    let tt = ((p.x - sg.a.x) * dx + (p.y - sg.a.y) * dy) / L2;
    tt = Math.max(0, Math.min(1, tt));
    return Math.hypot(p.x - (sg.a.x + dx * tt), p.y - (sg.a.y + dy * tt));
  };
  let best = null;
  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4; j++) {
      const p = { x: minx + W * i / 5, y: miny + H * j / 5 };
      let d = Infinity;
      segs.forEach(sg => { d = Math.min(d, dseg(p, sg)); });
      (S.doors || []).forEach(dr => { d = Math.min(d, Math.hypot(p.x - dr.pos.x, p.y - dr.pos.y)); });
      const dc = Math.hypot(p.x - cx, p.y - cy);
      const score = d - dc * 0.12;
      if (!best || score > best.score) best = { x: p.x, y: p.y, score };
    }
  }
  return best;
}
window.floorHeightAnchor = floorHeightAnchor;

function render() {
  if (!cv.width) return;
  const dpr = window.devicePixelRatio || 1;
  const sc = Math.max(0.05, S.view.scale);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width / dpr, cv.height / dpr);
  const hasImg = !!S.img;

  if (hasImg && S.app !== 'zh' && S.app !== 'sketch') {
    ctx.save();
    ctx.translate(S.view.tx, S.view.ty);
    ctx.rotate(S.view.rot * Math.PI / 180);
    ctx.scale(S.view.scale, S.view.scale);
    ctx.drawImage(S.img, -S.img.width / 2, -S.img.height / 2);
    ctx.restore();
  }

  // 方格网（图纸坐标，50 单位一格，随缩放，铺满画布）
  if (S.img) {
    const step = 50;
    const wpx = cv.width / dpr, hpx = cv.height / dpr;
    const c1 = s2i({ x: 0, y: 0 }), c2 = s2i({ x: wpx, y: 0 });
    const c3 = s2i({ x: 0, y: hpx }), c4 = s2i({ x: wpx, y: hpx });
    const xs = [c1.x, c2.x, c3.x, c4.x], ys = [c1.y, c2.y, c3.y, c4.y];
    const minx2 = Math.min(...xs), maxx2 = Math.max(...xs);
    const miny2 = Math.min(...ys), maxy2 = Math.max(...ys);
    ctx.save();
    ctx.strokeStyle = 'rgba(18, 58, 99, 0.10)';
    ctx.lineWidth = Math.max(0.4, 1 * sc);
    for (let x = Math.floor(minx2 / step) * step; x <= maxx2; x += step) {
      const a = i2s({ x, y: miny2 }), b = i2s({ x, y: maxy2 });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let y = Math.floor(miny2 / step) * step; y <= maxy2; y += step) {
      const a = i2s({ x: minx2, y }), b = i2s({ x: maxx2, y });
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  // 天面切分：两块候选区域（点选保留侧）
  if (S.roofSplit && S.roofSplit.polys && S.roofSplit.polys.length === 2) {
    S.roofSplit.polys.forEach((poly, i) => {
      if (!poly || poly.length < 3) return;
      ctx.save();
      ctx.beginPath();
      poly.forEach((p, j) => {
        const q = i2s(p);
        if (j === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = i === 0 ? 'rgba(33,150,243,0.14)' : 'rgba(255,193,7,0.20)';
      ctx.fill();
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = '#607d8b';
      ctx.lineWidth = Math.max(0.6, 2 * sc);
      ctx.stroke();
      ctx.restore();
    });
  }

  // 线段
  S.segments.forEach((sg, i) => {
    const a = i2s(sg.a), b = i2s(sg.b);
    const sel = S.selected && S.selected.kind === 'seg' && S.selected.idx === i;
    ctx.strokeStyle = sg.roofOpen ? '#90a4ae' : (sg.neighborWall ? '#8d6e63'
      : (sg.neighborStair ? '#8b6b5a'
      : (sg.stair ? '#6d4c41'
      : (sg.balcony ? '#2e7d32'
      : (sel ? '#d32f2f' : '#1565c0')))));
    ctx.lineWidth = Math.max(0.5, (sel ? 5 : 3) * sc);
    if (sg.sizhiDim || sg.roofOpen) ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (sg.sizhiDim || sg.roofOpen) ctx.setLineDash([]);
    if (!(sg.balcony && sg.draft) && !sg.neighborStair && !sg.sizhiDim && !sg.neighborWall) {
      drawLabel(sg.len == null ? '?' : sg.len.toFixed(3), a, b,
        (sel || (S.multi || []).indexOf(i) >= 0) ? '#d32f2f' : (sg.len == null ? '#e65100' : '#1565c0'));
    }
  });

  // 四至邻墙间距：两端箭头
  S.segments.forEach(sg => {
    if (!sg.sizhiDim) return;
    const a2 = i2s(sg.a), b2 = i2s(sg.b);
    let dx = b2.x - a2.x, dy = b2.y - a2.y;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
    const px = -dy, py = dx;
    const arrow = (tip, dirx, diry) => {
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - dirx * 12 + px * 5, tip.y - diry * 12 + py * 5);
      ctx.lineTo(tip.x - dirx * 12 - px * 5, tip.y - diry * 12 - py * 5);
      ctx.closePath(); ctx.fill();
    };
    ctx.save();
    ctx.fillStyle = '#8d6e63';
    arrow(b2, dx, dy);
    arrow(a2, -dx, -dy);
    ctx.restore();
  });

  // 点选模式：普通线段画端点圆点；++ 内部长线两端画箭头
  if (S.mode === 'select') {
    const seen = new Set();
    const arrow = (p, other) => {
      const a = i2s(p), o = i2s(other);
      let dx = a.x - o.x, dy = a.y - o.y;
      const n = Math.hypot(dx, dy) || 1;
      dx /= n; dy /= n;
      const px = -dy, py = dx;
      const tip = { x: a.x + dx * 10, y: a.y + dy * 10 };
      ctx.fillStyle = '#1565c0';
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(a.x + px * 5, a.y + py * 5);
      ctx.lineTo(a.x - px * 5, a.y - py * 5);
      ctx.closePath(); ctx.fill();
    };
    S.segments.forEach(sg => {
      const isDim = sg.adj === '++';
      if (isDim) { arrow(sg.a, sg.b); arrow(sg.b, sg.a); return; }
      if (sg.sizhiDim || sg.neighborWall || sg.stair) return;
      [sg.a, sg.b].forEach(p => {
        const k = Math.round(p.x) + ',' + Math.round(p.y);
        if (seen.has(k)) return;
        seen.add(k);
        const a = i2s(p);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1565c0';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    });
  }

  // 梯屋起点提示
  if (S.stairStart) {
    const q = i2s(S.stairStart);
    ctx.save();
    ctx.fillStyle = '#6d4c41';
    ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  // 阳台第一点提示
  if (S.balconyFirst && S.balconyFirst.A) {
    const q = i2s(S.balconyFirst.A);
    ctx.save();
    ctx.fillStyle = '#2e7d32';
    ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  // 阳台文字（跟随阳台段移动）
  S.segments.forEach(sg => {
    if (!sg.balconyLabel) return;
    const mx = (sg.a.x + sg.b.x) / 2, my = (sg.a.y + sg.b.y) / 2;
    const q = i2s({ x: mx, y: my });
    ctx.save();
    ctx.fillStyle = '#2e7d32'; ctx.font = 'bold ' + (40 * sc) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('阳台', q.x, q.y - 14 * sc);
    ctx.restore();
  });

  // 四至（按图面侧别：上/右/下/左；输入时显示计算出的东南西北提示）
  if (S.sizhi && S.segments.length) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    S.segments.filter(sg => !sg.sizhiDim && !sg.neighborWall && !sg.stair && !sg.balcony).forEach(sg => {
      [sg.a, sg.b].forEach(p => {
        minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
        miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
      });
    });
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const near = 150, far = 250, tick = 50;
    const P = (x, y) => i2s({ x, y });
    const seg = (x1, y1, x2, y2) => {
      const a = P(x1, y1), b = P(x2, y2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    const geoms = {
      up:    { line: [minx, miny - far, maxx, miny - far], ticks: [[minx, miny - far, minx, miny - far - tick], [maxx, miny - far, maxx, miny - far - tick]], tp: [cx, miny - near], dp: [cx, miny - far - 36], vertical: false },
      right: { line: [maxx + far, miny, maxx + far, maxy], ticks: [[maxx + far, miny, maxx + far + tick, miny], [maxx + far, maxy, maxx + far + tick, maxy]], tp: [maxx + near, cy], dp: [maxx + far + 40, cy], vertical: true },
      down:  { line: [minx, maxy + far, maxx, maxy + far], ticks: [[minx, maxy + far, minx, maxy + far + tick], [maxx, maxy + far, maxx, maxy + far + tick]], tp: [cx, maxy + near], dp: [cx, maxy + far + 36], vertical: false },
      left:  { line: [minx - far, miny, minx - far, maxy], ticks: [[minx - far, miny, minx - far - tick, miny], [minx - far, maxy, minx - far - tick, maxy]], tp: [minx - near, cy], dp: [minx - far - 40, cy], vertical: true },
    };
    ctx.save();
    ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    ['up', 'right', 'down', 'left'].forEach(side => {
      const it = S.sizhi[side];
      if (!it || !it.adj || !it.adj.on) return;
      const g2 = geoms[side];
      g2.ticks.forEach(tk => seg(tk[0], tk[1], tk[2], tk[3]));
    });
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#5d4037'; ctx.font = 'bold ' + (40 * sc) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['up', 'right', 'down', 'left'].forEach(side => {
      const it = S.sizhi[side];
      if (!it || !it.adj || !it.adj.on) return;
      const labels = it.adj.labels || [{ door: it.adj.door, struct: it.adj.struct, floors: it.adj.floors }];
      labels.forEach((lb, idx) => {
        if (!lb) return;
        const txt = [lb.door ? '#' + lb.door : '', ((lb.struct || '') + (lb.floors || '')).trim()].filter(Boolean).join(' ');
        if (!txt) return;
        const frac = idx === 0 ? 0.28 : 0.72;
        let pos = lb.pos ? { ...lb.pos } : null;
        if (!pos && side === 'up') pos = { x: minx + (maxx - minx) * frac, y: miny - far - 36 };
        else if (!pos && side === 'down') pos = { x: minx + (maxx - minx) * frac, y: maxy + far + 36 };
        else if (!pos && side === 'left') pos = { x: minx - far - 40, y: miny + (maxy - miny) * frac };
        else if (!pos) pos = { x: maxx + far + 40, y: miny + (maxy - miny) * frac };
        const q = P(pos.x, pos.y);
        if (side === 'left' || side === 'right') {
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(-Math.PI / 2);
          ctx.fillText(txt, 0, 0); ctx.restore();
        } else {
          ctx.fillText(txt, q.x, q.y);
        }
      });
    });
    ctx.restore();
    ctx.save();
    ctx.font = 'bold ' + (44 * sc) + 'px sans-serif';
    ctx.fillStyle = '#6d4c41';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['up', 'right', 'down', 'left'].forEach(side => {
      const it = S.sizhi[side];
      if (!it) return;
      const q = P(geoms[side].tp[0], geoms[side].tp[1]);
      if (side === 'left' || side === 'right') {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(it.text || '', 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(it.text || '', q.x, q.y);
      }
    });
    ctx.restore();
    ctx.restore();
  }

  // 层高标注 h=?（天面要等选完梯屋区域后再显示）
  (function drawFloorHeight() {
    if (String(S.floorIdx) === 'roof' && !S.roofHeightPos) return;
    const pos = floorHeightAnchor();
    if (!pos) return;
    const key = floorHeightKey();
    const val = (S.heights || {})[key];
    const q = i2s(pos);
    ctx.save();
    ctx.fillStyle = '#00695c';
    ctx.font = 'bold ' + (44 * sc) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('h=' + (val == null ? '?' : val.toFixed(3)), q.x, q.y);
    ctx.restore();
  })();

  // 门牌（#xx）：吸附在墙上，文字放到墙体内部
  (S.doors || []).forEach(d => {
    const q = i2s(d.pos);
    const vert = d.horiz === false;
    let ind = d.in;
    if (ind == null) {
      // 兼容旧数据：按重心方向算向内
      let cx = 0, cy = 0, np = 0;
      S.segments.forEach(sg => {
        if (sg.balcony || sg.stair || sg.sizhiDim || sg.neighborWall) return;
        cx += sg.a.x + sg.b.x; cy += sg.a.y + sg.b.y; np += 2;
      });
      cx /= Math.max(1, np); cy /= Math.max(1, np);
      ind = vert ? (cx - d.pos.x >= 0 ? 1 : -1) : (cy - d.pos.y >= 0 ? 1 : -1);
    }
    const off = 40 * sc;
    ctx.save();
    ctx.fillStyle = '#5d4037';
    ctx.font = 'bold ' + (44 * sc) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (vert) {
      ctx.translate(q.x + ind * off, q.y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('#' + d.num, 0, 0);
    } else {
      ctx.fillText('#' + d.num, q.x, q.y + ind * off);
    }
    ctx.restore();
  });

  // 指北针（北向角已校准时）
  if (typeof S.north === 'number') {
    const c = { x: (cv.width / dpr) - 46, y: (cv.height / dpr) - 46 };
    const rad = -S.north * Math.PI / 180;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(rad);
    ctx.strokeStyle = '#123a63'; ctx.fillStyle = '#123a63'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -18); ctx.lineTo(7, 6); ctx.lineTo(0, 1); ctx.lineTo(-7, 6); ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#123a63'; ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('N', c.x, c.y + 26);
    ctx.restore();
  }

  // 点注
  S.notes.forEach((nt, i) => {
    const sel = S.selected && S.selected.kind === 'note' && S.selected.idx === i;
    const q = i2s(nt.pos);
    let txt = nt.len == null ? '?' : nt.len.toFixed(3);
    if (nt.adj) txt = `${nt.adj[0]} ${txt} ${nt.adj[1] || ' '}`;
    ctx.save();
    ctx.translate(q.x, q.y);
    if (nt.a && nt.b) {
      const pa = i2s(nt.a), pb = i2s(nt.b);
      ctx.rotate(Math.atan2(pb.y - pa.y, pb.x - pa.x));
    }
    ctx.fillStyle = sel ? '#d32f2f' : '#00695c';
    ctx.font = 'bold 15px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(txt, 0, -8);
    ctx.restore();
    ctx.fillStyle = sel ? '#d32f2f' : '#00695c';
    ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill();
  });

  // 总长（被分割掉的原始线）：向外偏移的实线双箭头尺寸线，可点选
  (S.totals || []).forEach((tt, i) => {
    if (!tt.a || !tt.b) return;
    const dx = tt.b.x - tt.a.x, dy = tt.b.y - tt.a.y;
    const L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    const midx = (tt.a.x + tt.b.x) / 2, midy = (tt.a.y + tt.b.y) / 2;
    let cxx = 0, cyy = 0, np2 = 0;
    S.segments.forEach(sg => {
      if (sg.balcony || sg.stair || sg.sizhiDim || sg.neighborWall) return;
      cxx += sg.a.x + sg.b.x; cyy += sg.a.y + sg.b.y; np2 += 2;
    });
    cxx /= Math.max(1, np2); cyy /= Math.max(1, np2);
    if ((midx - cxx) * nx + (midy - cyy) * ny < 0) { nx = -nx; ny = -ny; }
    const off = 70;
    const a2 = { x: tt.a.x + nx * off, y: tt.a.y + ny * off };
    const b2 = { x: tt.b.x + nx * off, y: tt.b.y + ny * off };
    const A = i2s(a2), B = i2s(b2);
    const A0 = i2s(tt.a), B0 = i2s(tt.b);
    const selT = S.selected && S.selected.kind === 'total' && S.selected.idx === i;
    const col = selT ? '#d32f2f' : '#6a1b9a';
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    // 引出线（细实线）
    ctx.lineWidth = Math.max(0.5, 1.2 * sc);
    ctx.beginPath(); ctx.moveTo(A0.x, A0.y); ctx.lineTo(A.x, A.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(B0.x, B0.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    // 尺寸实线
    ctx.lineWidth = Math.max(0.6, (selT ? 3 : 2) * sc);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    // 两端箭头（与邻墙间距同款）
    let ux = B.x - A.x, uy = B.y - A.y;
    const un = Math.hypot(ux, uy) || 1;
    ux /= un; uy /= un;
    const px = -uy, py = ux;
    const al = Math.max(6, 12 * sc), aw = Math.max(3, 5 * sc);
    const arrowTip = (tip, dirx, diry) => {
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - dirx * al + px * aw, tip.y - diry * al + py * aw);
      ctx.lineTo(tip.x - dirx * al - px * aw, tip.y - diry * al - py * aw);
      ctx.closePath(); ctx.fill();
    };
    arrowTip(A, -ux, -uy);
    arrowTip(B, ux, uy);
    ctx.restore();
    let warn = false;
    if (tt.len != null && tt.children) {
      const kids = tt.children.map(cid => S.segments.find(x => x.id === cid)).filter(Boolean);
      if (kids.length && kids.every(k => k.len != null)) {
        const ksum = kids.reduce((s2, k) => s2 + (k.len || 0), 0);
        if (Math.abs(ksum - tt.len) > 0.01) warn = true;
      }
    }
    const txt = '总长' + (i + 1) + ' ' + (tt.len == null ? '?' : tt.len.toFixed(3)) + (warn ? ' !' : '');
    drawLabel(txt, A, B, col);
  });

  // 竣工图柱子
  (S.columns || []).forEach(c => {
    const a = i2s({ x: c.x, y: c.y });
    const b = i2s({ x: c.x + c.w, y: c.y + c.h });
    ctx.save();
    ctx.strokeStyle = '#8e24aa';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  });

  if (S.interior && S.interior.length > 2) {
    ctx.save();
    ctx.setLineDash([10, 6]);
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 2;
    ctx.beginPath();
    S.interior.forEach((p, i) => {
      const q = i2s(p);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  if (S.cropDragStart && S.cropDragCur) {
    const a = i2s(S.cropDragStart), b = i2s(S.cropDragCur);
    ctx.save();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y),
                   Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }
  if (S.crop) {
    const a = i2s({ x: S.crop.x0, y: S.crop.y0 });
    const b = i2s({ x: S.crop.x1, y: S.crop.y1 });
    ctx.save();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = '#f5a623';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y),
                   Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.restore();
  }
  if (S.freeFrom) {
    const q = i2s(S.freeFrom);
    ctx.fillStyle = '#ff9800';
    ctx.beginPath(); ctx.arc(q.x, q.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (S.addFrom) {
    const q = i2s(S.addFrom);
    ctx.fillStyle = '#ff9800';
    ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (S.anchor) {
    const q = i2s(S.anchor);
    ctx.fillStyle = '#f5a623';
    ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.fill();
  }
  if (S.pending) {
    const q = i2s(S.pending);
    ctx.fillStyle = '#f5a623';
    ctx.beginPath(); ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.fill();
  }
}

function drawLabel(text, a, b, color) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  let ang = Math.atan2(dy, dx);
  // 统一成正向：避免数字倒置/反读
  if (ang > Math.PI / 2) ang -= Math.PI;
  else if (ang < -Math.PI / 2) ang += Math.PI;
  const nx = Math.abs(Math.sin(ang)) > 0.7 ? 1 : 0;
  const ny = nx ? 0 : -1;
  ctx.save();
  const lsc = Math.max(0.05, S.view.scale || 1);
  ctx.translate(mx + nx * 14 * lsc, my + ny * 14 * lsc);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.font = 'bold ' + (40 * (S.view.scale || 1)) + 'px Consolas, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ---------- 列表 / 修正（实现已移到 js/ui.js） ----------
function itemOf(sel) { return window.UI.itemOf(sel); }
function thicknessM() { return window.UI.thicknessM(); }
function nPlus(adj) { return window.UI.nPlus(adj); }
function corrected(it) { return window.UI.corrected(it); }
function refreshList() { return window.UI.refreshList(); }

  window.WS = {
    S, $, setStatus, setBle, resizeCanvas, fitView,
    rotPoint, i2s, s2i, zoomAt, render, drawLabel,
  };
})();
