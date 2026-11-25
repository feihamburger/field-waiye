/* 状态与绘制核心：S、视图变换、画布渲染 */
(function () {
  'use strict';
const S = {
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
function render() {
  if (!cv.width) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cv.width / dpr, cv.height / dpr);
  const hasImg = !!S.img;

  if (hasImg) {
    ctx.save();
    ctx.translate(S.view.tx, S.view.ty);
    ctx.rotate(S.view.rot * Math.PI / 180);
    ctx.scale(S.view.scale, S.view.scale);
    ctx.drawImage(S.img, -S.img.width / 2, -S.img.height / 2);
    ctx.restore();
  }

  // 线段
  S.segments.forEach((sg, i) => {
    const a = i2s(sg.a), b = i2s(sg.b);
    const sel = S.selected && S.selected.kind === 'seg' && S.selected.idx === i;
    ctx.strokeStyle = sel ? '#d32f2f' : '#1565c0';
    ctx.lineWidth = sel ? 4 : 2;
    if (sg.sizhiDim) ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (sg.sizhiDim) ctx.setLineDash([]);
    if (!(sg.balcony && sg.draft)) {
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
      if (sg.sizhiDim) return;
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

  // 梯屋文字
  S.segments.forEach(sg => {
    if (!sg.stairLabel) return;
    const mx = (sg.a.x + sg.b.x) / 2, my = (sg.a.y + sg.b.y) / 2;
    const q = i2s({ x: mx, y: my });
    ctx.save();
    ctx.fillStyle = '#6d4c41'; ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('梯屋', q.x, q.y - 14);
    ctx.restore();
  });

  // 阳台文字（跟随阳台段移动）
  S.segments.forEach(sg => {
    if (!sg.balconyLabel) return;
    const mx = (sg.a.x + sg.b.x) / 2, my = (sg.a.y + sg.b.y) / 2;
    const q = i2s({ x: mx, y: my });
    ctx.save();
    ctx.fillStyle = '#2e7d32'; ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('阳台', q.x, q.y - 14);
    ctx.restore();
  });

  // 四至（按图面侧别：上/右/下/左；输入时显示计算出的东南西北提示）
  if (S.sizhi && S.segments.length) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    S.segments.filter(sg => !sg.sizhiDim).forEach(sg => {
      [sg.a, sg.b].forEach(p => {
        minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
        miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
      });
    });
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const near = 150, far = 260, tick = 18;
    const P = (x, y) => i2s({ x, y });
    const seg = (x1, y1, x2, y2) => {
      const a = P(x1, y1), b = P(x2, y2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    const geoms = {
      up:    { line: [minx, miny - far, maxx, miny - far], ticks: [[minx, miny - far, minx, miny - far - tick], [maxx, miny - far, maxx, miny - far - tick]], tp: [cx, miny - near], dp: [cx, miny - far - 16], vertical: false },
      right: { line: [maxx + far, miny, maxx + far, maxy], ticks: [[maxx + far, miny, maxx + far + tick, miny], [maxx + far, maxy, maxx + far + tick, maxy]], tp: [maxx + near, cy], dp: [maxx + far + 22, cy], vertical: true },
      down:  { line: [minx, maxy + far, maxx, maxy + far], ticks: [[minx, maxy + far, minx, maxy + far + tick], [maxx, maxy + far, maxx, maxy + far + tick]], tp: [cx, maxy + near], dp: [cx, maxy + far + 16], vertical: false },
      left:  { line: [minx - far, miny, minx - far, maxy], ticks: [[minx - far, miny, minx - far - tick, miny], [minx - far, maxy, minx - far - tick, maxy]], tp: [minx - near, cy], dp: [minx - far - 22, cy], vertical: true },
    };
    ctx.save();
    ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 2.5; ctx.setLineDash([]);
    ['up', 'right', 'down', 'left'].forEach(side => {
      const it = S.sizhi[side];
      if (!it || !it.adj || !it.adj.on) return;
      const g2 = geoms[side];
      seg(g2.line[0], g2.line[1], g2.line[2], g2.line[3]);
      g2.ticks.forEach(tk => seg(tk[0], tk[1], tk[2], tk[3]));
    });
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#5d4037'; ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['up', 'right', 'down', 'left'].forEach(side => {
      const it = S.sizhi[side];
      if (!it || !it.adj || !it.adj.on || !it.adj.door) return;
      const q = P(geoms[side].dp[0], geoms[side].dp[1]);
      ctx.fillText('#' + it.adj.door, q.x, q.y);
    });
    ctx.restore();
    ctx.save();
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#6d4c41';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['up', 'right', 'down', 'left'].forEach(side => {
      const it = S.sizhi[side];
      if (!it) return;
      const q = P(geoms[side].tp[0], geoms[side].tp[1]);
      ctx.fillText(it.text || '', q.x, q.y);
    });
    ctx.restore();
  }

  // 门牌（#xx）
  (S.doors || []).forEach(d => {
    const q = i2s(d.pos);
    ctx.save();
    ctx.strokeStyle = '#8d6e63'; ctx.fillStyle = '#5d4037';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x, q.y - 10); ctx.stroke();
    ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('#' + d.num, q.x, q.y - 12);
    ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
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

  // 总长（被分割掉的原始线，紫色虚线）
  (S.totals || []).forEach((tt, i) => {
    if (!tt.a || !tt.b) return;
    const a = i2s(tt.a), b = i2s(tt.b);
    ctx.save();
    ctx.setLineDash([10, 6]);
    ctx.strokeStyle = '#6a1b9a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
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
    drawLabel(txt, a, b, '#6a1b9a');
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
  ctx.translate(mx + nx * 14, my + ny * 14);
  ctx.rotate(ang);
  ctx.fillStyle = color;
  ctx.font = 'bold 14px Consolas, monospace';
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
