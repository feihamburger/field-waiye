/* 外业测量 · 平板网页版 (附图模式 + 手绘 + 点注 + 蓝牙) */
(() => {
  'use strict';

  const BLE_SERVICE = '3ab10100-f831-4395-b29d-570977d5bf94';
  const BLE_MEASURE = '3ab1010d-f831-4395-b29d-570977d5bf94';

  const S = {
    img: null,            // 已画到离屏 canvas 的图纸
    segments: [],         // {a:{x,y}, b:{x,y}, len, adj}
    notes: [],            // {pos:{x,y}, a,b, len, adj}
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
    bleDevice: null,
    bleChar: null,
    interior: null,
    interiorStart: null,      // 内部识别轮廓（图像坐标点数组）
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
  function setBle(t, on) { bleEl.textContent = t; bleEl.classList.toggle('on', !!on); }

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
    if (!S.img) return;

    ctx.save();
    ctx.translate(S.view.tx, S.view.ty);
    ctx.rotate(S.view.rot * Math.PI / 180);
    ctx.scale(S.view.scale, S.view.scale);
    ctx.drawImage(S.img, -S.img.width / 2, -S.img.height / 2);
    ctx.restore();

    // 线段
    S.segments.forEach((sg, i) => {
      const a = i2s(sg.a), b = i2s(sg.b);
      const sel = S.selected && S.selected.kind === 'seg' && S.selected.idx === i;
      ctx.strokeStyle = sel ? '#d32f2f' : '#1565c0';
      ctx.lineWidth = sel ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      drawLabel(sg.len == null ? '?' : sg.len.toFixed(3), a, b, sel ? '#d32f2f' : '#1565c0');
    });

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
    const ang = Math.atan2(dy, dx);
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

  // ---------- 列表 ----------
  function itemOf(sel) {
    if (!sel) return null;
    return sel.kind === 'seg' ? S.segments[sel.idx] : S.notes[sel.idx];
  }

  function thicknessM() {
    const v = parseFloat($('thick').value);
    return isNaN(v) ? 0 : Math.max(0, v / 1000);
  }

  function effLen(it) {
    if (it.len == null) return null;
    return it.len + (it.adj || '').split('+').length - 1 + 0; // placeholder, replaced below
  }

  function nPlus(adj) { return (adj || '').split('+').length - 1; }

  function corrected(it) {
    if (it.len == null) return null;
    return it.len + nPlus(it.adj) * thicknessM();
  }

  function refreshList() {
    const list = $('list');
    list.innerHTML = '';
    S.segments.forEach((sg, i) => {
      const div = document.createElement('div');
      div.className = 'row' + (S.selected && S.selected.kind === 'seg' && S.selected.idx === i ? ' sel' : '');
      const val = sg.len == null ? '?' : sg.len.toFixed(3) + ' m';
      const corr = sg.len != null && sg.adj ? ` → ${corrected(sg).toFixed(3)} m` : '';
      const ph = sg.photo ? ' 📷' : '';
      div.innerHTML = `<span>段${i + 1}<span class="tag"> ${sg.adj || ''}${ph}</span></span>
                       <span class="val">${val}${corr}</span>`;
      div.onclick = () => { S.selected = { kind: 'seg', idx: i }; render(); refreshList(); };
      list.appendChild(div);
    });
    S.notes.forEach((nt, i) => {
      const div = document.createElement('div');
      div.className = 'row' + (S.selected && S.selected.kind === 'note' && S.selected.idx === i ? ' sel' : '');
      let txt = nt.len == null ? '?' : nt.len.toFixed(3) + ' m';
      if (nt.adj) txt = `${nt.adj[0]} ${txt} ${nt.adj[1] || ''}`;
      const ph = nt.photo ? ' 📷' : '';
      div.innerHTML = `<span>点${i + 1}<span class="tag"> ${ph}</span></span><span class="val">${txt}</span>`;
      div.onclick = () => { S.selected = { kind: 'note', idx: i }; render(); refreshList(); };
      list.appendChild(div);
    });
    if (!S.segments.length && !S.notes.length) {
      list.innerHTML = '<div class="row">暂无数据：先「自动描线」或「手绘」</div>';
    }
  }

  // ---------- 撤销 ----------
  function pushUndo() {
    S.undo.push(JSON.stringify({ segments: S.segments, notes: S.notes }));
    if (S.undo.length > 50) S.undo.shift();
  }
  function undo() {
    if (!S.undo.length) { setStatus('没有可撤回的操作'); return; }
    const snap = JSON.parse(S.undo.pop());
    S.segments = snap.segments; S.notes = snap.notes;
    S.selected = null; render(); refreshList(); setStatus('已撤回');
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
        const off = document.createElement('canvas');
        off.width = Math.round(vp.width); off.height = Math.round(vp.height);
        await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
        S.img = off;
        setStatus(`已加载 ${file.name}（${off.width}×${off.height}）`);
      } else {
        const bmp = await createImageBitmap(file);
        const maxDim = 3000;
        const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
        const off = document.createElement('canvas');
        off.width = Math.round(bmp.width * k); off.height = Math.round(bmp.height * k);
        off.getContext('2d').drawImage(bmp, 0, 0, off.width, off.height);
        S.img = off;
        setStatus(`已加载 ${file.name}（${off.width}×${off.height}）`);
      }
      S.segments = []; S.notes = []; S.selected = null; S.undo = []; S.pending = null;
      $('hint').style.display = 'none';
      fitView(); refreshList();
    } catch (e) {
      alert('打开失败：' + e.message);
      setStatus('打开失败');
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

  function traceLinesJS(useCrop) {
    const stats = {}; window.__traceStats = stats;
    const W = S.img.width, H = S.img.height;
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const cx = cvs.getContext('2d');
    cx.drawImage(S.img, 0, 0);
    const data = cx.getImageData(0, 0, W, H).data;
    const bin = new Uint8Array(W * H);
    for (let i = 0, p4 = 0; p4 < W * H; p4++, i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const gray = (r + g + b) / 3;
      const red = r > 120 && r - g > 40 && r - b > 40;
      bin[p4] = gray < 165 && !red ? 1 : 0;
    }
    let rx0 = 0, ry0 = 0, rx1 = W, ry1 = H;
    if (useCrop && S.crop) {
      rx0 = Math.max(0, Math.floor(Math.min(S.crop.x0, S.crop.x1)));
      ry0 = Math.max(0, Math.floor(Math.min(S.crop.y0, S.crop.y1)));
      rx1 = Math.min(W, Math.ceil(Math.max(S.crop.x0, S.crop.x1)));
      ry1 = Math.min(H, Math.ceil(Math.max(S.crop.y0, S.crop.y1)));
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
    if (useCrop && S.crop) {
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

  function autoTrace(useCrop, returnOnly) {
    if (!S.img) { setStatus('先打开图纸'); return; }
    const segs = traceLinesJS(useCrop);
    if (!segs.length) { setStatus('没描到线，可能图片太淡或阈值不合适'); return; }
    if (returnOnly) return segs;
    pushUndo();
    S.segments = segs.slice(0, 600);
    S.notes = []; S.selected = null;
    S.mode = 'select';
    document.querySelectorAll('#toolbar [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === 'select'));
    render(); refreshList();
    setStatus(`识别完成：${S.segments.length} 条`);
  }

  // ---------- 内部识别（白区泛洪 + 轮廓） ----------
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
    if (!S.segments.length) { setStatus('先用「框选识别」识别出外框'); return; }
    if (!S.img) { setStatus('先打开图纸'); return; }
    const outer = S.segments.slice();
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    outer.forEach(sg => {
      [sg.a, sg.b].forEach(p => {
        minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
        miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
      });
    });
    const W = S.img.width, H = S.img.height;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const octx = off.getContext('2d');
    octx.drawImage(S.img, 0, 0);
    const data = octx.getImageData(0, 0, W, H).data;

    let x0 = 0, y0 = 0, x1 = W, y1 = H;
    if (S.crop) {
      x0 = Math.max(0, Math.floor(Math.min(S.crop.x0, S.crop.x1)));
      y0 = Math.max(0, Math.floor(Math.min(S.crop.y0, S.crop.y1)));
      x1 = Math.min(W, Math.ceil(Math.max(S.crop.x0, S.crop.x1)));
      y1 = Math.min(H, Math.ceil(Math.max(S.crop.y0, S.crop.y1)));
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
      setStatus('内部线都悬空或与外框重合，未添加');
      return;
    }
    pushUndo();
    S.interiorStart = S.segments.length;
    S.interior = null;
    S.segments.push(...kept);
    S.selected = null;
    render(); refreshList();
    setStatus(`内部识别：新增 ${kept.length} 条内部线（可点「撤回内部」撤销）`);
  }

  function interiorToSegments() {
    if (!S.interior || S.interior.length < 3) { setStatus('先做内部识别'); return; }
    pushUndo();
    for (let i = 0; i < S.interior.length; i++) {
      const a = S.interior[i], b = S.interior[(i + 1) % S.interior.length];
      if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
        S.segments.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: a.y }, len: null, adj: '' });
      } else {
        S.segments.push({ a: { x: a.x, y: a.y }, b: { x: a.x, y: b.y }, len: null, adj: '' });
      }
    }
    render(); refreshList();
    setStatus('已把内部轮廓转成线段');
  }

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
    S.segments.forEach((sg, i) => {
      const a = i2s(sg.a), b = i2s(sg.b);
      const r = distToSeg(pt, a, b);
      if (r.d <= 24 && (!best || r.d < best.d)) best = { idx: i, d: r.d, t: r.t };
    });
    return best;
  }

  function hitNote(pt) {
    let best = null;
    S.notes.forEach((nt, i) => {
      const q = i2s(nt.pos);
      const d = Math.hypot(pt.x - q.x, pt.y - q.y);
      if (d <= 30 && (!best || d < best.d)) best = { idx: i, d };
    });
    return best ? best.idx : null;
  }

  function splitSegment(i, t) {
    const sg = S.segments[i];
    if (t < 0.08 || t > 0.92) { setStatus('分割点太靠端点'); return; }
    pushUndo();
    const pp = { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
    const s1 = { a: { ...sg.a }, b: { ...pp }, len: null, adj: sg.adj };
    const s2 = { a: { ...pp }, b: { ...sg.b }, len: null, adj: sg.adj };
    S.segments.splice(i, 1, s1, s2);
    S.selected = { kind: 'seg', idx: i };
    render(); refreshList(); setStatus('已分割');
  }

  // 把点吸附到已有横/竖线上（屏幕距离 <= tol）
  function snapToLines(ip) {
    let best = null;
    for (const sg of S.segments) {
      const ah = Math.abs(sg.a.y - sg.b.y) < Math.abs(sg.a.x - sg.b.x);
      let qx, qy;
      if (ah) {
        qx = Math.max(Math.min(sg.a.x, sg.b.x), Math.min(Math.max(sg.a.x, sg.b.x), ip.x));
        qy = sg.a.y;
      } else {
        qx = sg.a.x;
        qy = Math.max(Math.min(sg.a.y, sg.b.y), Math.min(Math.max(sg.a.y, sg.b.y), ip.y));
      }
      const a = i2s({ x: qx, y: qy });
      const d = Math.hypot(a.x - i2s(ip).x, a.y - i2s(ip).y);
      if (d <= 30 && (!best || d < best.d)) best = { d, p: { x: qx, y: qy } };
    }
    return best ? best.p : ip;
  }

  // 新线端点落到已有线上时，把已有线在该点断开（T 形接头）
  function splitAtPointInAll(ip) {
    const tol = 8;
    for (let i = 0; i < S.segments.length; i++) {
      const sg = S.segments[i];
      const ah = Math.abs(sg.a.y - sg.b.y) < Math.abs(sg.a.x - sg.b.x);
      if (ah) {
        const lo = Math.min(sg.a.x, sg.b.x), hi = Math.max(sg.a.x, sg.b.x);
        if (Math.abs(ip.y - sg.a.y) <= tol && lo + tol < ip.x && ip.x < hi - tol) {
          const mid = { x: ip.x, y: sg.a.y };
          S.segments[i] = { a: { ...sg.a }, b: { ...mid }, len: null, adj: sg.adj };
          S.segments.splice(i + 1, 0, { a: { ...mid }, b: { ...sg.b }, len: null, adj: sg.adj });
          i++;
        }
      } else {
        const lo = Math.min(sg.a.y, sg.b.y), hi = Math.max(sg.a.y, sg.b.y);
        if (Math.abs(ip.x - sg.a.x) <= tol && lo + tol < ip.y && ip.y < hi - tol) {
          const mid = { x: sg.a.x, y: ip.y };
          S.segments[i] = { a: { ...sg.a }, b: { ...mid }, len: null, adj: sg.adj };
          S.segments.splice(i + 1, 0, { a: { ...mid }, b: { ...sg.b }, len: null, adj: sg.adj });
          i++;
        }
      }
    }
  }

  function handleTap(pt) {
    const ip = s2i(pt);

    if (S.mode === 'crop') {
      if (!S.cropFirst) {
        S.cropFirst = ip;
        setStatus('框选范围：点对角第二个点');
        return;
      }
      const a = S.cropFirst; S.cropFirst = null;
      S.crop = {
        x0: Math.min(a.x, ip.x), y0: Math.min(a.y, ip.y),
        x1: Math.max(a.x, ip.x), y1: Math.max(a.y, ip.y),
      };
      setStatus('已框选范围（自动描线只识别框内）');
      render();
      return;
    }

    if (S.mode === 'draw') {
      if (!S.anchor) {
        S.anchor = ip;
        setStatus('手绘：继续点，相邻点自动连线');
        render();
        return;
      }
      pushUndo();
      S.segments.push({ a: S.anchor, b: ip, len: null, adj: '' });
      S.selected = { kind: 'seg', idx: S.segments.length - 1 };
      S.anchor = ip;
      setStatus('已加线段，可继续点下一点');
      render(); refreshList();
      return;
    }

    if (S.mode === 'note') {
      if (!S.pending) {
        S.pending = ip;
        setStatus('点注：点第二个点');
        render();
        return;
      }
      const first = S.pending;
      S.pending = null;
      const mid = { x: (first.x + ip.x) / 2, y: (first.y + ip.y) / 2 };
      const s = prompt('输入长度（米，可留空稍后填）');
      let v = null;
      if (s != null && s.trim() !== '') {
        const n = parseFloat(String(s).replace(/m/ig, ''));
        if (!isNaN(n)) v = n;
      }
      pushUndo();
      S.notes.push({ pos: mid, a: first, b: ip, len: v, adj: '' });
      S.selected = { kind: 'note', idx: S.notes.length - 1 };
      setStatus('已放数字，可点选后按徕卡测量');
      render(); refreshList();
      return;
    }

    if (S.mode === 'addline') {
      if (!S.addFrom) {
        S.addFrom = snapToLines(ip);
        setStatus('加线：起点已定，再点终点（自动吸附、横平竖直）');
        render();
        return;
      }
      const a = S.addFrom;
      const b = snapToLines(ip);
      S.addFrom = null;
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
      S.segments.push({ a: { ...seg.a }, b: { ...seg.b }, len: null, adj: '' });
      S.selected = { kind: 'seg', idx: S.segments.length - 1 };
      render(); refreshList();
      setStatus(`已加线并选中第 ${S.segments.length} 段，可直接测量`);
      return;
    }

    if (S.mode === 'split') {
      if (!S.selected || S.selected.kind !== 'seg') {
        setStatus('分割：先点选一条线段，再点分割位置');
        return;
      }
      const sg = S.segments[S.selected.idx];
      const ah = Math.abs(sg.a.y - sg.b.y) < Math.abs(sg.a.x - sg.b.x);
      let mid;
      if (ah) {
        mid = { x: Math.max(Math.min(sg.a.x, sg.b.x), Math.min(Math.max(sg.a.x, sg.b.x), ip.x)), y: sg.a.y };
      } else {
        mid = { x: sg.a.x, y: Math.max(Math.min(sg.a.y, sg.b.y), Math.min(Math.max(sg.a.y, sg.b.y), ip.y)) };
      }
      if (Math.hypot(mid.x - sg.a.x, mid.y - sg.a.y) < 4 ||
          Math.hypot(mid.x - sg.b.x, mid.y - sg.b.y) < 4) {
        setStatus('分割点太靠端点');
        return;
      }
      pushUndo();
      const idx = S.selected.idx;
      S.segments[idx] = { a: { ...sg.a }, b: { ...mid }, len: null, adj: sg.adj };
      S.segments.splice(idx + 1, 0, { a: { ...mid }, b: { ...sg.b }, len: null, adj: sg.adj });
      S.selected = { kind: 'seg', idx: idx + 1 };
      render(); refreshList();
      setStatus('已切成两段，分别选中测量');
      return;
    }

    // 点选
    const hit = hitSegment(pt);
    if (hit) {
      S.selected = { kind: 'seg', idx: hit.idx };
      setStatus(`已选第 ${hit.idx + 1} 段，按徕卡测量绑定`);
      render(); refreshList(); return;
    }
    const ni = hitNote(pt);
    if (ni != null) {
      S.selected = { kind: 'note', idx: ni };
      setStatus(`已选注记第 ${ni + 1} 条`);
      render(); refreshList(); return;
    }
    S.selected = null;
    render(); refreshList();
  }

  // ---------- 画布触摸/鼠标交互 ----------
  function canvasPoint(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const pt = canvasPoint(e);
    S.pointers.set(e.pointerId, pt);
    S.moved = false;
    S.downPt = pt;
    if (S.pointers.size === 2) {
      const pts = [...S.pointers.values()];
      S.pinch = {
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
    }
    if (S.mode === 'crop' && S.img && S.pointers.size === 1) {
      S.cropDragStart = s2i(pt);
      S.cropDragCur = { ...S.cropDragStart };
      render();
    }
  });

  cv.addEventListener('pointermove', (e) => {
    if (!S.pointers.has(e.pointerId) || !S.img) return;
    const prev = S.pointers.get(e.pointerId);
    const now = canvasPoint(e);
    S.pointers.set(e.pointerId, now);
    if (S.pointers.size === 2 && S.pinch) {
      const pts = [...S.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      S.view.tx += mid.x - S.pinch.mid.x;
      S.view.ty += mid.y - S.pinch.mid.y;
      if (S.pinch.d > 10) zoomAt(mid, d / S.pinch.d);
      S.pinch.d = d; S.pinch.mid = mid;
      S.moved = true;
      return;
    }
    if (S.mode === 'crop' && S.cropDragStart) {
      S.cropDragCur = s2i(now);
      render();
      return;
    }
    const dx = now.x - prev.x, dy = now.y - prev.y;
    const movedFromDown = Math.hypot(now.x - (S.downPt ? S.downPt.x : now.x),
                                     now.y - (S.downPt ? S.downPt.y : now.y));
    if (movedFromDown > 10) {
      S.view.tx += dx; S.view.ty += dy;
      S.moved = true;
      render();
    }
  });

  cv.addEventListener('pointerup', (e) => {
    const pt = S.pointers.get(e.pointerId);
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinch = null;
    if (S.mode === 'crop' && S.cropDragStart) {
      const a = S.cropDragStart, b = S.cropDragCur || a;
      const dist = Math.hypot((i2s(a).x - i2s(b).x), (i2s(a).y - i2s(b).y));
      S.cropDragStart = null;
      S.cropDragCur = null;
      if (dist > 20) {
        S.crop = {
          x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
          x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
        };
        setStatus('已框选范围（自动描线只识别框内）');
        render();
        return;
      }
      render();
    }
    if (pt && !S.moved && S.img) handleTap(pt);
  });

  cv.addEventListener('pointercancel', (e) => {
    S.pointers.delete(e.pointerId);
    S.pinch = null;
  });

  function closeLoop() {
    if (S.segments.length < 2) { setStatus('线段太少'); return; }
    const key = p => `${Math.round(p.x / 6)},${Math.round(p.y / 6)}`;
    const deg = new Map();
    S.segments.forEach(sg => {
      [sg.a, sg.b].forEach(p => {
        const k = key(p);
        deg.set(k, (deg.get(k) || 0) + 1);
      });
    });
    const ends = [];
    S.segments.forEach(sg => {
      [sg.a, sg.b].forEach(p => { if (deg.get(key(p)) === 1) ends.push(p); });
    });
    if (ends.length < 2) { setStatus('没有可闭合的开口端点'); return; }
    // 只连接距离最近的一对端点（小缺口优先）
    let best = null;
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const d = Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    pushUndo();
    S.segments.push({
      a: { ...ends[best.i] }, b: { ...ends[best.j] }, len: null, adj: '',
    });
    S.selected = { kind: 'seg', idx: S.segments.length - 1 };
    render(); refreshList();
    setStatus(`已闭合最近的缺口（${best.d.toFixed(0)} 像素），可再点一次继续闭合`);
  }

  // ---------- 蓝牙 ----------
  async function connectBle() {
    if (!navigator.bluetooth) {
      alert('当前浏览器不支持 Web Bluetooth。\n请用安卓 Chrome/Edge，并通过 https 打开本页。');
      return;
    }
    try {
      setBle('搜索设备…');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [BLE_SERVICE] }],
        optionalServices: [BLE_SERVICE],
      });
      S.bleDevice = device;
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(BLE_SERVICE);
      const chars = await svc.getCharacteristics();
      let subs = 0;
      const onPacket = (ev) => {
        const dv = ev.target.value;
        try {
          const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
          const hex = Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(' ');
          const dist = dv.byteLength >= 4 ? dv.getFloat32(0, true) : NaN;
          const cuuid = (ev.target.uuid || '').slice(4, 8);
          window.__lastBlePacket = { hex, dist, bytes: dv.byteLength, uuid: cuuid };
          if (isFinite(dist) && dist > 0.001 && dist < 10000) {
            onMeasure(dist);
            setStatus(`收到 ${dist.toFixed(4)} m`);
          } else {
            window.__lastZero = { cuuid, hex, bytes: dv.byteLength };
          }
        } catch (err) {
          setStatus('蓝牙数据解析失败: ' + err.message);
        }
      };
      for (const ch of chars) {
        try {
          if (!ch.properties || !(ch.properties.notify || ch.properties.indicate)) continue;
          ch.addEventListener('characteristicvaluechanged', onPacket);
          await ch.startNotifications();
          subs++;
        } catch (e) { /* 某个通道不支持就跳过 */ }
      }
      window.__bleChars = chars.map(c => ({ uuid: c.uuid.slice(4, 8), props: c.properties }));
      setStatus(`已订阅 ${subs} 个通知通道`);
      if (!subs) {
        // 兜底：至少订阅测量通道
        const ch = await svc.getCharacteristic(BLE_MEASURE);
        ch.addEventListener('characteristicvaluechanged', onPacket);
        await ch.startNotifications();
        subs = 1;
      }
      setBle('徕卡已连接', true);
      window.__bleInfo = chars.map(c => c.uuid.slice(4, 8) + (c.properties && c.properties.notify ? 'N' : '') + (c.properties && c.properties.read ? 'R' : '') + (c.properties && c.properties.write ? 'W' : '')).join(',');
      setStatus('蓝牙已连接：选中线段/注记后按测距仪');
    } catch (e) {
      setBle('蓝牙未连接');
      alert('连接失败：' + (e.message || e));
    }
  }

  function onMeasure(v) {
    if (!isFinite(v)) return;
    const it = itemOf(S.selected);
    if (!it) { setStatus(`收到 ${v.toFixed(4)} m（未选中）`); return; }
    it.len = v;
    render(); refreshList();
    setStatus(`收到 ${v.toFixed(4)} m`);
  }

  // ---------- 导出 ----------
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function exportCsv() {
    if (!S.segments.length && !S.notes.length) { alert('还没有数据'); return; }
    const rows = [['序号', '类型', '长度(m)', '修正', '修正后长度(m)', '墙厚(mm)', '起点x', '起点y', '终点x', '终点y', '照片']];
    S.segments.forEach((sg, i) => {
      const corr = sg.len == null ? '' : corrected(sg).toFixed(4);
      rows.push([i + 1, '段', sg.len == null ? '' : sg.len.toFixed(4), sg.adj || '',
        corr, $('thick').value, sg.a.x.toFixed(1), sg.a.y.toFixed(1), sg.b.x.toFixed(1), sg.b.y.toFixed(1),
        sg.photo ? '有' : '']);
    });
    S.notes.forEach((nt, i) => {
      rows.push(['点' + (i + 1), '点注', nt.len == null ? '' : nt.len.toFixed(4), nt.adj || '',
        '', $('thick').value, nt.pos.x.toFixed(1), nt.pos.y.toFixed(1), '', '', nt.photo ? '有' : '']);
    });
    const csv = '\ufeff' + rows.map(r => r.join(',')).join('\n');
    download('测量数据.csv', new Blob([csv], { type: 'text/csv' }));
  }

  function exportPdf() {
    if (!S.segments.length && !S.notes.length) { alert('还没有数据'); return; }
    const { jsPDF } = window.jspdf;
    const pts = [];
    S.segments.forEach(sg => { pts.push(sg.a, sg.b); });
    S.notes.forEach(nt => {
      pts.push(nt.pos); if (nt.a) pts.push(nt.a); if (nt.b) pts.push(nt.b);
    });
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minx = Math.min(...xs), maxx = Math.max(...xs);
    const miny = Math.min(...ys), maxy = Math.max(...ys);
    const spanx = Math.max(1, maxx - minx), spany = Math.max(1, maxy - miny);
    const W = 842, H = 595, margin = 42;
    const s = Math.min((W - 2 * margin) / spanx, (H - 2 * margin - 30) / spany);
    const ox = (W - spanx * s) / 2, oy = 90;
    const mp = p => ({ x: ox + (p.x - minx) * s, y: H - oy - (p.y - miny) * s });

    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Sketch', 30, 30);

    const placed = [];
    function putText(txt, cx, cy, angleRad, fs) {
      const w = txt.length * fs * 0.58;
      const x0 = cx - w / 2, y0 = cy - 5, x1 = cx + w / 2, y1 = cy + 5;
      for (const r of placed) {
        if (!(x1 < r[0] || x0 > r[2] || y1 < r[1] || y0 > r[3])) return null;
      }
      placed.push([x0, y0, x1, y1]);
      const deg = -angleRad * 180 / Math.PI;
      const sx = cx - Math.cos(angleRad) * w / 2;
      const sy = cy + Math.sin(angleRad) * w / 2;
      doc.setFontSize(fs);
      doc.text(txt, sx, sy, { angle: deg });
      return { cx, cy, w };
    }

    function arrow(p1, p2) {
      doc.setDrawColor(90, 90, 90);
      doc.setLineWidth(0.5);
      doc.line(p1.x, p1.y, p2.x, p2.y);
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const bx = p2.x - Math.cos(ang) * 6, by = p2.y - Math.sin(ang) * 6;
      doc.line(bx - Math.sin(ang) * 2, by + Math.cos(ang) * 2, p2.x, p2.y);
      doc.line(bx + Math.sin(ang) * 2, by - Math.cos(ang) * 2, p2.x, p2.y);
    }

    function labelAlong(txt, pa, pb, fs) {
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      let nx = -uy, ny = ux;
      if (ny > 0) { nx = -nx; ny = -ny; }
      if (Math.abs(ny) < 0.25) { nx = -1; ny = 0; }
      const rad = Math.atan2(uy, ux);
      const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      for (const dist of [10, 16, 22, 30]) {
        for (const side of [1, -1]) {
          const cx = mx + nx * dist * side, cy = my + ny * dist * side;
          const res = putText(txt, cx, cy, rad, fs);
          if (!res) continue;
          const w = res.w;
          const sa = { x: cx - ux * (w / 2 + 2), y: cy - uy * (w / 2 + 2) };
          const sb = { x: cx + ux * (w / 2 + 2), y: cy + uy * (w / 2 + 2) };
          const ea = { x: pa.x + nx * dist * side, y: pa.y + ny * dist * side };
          const eb = { x: pb.x + nx * dist * side, y: pb.y + ny * dist * side };
          if (side < 0) { arrow(sa, eb); arrow(sb, ea); }
          else { arrow(sa, ea); arrow(sb, eb); }
          return;
        }
      }
      putText(txt, mx + nx * 16, my + ny * 16, rad, fs);
    }

    doc.setDrawColor(0, 0, 0);
    S.segments.forEach(sg => {
      const a = mp(sg.a), b = mp(sg.b);
      doc.setLineWidth(0.9);
      doc.line(a.x, a.y, b.x, b.y);
    });

    S.segments.forEach(sg => {
      if (sg.len == null) return;
      labelAlong(sg.len.toFixed(3), mp(sg.a), mp(sg.b), 7.5);
    });

    S.notes.forEach(nt => {
      let txt = nt.len == null ? '?' : nt.len.toFixed(3);
      if (nt.adj) txt = `${nt.adj[0]} ${txt} ${nt.adj[1] || ' '}`;
      if (nt.a && nt.b) labelAlong(txt, mp(nt.a), mp(nt.b), 8.5);
      else putText(txt, mp(nt.pos).x, mp(nt.pos).y - 12, 0, 8.5);
    });

    doc.save('手稿电子版.pdf');
  }

  // ---------- 事件绑定 ----------
  $('btnOpen').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) openFile(f); e.target.value = ''; };
  $('btnFit').onclick = () => fitView();
  $('btnRot').onclick = () => { S.view.rot = (S.view.rot + 90) % 360; render(); };
  $('btnTrace').onclick = () => autoTrace(false);
  $('btnCropTrace').onclick = () => {
    if (!S.crop) { setStatus('先点「框选范围」框住要识别的区域'); return; }
    autoTrace(true);
  };
  $('btnInterior').onclick = interiorRecognize;
  $('btnInteriorUndo').onclick = () => {
    if (S.interiorStart == null && !S.interior) { setStatus('当前没有内部识别结果'); return; }
    if (S.interiorStart != null) {
      S.segments.splice(S.interiorStart);
      S.interiorStart = null;
    }
    S.interior = null;
    S.selected = null;
    render(); refreshList();
    setStatus('已撤回内部识别，只保留外框');
  };
  $('btnOutline').onclick = interiorToSegments;
  $('btnClose').onclick = closeLoop;
  $('btnUndo').onclick = undo;
  $('btnBle').onclick = connectBle;
  $('btnBleOff').onclick = () => {
    if (window.__blePoll) { clearInterval(window.__blePoll); window.__blePoll = null; }
    try { if (S.bleDevice) S.bleDevice.gatt.disconnect(); } catch (e) {}
    S.bleChar = null; S.bleDevice = null;
    setBle('蓝牙未连接'); setStatus('蓝牙已断开');
  };
  $('btnZoomIn').onclick = () => {
    if (!S.img) return;
    const r = cv.getBoundingClientRect();
    zoomAt({ x: r.width / 2, y: r.height / 2 }, 1.25);
  };
  $('btnZoomOut').onclick = () => {
    if (!S.img) return;
    const r = cv.getBoundingClientRect();
    zoomAt({ x: r.width / 2, y: r.height / 2 }, 0.8);
  };
  $('btnCropClear').onclick = () => { S.crop = null; setStatus('已清除框选'); render(); };
  $('btnInputLen').onclick = () => {
    const it = itemOf(S.selected);
    if (!it) { setStatus('先选中一条'); return; }
    const s = prompt('输入长度（米）', it.len == null ? '' : String(it.len));
    if (s == null) return;
    const v = parseFloat(String(s).replace(/m/ig, ''));
    if (isNaN(v)) { setStatus('长度无效'); return; }
    pushUndo();
    it.len = v;
    render(); refreshList(); setStatus('已输入长度');
  };
  $('btnClearAll').onclick = () => {
    if (!S.segments.length && !S.notes.length) return;
    if (!confirm('清空所有线段和注记？')) return;
    pushUndo();
    S.segments = []; S.notes = []; S.selected = null; S.anchor = null; S.crop = null;
    render(); refreshList(); setStatus('已清空');
  };
  $('btnPhoto').onclick = () => {
    if (!S.selected) { setStatus('先选中一条再拍照'); return; }
    $('photoInput').click();
  };
  $('btnPickPhoto').onclick = () => {
    if (!S.selected) { setStatus('先选中一条再选图片'); return; }
    $('photoInput').click();
  };
  $('photoInput').onchange = (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const it = itemOf(S.selected);
    if (!it) return;
    const rd = new FileReader();
    rd.onload = () => {
      it.photo = rd.result;
      it.photoName = f.name;
      refreshList(); setStatus('已关联照片：' + f.name);
    };
    rd.readAsDataURL(f);
  };
  $('btnViewPhoto').onclick = () => {
    const it = itemOf(S.selected);
    if (!it || !it.photo) { setStatus('该条没有照片'); return; }
    const w = window.open('');
    w.document.write('<title>照片</title><img style="max-width:100%" src="' + it.photo + '">');
  };

  document.querySelectorAll('#toolbar [data-mode]').forEach(btn => {
    btn.onclick = () => {
      S.mode = btn.dataset.mode;
      S.pending = null;
      document.querySelectorAll('#toolbar [data-mode]').forEach(b => b.classList.toggle('active', b === btn));
      S.pending = null;
      if (S.mode !== 'draw') S.anchor = null;
      setStatus({
        draw: '手绘：连续点，相邻点自动连线',
        select: '点选：点线或数字选中',
        addline: '加线：点线段上一点，把线分成两段',
        split: '分割：点要分割的线',
        note: '点注：点两个点，数字放中间',
        crop: '框选范围：点第一个角，再点对角',
      }[S.mode]);
      render();
    };
  });

  $('btnDelete').onclick = () => {
    if (!S.selected) { setStatus('先选中一条'); return; }
    pushUndo();
    if (S.selected.kind === 'seg') S.segments.splice(S.selected.idx, 1);
    else S.notes.splice(S.selected.idx, 1);
    S.selected = null;
    render(); refreshList(); setStatus('已删除');
  };

  $('btnApplyAdj').onclick = () => {
    const it = itemOf(S.selected);
    if (!it) { setStatus('先选中一条'); return; }
    it.adj = $('adj').value;
    render(); refreshList();
    setStatus('已设置属性 ' + (it.adj || '无'));
  };

  $('btnCsv').onclick = exportCsv;
  $('btnPdf').onclick = exportPdf;

  $('btnPanel').onclick = () => {
    const p = $('panel');
    p.classList.toggle('collapsed');
    $('btnPanel').textContent = p.classList.contains('collapsed') ? '展开' : '收起';
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
          S.img = off;
          fitView();
          autoTrace(false);
          resolve({ segments: S.segments.length, crop: S.crop });
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
        setStatus('STATS ' + JSON.stringify(st));
        document.title = 'AUTOTEST_OK ' + JSON.stringify(st);
      }).catch(e => { document.title = 'AUTOTEST_FAIL ' + e.message; });
    }, 300);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  refreshList();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
