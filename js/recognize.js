/* 附图识别：框选识别（像素提线） + 内部识别（依赖注入） */
(function () {
  let hooks = null;
  const S = () => hooks.getState();
function traceLinesJS(useCrop) {
  const stats = {}; window.__traceStats = stats;
  const W = S().img.width, H = S().img.height;
  const cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  const cx = cvs.getContext('2d');
  cx.drawImage(S().img, 0, 0);
  const data = cx.getImageData(0, 0, W, H).data;
  const bin = new Uint8Array(W * H);
  for (let i = 0, p4 = 0; p4 < W * H; p4++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = (r + g + b) / 3;
    const red = r > 120 && r - g > 40 && r - b > 40;
    bin[p4] = gray < 165 && !red ? 1 : 0;
  }
  let rx0 = 0, ry0 = 0, rx1 = W, ry1 = H;
  if (useCrop && S().crop) {
    rx0 = Math.max(0, Math.floor(Math.min(S().crop.x0, S().crop.x1)));
    ry0 = Math.max(0, Math.floor(Math.min(S().crop.y0, S().crop.y1)));
    rx1 = Math.min(W, Math.ceil(Math.max(S().crop.x0, S().crop.x1)));
    ry1 = Math.min(H, Math.ceil(Math.max(S().crop.y0, S().crop.y1)));
  } else {
    const vlong = openRunsV(bin, W, H, Math.floor(H * 0.45));
    const hlong = openRunsH(bin, W, H, Math.floor(W * 0.45));
    const colHit = new Int32Array(W);
    const rowHit = new Int32Array(H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (vlong[y * W + x]) colHit[x]++;
        if (hlong[y * W + x]) rowHit[y]++;
      }
    }
    const vcols = [], hrows = [];
    for (let x = 0; x < W; x++) if (colHit[x] > H * 0.25) vcols.push(x);
    for (let y = 0; y < H; y++) if (rowHit[y] > W * 0.25) hrows.push(y);
    if (vcols.length >= 2 && hrows.length >= 2) {
      const left = Math.min(...vcols), right = Math.max(...vcols);
      const top = Math.min(...hrows), bot = Math.max(...hrows);
      if (left < W * 0.15 && right > W * 0.85 && top < H * 0.15 && bot > H * 0.85) {
        rx0 = Math.max(0, left + 6); ry0 = Math.max(0, top + 6);
        rx1 = Math.min(W, right - 6); ry1 = Math.min(H, bot - 6);
      }
    }
  }
  stats.region = [rx0, ry0, rx1, ry1];
  const sw = rx1 - rx0, sh = ry1 - ry0;
  if (sw < 10 || sh < 10) return [];
  const sub = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    const srcBase = (ry0 + y) * W + rx0;
    const dstBase = y * sw;
    for (let x = 0; x < sw; x++) sub[dstBase + x] = bin[srcBase + x];
  }
  const extract = (klen, minlen) => {
    const hor = openRunsH(sub, sw, sh, klen);
    const ver = openRunsV(sub, sw, sh, klen);
    const out = [];
    for (const bb of boxes(hor, sw, sh, minlen, 1)) {
      if (!useCrop && bb.w > sw * 0.9) continue;
      if (!useCrop && bb.y > sh * 0.66) continue;
      out.push({ typ: 'H', a0: bb.x, a1: bb.x + bb.w, c: bb.y + bb.h / 2 });
    }
    for (const bb of boxes(ver, sw, sh, 1, minlen)) {
      if (!useCrop && bb.h > sh * 0.9) continue;
      if (!useCrop && bb.x > sw * 0.66 && bb.y > sh * 0.6) continue;
      out.push({ typ: 'V', a0: bb.y, a1: bb.y + bb.h, c: bb.x + bb.w / 2 });
    }
    return out;
  };
  let segs = extract(25, 30);
  stats.long = segs.length;
  if (useCrop && S().crop) {
    const shorts = extract(10, 15);
    const ep = (s) => s.typ === 'H' ? [[s.a0, s.c], [s.a1, s.c]] : [[s.c, s.a0], [s.c, s.a1]];
    const accepted = segs.slice();
    let changed = true;
    while (changed && shorts.length) {
      changed = false;
      const endpts = [];
      accepted.forEach(acc => ep(acc).forEach(q => endpts.push(q)));
      for (let i = shorts.length - 1; i >= 0; i--) {
        const s = shorts[i];
        const ok = ep(s).some(p => endpts.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 12));
        if (ok) { accepted.push(s); shorts.splice(i, 1); changed = true; }
      }
    }
    segs = accepted;
    stats.withShorts = segs.length;
  }
  const dedupe = (items) => {
    const out = [];
    for (const s of items) {
      let dup = false;
      for (const o of out) {
        if (o.typ === s.typ && Math.abs(o.c - s.c) <= 4) {
          const lo = Math.max(s.a0, o.a0), hi = Math.min(s.a1, o.a1);
          if (hi - lo > 0.6 * Math.min(s.a1 - s.a0, o.a1 - o.a0)) { dup = true; break; }
        }
      }
      if (!dup) out.push({ ...s });
    }
    return out;
  };
  const mergeCollinear = (items, ctol = 12, gap = 30) => {
    const sorted = items.slice().sort((p, q) => (p.typ < q.typ ? -1 : p.typ > q.typ ? 1 : p.c - q.c || p.a0 - q.a0));
    const out = [];
    for (const s of sorted) {
      let placed = false;
      for (const o of out) {
        if (o.typ === s.typ && Math.abs(o.c - s.c) <= ctol &&
            s.a0 <= o.a1 + gap && s.a1 >= o.a0 - gap) {
          const l1 = Math.max(1, o.a1 - o.a0), l2 = Math.max(1, s.a1 - s.a0);
          o.c = (o.c * l1 + s.c * l2) / (l1 + l2);
          o.a0 = Math.min(o.a0, s.a0);
          o.a1 = Math.max(o.a1, s.a1);
          placed = true;
          break;
        }
      }
      if (!placed) out.push({ ...s });
    }
    return out;
  };
  const snapCorners = (items, tol = 12) => {
    const Hs = items.filter(s => s.typ === 'H').map(s => ({ ...s }));
    const Vs = items.filter(s => s.typ === 'V').map(s => ({ ...s }));
    for (const h of Hs) for (const v of Vs) {
      const x = v.c, y = h.c;
      if (h.a0 - tol <= x && x <= h.a1 + tol && v.a0 - tol <= y && y <= v.a1 + tol) {
        if (h.a0 - x >= 0 && h.a0 - x <= tol) h.a0 = x;
        if (x - h.a1 >= 0 && x - h.a1 <= tol) h.a1 = x;
        if (v.a0 - y >= 0 && v.a0 - y <= tol) v.a0 = y;
        if (y - v.a1 >= 0 && y - v.a1 <= tol) v.a1 = y;
      }
    }
    return Hs.concat(Vs);
  };
  const closeLoop = (items, maxext = 120, minlenTarget = 25) => {
    let cur = items.map(s => ({ ...s }));
    for (let iter = 0; iter < 6; iter++) {
      const Hs = cur.filter(s => s.typ === 'H');
      const Vs = cur.filter(s => s.typ === 'V');
      let changed = false;
      for (const h of Hs) {
        const y = h.c;
        for (const side of ['L', 'R']) {
          const touching = Vs.some(v => Math.abs(v.c - (side === 'R' ? h.a1 : h.a0)) <= 10 &&
                                     v.a0 - 10 <= y && y <= v.a1 + 10);
          if (touching) continue;
          let best = null;
          for (const v of Vs) {
            if (v.a1 - v.a0 < minlenTarget) continue;
            const x = v.c;
            let dist;
            if (side === 'R') { if (x <= h.a1 + 1) continue; dist = x - h.a1; }
            else { if (x >= h.a0 - 1) continue; dist = h.a0 - x; }
            if (dist > maxext || dist <= 0) continue;
            if (!(v.a0 - maxext <= y && y <= v.a1 + maxext)) continue;
            if (!best || dist < best.dist) best = { dist, v };
          }
          if (best) {
            if (side === 'R') h.a1 = best.v.c; else h.a0 = best.v.c;
            if (y < best.v.a0) best.v.a0 = y;
            else if (y > best.v.a1) best.v.a1 = y;
            changed = true;
          }
        }
      }
      for (const v of Vs) {
        const x = v.c;
        for (const side of ['T', 'B']) {
          const touching = Hs.some(h => Math.abs(h.c - (side === 'B' ? v.a1 : v.a0)) <= 10 &&
                                     h.a0 - 10 <= x && x <= h.a1 + 10);
          if (touching) continue;
          let best = null;
          for (const h of Hs) {
            if (h.a1 - h.a0 < minlenTarget) continue;
            const y = h.c;
            let dist;
            if (side === 'B') { if (y <= v.a1 + 1) continue; dist = y - v.a1; }
            else { if (y >= v.a0 - 1) continue; dist = v.a0 - y; }
            if (dist > maxext || dist <= 0) continue;
            if (!(h.a0 - maxext <= x && x <= h.a1 + maxext)) continue;
            if (!best || dist < best.dist) best = { dist, h };
          }
          if (best) {
            if (side === 'B') v.a1 = best.h.c; else v.a0 = best.h.c;
            if (x < best.h.a0) best.h.a0 = x;
            else if (x > best.h.a1) best.h.a1 = x;
            changed = true;
          }
        }
      }
      cur = Hs.map(s => ({ ...s })).concat(Vs.map(s => ({ ...s })));
      if (!changed) break;
    }
    return cur;
  };
  segs = dedupe(segs); stats.deduped = segs.length;
  segs = mergeCollinear(segs); stats.merged = segs.length;
  segs = snapCorners(segs, 12); stats.snapped = segs.length;
  segs = closeLoop(segs); stats.closed = segs.length;
  const isConnected = (s, others) => {
    const pts = s.typ === 'H' ? [[s.a0, s.c], [s.a1, s.c]] : [[s.c, s.a0], [s.c, s.a1]];
    for (const o of others) {
      if (o === s || o.typ === s.typ) continue;
      for (const [px, py] of pts) {
        if (o.typ === 'H') {
          if (o.a0 - 12 <= px && px <= o.a1 + 12 && Math.abs(py - o.c) <= 12) return true;
        } else {
          if (o.a0 - 12 <= py && py <= o.a1 + 12 && Math.abs(px - o.c) <= 12) return true;
        }
      }
    }
    return false;
  };
  segs = segs.filter(s => isConnected(s, segs) || (s.a1 - s.a0) >= 100);
  stats.connected = segs.length;
  segs = segs.filter(s => (s.a1 - s.a0) >= 4); stats.len4 = segs.length;
  segs = dedupe(segs);
  // 电脑版最后一步：裁掉外侧图框 / 底部表格 / 标题下的长横线
  if (!useCrop) {
    segs = segs.filter(s => {
      if (s.typ === 'H') {
        const my = s.c + ry0;
        const length = s.a1 - s.a0;
        if (my < H * 0.18 || my > H * 0.70) return false;
        if (my < H * 0.25 && length > W * 0.55) return false;
      } else {
        const mx = s.c + rx0;
        if (mx < W * 0.10 || mx > W * 0.85) return false;
      }
      return true;
    });
  }
  stats.final = segs.length;
  return segs.map(s => s.typ === 'H'
    ? { a: { x: s.a0 + rx0, y: s.c + ry0 }, b: { x: s.a1 + rx0, y: s.c + ry0 }, len: null, adj: '' }
    : { a: { x: s.c + rx0, y: s.a0 + ry0 }, b: { x: s.c + rx0, y: s.a1 + ry0 }, len: null, adj: '' });
}

function ptSegDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const L2 = abx * abx + aby * aby || 1;
  let tt = ((px - ax) * abx + (py - ay) * aby) / L2;
  tt = Math.max(0, Math.min(1, tt));
  return Math.hypot(px - (ax + abx * tt), py - (ay + aby * tt));
}

// 逐行“闭运算”：把间隔 <= gap 的段接起来
function closeRunsH(mask, w, h, gap) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    const base = y * w;
    while (x < w) {
      if (!mask[base + x]) { x++; continue; }
      let start = x, end = x, i = x;
      while (i < w) {
        if (mask[base + i]) { end = i; i++; continue; }
        let j = i;
        while (j < w && !mask[base + j]) j++;
        if (j < w && j - i <= gap) { i = j; continue; }
        break;
      }
      for (let k = start; k <= end; k++) out[base + k] = 1;
      x = end + 1;
    }
  }
  return out;
}

function openRunsH(mask, w, h, minLen) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const base = y * w;
    let x = 0;
    while (x < w) {
      if (!mask[base + x]) { x++; continue; }
      const s = x;
      while (x < w && mask[base + x]) x++;
      if (x - s >= minLen) for (let k = s; k < x; k++) out[base + k] = 1;
    }
  }
  return out;
}

function closeRunsV(mask, w, h, gap) {
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) { y++; continue; }
      let start = y, end = y, i = y;
      while (i < h) {
        if (mask[i * w + x]) { end = i; i++; continue; }
        let j = i;
        while (j < h && !mask[j * w + x]) j++;
        if (j < h && j - i <= gap) { i = j; continue; }
        break;
      }
      for (let k = start; k <= end; k++) out[k * w + x] = 1;
      y = end + 1;
    }
  }
  return out;
}

function openRunsV(mask, w, h, minLen) {
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) { y++; continue; }
      const s = y;
      while (y < h && mask[y * w + x]) y++;
      if (y - s >= minLen) for (let k = s; k < y; k++) out[k * w + x] = 1;
    }
  }
  return out;
}

// 连通块外接框（4 连通）
function boxes(mask, w, h, minW, minH) {
  const seen = new Uint8Array(w * h);
  const res = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    while (stack.length) {
      const q = stack.pop();
      const qx = q % w, qy = (q / w) | 0;
      if (qx < minX) minX = qx;
      if (qx > maxX) maxX = qx;
      if (qy < minY) minY = qy;
      if (qy > maxY) maxY = qy;
      const nb = [q - 1, q + 1, q - w, q + w];
      for (const n of nb) {
        if (n < 0 || n >= w * h) continue;
        if ((n === q - 1 && qx === 0) || (n === q + 1 && qx === w - 1)) continue;
        if (!seen[n] && mask[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw >= minW && bh >= minH) res.push({ x: minX, y: minY, w: bw, h: bh });
  }
  return res;
}

function interiorRecognize() {
  if (!S().segments.length) { hooks.setStatus('先用「框选识别」识别出外框'); return; }
  if (!S().img) { hooks.setStatus('先打开图纸'); return; }
  const outer = S().segments.slice();
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  outer.forEach(sg => {
    [sg.a, sg.b].forEach(p => {
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    });
  });
  const W = S().img.width, H = S().img.height;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  octx.drawImage(S().img, 0, 0);
  const data = octx.getImageData(0, 0, W, H).data;

  let x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (S().crop) {
    x0 = Math.max(0, Math.floor(Math.min(S().crop.x0, S().crop.x1)));
    y0 = Math.max(0, Math.floor(Math.min(S().crop.y0, S().crop.y1)));
    x1 = Math.min(W, Math.ceil(Math.max(S().crop.x0, S().crop.x1)));
    y1 = Math.min(H, Math.ceil(Math.max(S().crop.y0, S().crop.y1)));
  }
  const cw = x1 - x0, ch = y1 - y0;
  const bin = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const idx = ((y0 + y) * W + (x0 + x)) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const gray = (r + g + b) / 3;
      const red = r > 120 && r - g > 40 && r - b > 40;
      if (gray < 190 && !red) bin[y * cw + x] = 1;
    }
  }
  const hop = openRunsH(closeRunsH(bin, cw, ch, 24), cw, ch, 10);
  const vop = openRunsV(closeRunsV(bin, cw, ch, 24), cw, ch, 10);

  const cand = [];
  for (const bb of boxes(hop, cw, ch, 50, 1)) {
    const mx = x0 + bb.x + bb.w / 2;
    const my = y0 + bb.y + bb.h / 2;
    if (mx < minx + 8 || mx > maxx - 8 || my < miny + 8 || my > maxy - 8) continue;
    let a0 = x0 + bb.x, a1 = x0 + bb.x + bb.w;
    a0 = Math.max(minx, Math.min(maxx, a0));
    a1 = Math.max(minx, Math.min(maxx, a1));
    cand.push({ typ: 'H', a0, a1, c: my });
  }
  for (const bb of boxes(vop, cw, ch, 1, 50)) {
    const mx = x0 + bb.x + bb.w / 2;
    const my = y0 + bb.y + bb.h / 2;
    if (mx < minx + 8 || mx > maxx - 8 || my < miny + 8 || my > maxy - 8) continue;
    let a0 = y0 + bb.y, a1 = y0 + bb.y + bb.h;
    a0 = Math.max(miny, Math.min(maxy, a0));
    a1 = Math.max(miny, Math.min(maxy, a1));
    cand.push({ typ: 'V', a0, a1, c: mx });
  }
  // 去掉与外框重复
  const farFromOuter = (s) => {
    const px = s.typ === 'H' ? (s.a0 + s.a1) / 2 : s.c;
    const py = s.typ === 'H' ? s.c : (s.a0 + s.a1) / 2;
    for (const o of outer) {
      const oh = Math.abs(o.a.y - o.b.y) < Math.abs(o.a.x - o.b.x);
      if (s.typ === 'H' && oh) {
        if (Math.abs(py - o.a.y) <= 6 && px >= Math.min(o.a.x, o.b.x) - 6 && px <= Math.max(o.a.x, o.b.x) + 6) return false;
      }
      if (s.typ === 'V' && !oh) {
        if (Math.abs(px - o.a.x) <= 6 && py >= Math.min(o.a.y, o.b.y) - 6 && py <= Math.max(o.a.y, o.b.y) + 6) return false;
      }
    }
    return true;
  };
  const cand2 = cand.filter(farFromOuter);
  // 连接/长度过滤
  const segList = outer.map(sg => ({ a: sg.a, b: sg.b }));
  const connected = (px, py, list, tol) =>
    list.some(s => ptSegDist(px, py, s.a.x, s.a.y, s.b.x, s.b.y) <= tol);
  const kept = [];
  for (const s of cand2) {
    const pA = s.typ === 'H' ? { x: s.a0, y: s.c } : { x: s.c, y: s.a0 };
    const pB = s.typ === 'H' ? { x: s.a1, y: s.c } : { x: s.c, y: s.a1 };
    const L = Math.hypot(pB.x - pA.x, pB.y - pA.y);
    const pool = segList.concat(kept.map(k => ({ a: k.a, b: k.b })));
    if ((connected(pA.x, pA.y, pool, 14) && connected(pB.x, pB.y, pool, 14)) || L >= 250) {
      kept.push({ a: pA, b: pB, len: null, adj: '' });
    }
  }
  if (!kept.length) {
    hooks.setStatus('内部线都悬空或与外框重合，未添加');
    return;
  }
  hooks.pushUndo();
  S().interiorStart = S().segments.length;
  S().interior = null;
  S().segments.push(...kept);
  S().selected = null;
  hooks.render(); hooks.refreshList();
  hooks.setStatus(`内部识别：新增 ${kept.length} 条内部线（可点「撤回内部」撤销）`);
}

function interiorToSegments() {
  if (!S().interior || S().interior.length < 3) { hooks.setStatus('先做内部识别'); return; }
  hooks.pushUndo();
  for (let i = 0; i < S().interior.length; i++) {
    const a = S().interior[i], b = S().interior[(i + 1) % S().interior.length];
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
      S().segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: a.y }, len: null, adj: '' });
    } else {
      S().segments.push({ a: { x: a.x, y: a.y }, b: { x: a.x, y: b.y }, len: null, adj: '' });
    }
  }
  hooks.render(); hooks.refreshList();
  hooks.setStatus('已把内部轮廓转成线段');
}

  window.REC = {
    init(h) { hooks = h; },
    traceLinesJS,
    interiorRecognize,
    interiorToSegments,
  };
})();
