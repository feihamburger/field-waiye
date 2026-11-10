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
    interior: null,      // 内部识别轮廓（图像坐标点数组）
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
  function autoTrace(useCrop) {
    if (!S.img) { setStatus('先打开图纸'); return; }
    const maxW = 1500;
    const k = Math.min(1, maxW / S.img.width);
    const w = Math.max(1, Math.round(S.img.width * k));
    const h = Math.max(1, Math.round(S.img.height * k));
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(S.img, 0, 0, w, h);
    const data = octx.getImageData(0, 0, w, h).data;
    const dark = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const v = Math.max(r, g, b);
      const sat = v - Math.min(r, g, b);
      if (v < 175 && !(sat > 90 && v > 120)) dark[p] = 1; // 深色且不太艳
    }

    const hLines = [];
    const minRun = 16;
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        if (!dark[y * w + x]) { x++; continue; }
        const x0 = x;
        while (x < w && dark[y * w + x]) x++;
        const x1 = x - 1;
        if (x1 - x0 + 1 >= minRun) {
          // 并入上一行的线
          let merged = false;
          for (let j = hLines.length - 1; j >= 0 && j >= hLines.length - 8; j--) {
            const L = hLines[j];
            if (L.lastY === y - 1) {
              const ov = Math.min(L.x1, x1) - Math.max(L.x0, x0);
              if (ov > 0.5 * Math.min(L.x1 - L.x0 + 1, x1 - x0 + 1)) {
                L.x0 = Math.min(L.x0, x0); L.x1 = Math.max(L.x1, x1);
                L.lastY = y; merged = true; break;
              }
            }
          }
          if (!merged) hLines.push({ x0, x1, y0: y, lastY: y });
        }
      }
    }

    const vLines = [];
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (!dark[y * w + x]) { y++; continue; }
        const y0 = y;
        while (y < h && dark[y * w + x]) y++;
        const y1 = y - 1;
        if (y1 - y0 + 1 >= minRun) {
          let merged = false;
          for (let j = vLines.length - 1; j >= 0 && j >= vLines.length - 8; j--) {
            const L = vLines[j];
            if (L.lastX === x - 1) {
              const ov = Math.min(L.y1, y1) - Math.max(L.y0, y0);
              if (ov > 0.5 * Math.min(L.y1 - L.y0 + 1, y1 - y0 + 1)) {
                L.y0 = Math.min(L.y0, y0); L.y1 = Math.max(L.y1, y1);
                L.lastX = x; merged = true; break;
              }
            }
          }
          if (!merged) vLines.push({ y0, y1, x0: x, lastX: x });
        }
      }
    }

    const scale = S.img.width / w;
    const segs = [];
    hLines.forEach(L => {
      if (L.x1 - L.x0 >= 20) {
        const y = ((L.y0 + L.lastY) / 2) * scale;
        segs.push({ a: { x: L.x0 * scale, y }, b: { x: L.x1 * scale, y }, len: null, adj: '' });
      }
    });
    vLines.forEach(L => {
      if (L.y1 - L.y0 >= 20) {
        const x = ((L.x0 + L.lastX) / 2) * scale;
        segs.push({ a: { x, y: L.y0 * scale }, b: { x, y: L.y1 * scale }, len: null, adj: '' });
      }
    });
    if (useCrop && S.crop) {
      const c = S.crop;
      const keep = segs.filter(s => {
        const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
        return mx >= Math.min(c.x0, c.x1) && mx <= Math.max(c.x0, c.x1)
            && my >= Math.min(c.y0, c.y1) && my <= Math.max(c.y0, c.y1);
      });
      segs.length = 0; Array.prototype.push.apply(segs, keep);
    }
    if (!segs.length) { setStatus('自动描线：没找到线条（检查框选范围）'); return; }
    pushUndo();
    S.segments = segs.slice(0, 600);
    S.notes = []; S.selected = null;
    S.mode = 'select';
    document.querySelectorAll('#toolbar [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === 'select'));
    render(); refreshList();
    setStatus(`自动描线完成：${S.segments.length} 条（横 ${hLines.length} / 竖 ${vLines.length}）`);
  }

  // ---------- 内部识别（白区泛洪 + 轮廓） ----------
  function interiorRecognize() {
    if (!S.img) { setStatus('先打开图纸'); return; }
    const c = S.crop;
    const maxW = 1200;
    const k = Math.min(1, maxW / S.img.width);
    const w = Math.max(1, Math.round(S.img.width * k));
    const h = Math.max(1, Math.round(S.img.height * k));
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(S.img, 0, 0, w, h);
    const data = octx.getImageData(0, 0, w, h).data;
    const dark = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const v = Math.max(data[i], data[i + 1], data[i + 2]);
      dark[p] = v < 175 ? 1 : 0;
    }
    let seed;
    if (c) {
      seed = { x: Math.round((c.x0 + c.x1) / 2 * k), y: Math.round((c.y0 + c.y1) / 2 * k) };
    } else {
      seed = { x: Math.round(w / 2), y: Math.round(h / 2) };
    }
    if (seed.x < 0 || seed.x >= w || seed.y < 0 || seed.y >= h) { setStatus('框选范围无效'); return; }
    // 若种子落在线上，向周围找一个白点
    if (dark[seed.y * w + seed.x]) {
      outer: for (let r = 1; r < 30; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            const x = seed.x + dx, y = seed.y + dy;
            if (x >= 0 && x < w && y >= 0 && y < h && !dark[y * w + x]) { seed = { x, y }; break outer; }
          }
        }
      }
    }
    const region = new Uint8Array(w * h);
    const stack = [seed];
    region[seed.y * w + seed.x] = 1;
    const maxPix = Math.round(w * h * 0.6);
    let cnt = 0;
    while (stack.length && cnt < maxPix) {
      const q = stack.pop();
      cnt++;
      const x = q.x, y = q.y;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const idx = ny * w + nx;
        if (region[idx] || dark[idx]) continue;
        region[idx] = 1;
        stack.push({ x: nx, y: ny });
      }
    }
    // 边界点
    const bpts = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!region[y * w + x]) continue;
        if (!region[(y - 1) * w + x] || !region[(y + 1) * w + x] ||
            !region[y * w + x - 1] || !region[y * w + x + 1]) {
          bpts.push({ x, y });
        }
      }
    }
    if (bpts.length < 30) { setStatus('内部识别：没有找到封闭内部区域'); return; }
    // 采样 + 简化：按角度贪心走一圈
    const step = Math.max(1, Math.floor(bpts.length / 400));
    const pts = bpts.filter((_, i) => i % step === 0);
    const ordered = [pts[0]];
    const used = new Set([0]);
    let cur = pts[0];
    for (let n = 1; n < Math.min(pts.length, 200); n++) {
      let bi = -1, bd = 1e9;
      pts.forEach((p, i) => {
        if (used.has(i)) return;
        const d = (p.x - cur.x) ** 2 + (p.y - cur.y) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      if (bi < 0 || bd > 60 * 60) break;
      used.add(bi); ordered.push(pts[bi]); cur = pts[bi];
    }
    if (ordered.length < 3) { setStatus('内部识别：轮廓提取失败'); return; }
    S.interior = ordered.map(p => ({ x: p.x / k, y: p.y / k }));
    setStatus(`内部识别完成：轮廓 ${S.interior.length} 个点，可用「画轮廓」变成线段`);
    render();
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

  function closeLoop() {
    if (S.segments.length < 2) { setStatus('线段太少'); return; }
    const key = p => `${Math.round(p.x / 3)},${Math.round(p.y / 3)}`;
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
    pushUndo();
    S.segments.push({ a: ends[0], b: ends[ends.length - 1], len: null, adj: '' });
    render(); refreshList(); setStatus('已闭合端到端');
  }

  // ---------- 交互 ----------
  function canvasPoint(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    S.pointers.set(e.pointerId, canvasPoint(e));
    S.moved = false;
    if (S.pointers.size === 2) {
      const pts = [...S.pointers.values()];
      S.pinch = {
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
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
    const dx = now.x - prev.x, dy = now.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) {
      S.view.tx += dx; S.view.ty += dy;
      S.moved = true;
      render();
    }
  });

  cv.addEventListener('pointerup', (e) => {
    const pt = S.pointers.get(e.pointerId);
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinch = null;
    if (pt && !S.moved && S.img) handleTap(pt);
  });
  cv.addEventListener('pointercancel', (e) => { S.pointers.delete(e.pointerId); S.pinch = null; });

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
        setStatus('手绘：继续点，相邻点自动连线；点「点选」或「清空」结束');
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
      {
        const mid = { x: (first.x + ip.x) / 2, y: (first.y + ip.y) / 2 };
        const s = prompt('输入长度（米，可留空稍后填）');
        let v = null;
        if (s != null && s.trim() !== '') {
          const n = parseFloat(s.replace(/m/ig, ''));
          if (!isNaN(n)) v = n;
        }
        pushUndo();
        S.notes.push({ pos: mid, a: first, b: ip, len: v, adj: '' });
        S.selected = { kind: 'note', idx: S.notes.length - 1 };
        setStatus('已放数字，可点选后按徕卡测量');
      }
      render(); refreshList();
      return;
    }
    if (S.mode === 'split' || S.mode === 'addline') {
      const hit = hitSegment(pt);
      if (!hit) { setStatus('分割：没点中线段'); return; }
      splitSegment(hit.idx, hit.t);
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
      if (r.d <= 14 && (!best || r.d < best.d)) best = { idx: i, d: r.d, t: r.t };
    });
    return best;
  }

  function hitNote(pt) {
    let best = null;
    S.notes.forEach((nt, i) => {
      const q = i2s(nt.pos);
      const d = Math.hypot(pt.x - q.x, pt.y - q.y);
      if (d <= 22 && (!best || d < best.d)) best = { idx: i, d };
    });
    return best ? best.idx : null;
  }

  function splitSegment(i, t) {
    const sg = S.segments[i];
    if (t < 0.08 || t > 0.92) { setStatus('分割点太靠端点'); return; }
    pushUndo();
    const p = { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t };
    const s1 = { a: { ...sg.a }, b: { ...p }, len: null, adj: sg.adj };
    const s2 = { a: { ...p }, b: { ...sg.b }, len: null, adj: sg.adj };
    S.segments.splice(i, 1, s1, s2);
    S.selected = { kind: 'seg', idx: i };
    S.anchor = null;
    render(); refreshList(); setStatus('已分割');
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
      const ch = await svc.getCharacteristic(BLE_MEASURE);
      S.bleChar = ch;
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (ev) => {
        const dv = ev.target.value;
        try {
          const dist = dv.getFloat32(0, true);
          onMeasure(dist);
        } catch (err) { /* ignore */ }
      });
      setBle('徕卡已连接', true);
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
  $('btnInteriorUndo').onclick = () => { S.interior = null; render(); setStatus('已撤回内部识别'); };
  $('btnOutline').onclick = interiorToSegments;
  $('btnClose').onclick = closeLoop;
  $('btnUndo').onclick = undo;
  $('btnBle').onclick = connectBle;
  $('btnBleOff').onclick = () => {
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

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  refreshList();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
