/* 竣工图识别：灰填充剪力墙中线 + 黄色墙线 + 黑色粗外框 + 柱子标记
   纯图像算法（对扫描件/栅格 PDF 都适用） */
(function () {
  'use strict';

  function colorMasks(data, W, H) {
    const grayFill = new Uint8Array(W * H);
    const yellow = new Uint8Array(W * H);
    const black = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const v = (r + g + b) / 3;
      const sat = mx - mn;
      if (sat < 30 && v > 95 && v < 220) grayFill[p] = 1;      // 灰色填充
      if (r > 170 && g > 170 && b < 130) yellow[p] = 1;         // 黄色墙线
      if (v < 70) black[p] = 1;                                  // 黑色粗线
    }
    return { grayFill, yellow, black };
  }

  // 从二值掩码提取横/竖长条：厚度 <= maxThick，长度 >= minLen
  function runsFromMask(mask, W, H, minLen, maxThick) {
    const out = [];
    // 横向
    for (let y = 0; y < H; y++) {
      let s = -1;
      for (let x = 0; x <= W; x++) {
        const on = x < W && mask[y * W + x];
        if (on) { if (s < 0) s = x; }
        else if (s >= 0) {
          const len = x - s;
          if (len >= minLen) {
            // 厚度：检查该段上下各 1..maxThick
            let th = 1;
            while (th < maxThick && y + th < H) {
              let any = false;
              for (let xx = s; xx < x; xx += 2) if (mask[(y + th) * W + xx]) { any = true; break; }
              if (!any) break;
              th++;
            }
            if (th <= maxThick) out.push({ typ: 'H', a0: s, a1: x, c: y + (th - 1) / 2, th });
          }
          s = -1;
        }
      }
    }
    // 竖向
    for (let x = 0; x < W; x++) {
      let s = -1;
      for (let y = 0; y <= H; y++) {
        const on = y < H && mask[y * W + x];
        if (on) { if (s < 0) s = y; }
        else if (s >= 0) {
          const len = y - s;
          if (len >= minLen) {
            let th = 1;
            while (th < maxThick && x + th < W) {
              let any = false;
              for (let yy = s; yy < y; yy += 2) if (mask[yy * W + x + th]) { any = true; break; }
              if (any) break;
              th++;
            }
            if (th <= maxThick) out.push({ typ: 'V', a0: s, a1: y, c: x + (th - 1) / 2, th });
          }
          s = -1;
        }
      }
    }
    return out;
  }

  // 平行重复线合并成一条中线（tol 像素，重叠比例）
  function collapseFaces(segs, tol = 14, overlap = 0.45) {
    const out = [];
    const sorted = segs.slice().sort((a, b) => a.c - b.c);
    for (const s of sorted) {
      let done = false;
      for (const o of out) {
        if (o.typ !== s.typ) continue;
        if (Math.abs(o.c - s.c) > tol) continue;
        const lo = Math.max(o.a0, s.a0), hi = Math.min(o.a1, s.a1);
        const ov = hi - lo;
        const shorter = Math.min(o.a1 - o.a0, s.a1 - s.a0);
        if (shorter > 0 && ov > overlap * shorter) {
          const l1 = Math.max(1, o.a1 - o.a0), l2 = Math.max(1, s.a1 - s.a0);
          o.c = (o.c * l1 + s.c * l2) / (l1 + l2);
          o.a0 = Math.min(o.a0, s.a0);
          o.a1 = Math.max(o.a1, s.a1);
          done = true;
          break;
        }
      }
      if (!done) out.push({ ...s });
    }
    return out;
  }

  function mergeCollinear(segs, ctol = 8, gap = 10) {
    const sorted = segs.slice().sort((a, b) => a.c - b.c || a.a0 - b.a0);
    const out = [];
    for (const s of sorted) {
      let done = false;
      for (const o of out) {
        if (o.typ !== s.typ || Math.abs(o.c - s.c) > ctol) continue;
        if (s.a0 <= o.a1 + gap && s.a1 >= o.a0 - gap) {
          o.a0 = Math.min(o.a0, s.a0);
          o.a1 = Math.max(o.a1, s.a1);
          done = true;
          break;
        }
      }
      if (!done) out.push({ ...s });
    }
    return out;
  }

  // 灰色小方块 → 柱子
  function findColumns(mask, W, H) {
    const seen = new Uint8Array(W * H);
    const boxes = [];
    const stack = [];
    for (let i = 0; i < W * H; i++) {
      if (!mask[i] || seen[i]) continue;
      stack.length = 0; stack.push(i); seen[i] = 1;
      let minX = W, minY = H, maxX = 0, maxY = 0, cnt = 0;
      while (stack.length) {
        const q = stack.pop(), qx = q % W, qy = (q / W) | 0;
        cnt++;
        if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
        const nb = [q - 1, q + 1, q - W, q + W];
        for (const n of nb) {
          if (n < 0 || n >= W * H) continue;
          if ((n === q - 1 && qx === 0) || (n === q + 1 && qx === W - 1)) continue;
          if (!seen[n] && mask[n]) { seen[n] = 1; stack.push(n); }
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (bw >= 5 && bw <= 26 && bh >= 5 && bh <= 26) {
        const ratio = bw / Math.max(1, bh);
        if (ratio >= 0.45 && ratio <= 2.2 && cnt > 0.5 * bw * bh) {
          boxes.push({ x: minX, y: minY, w: bw, h: bh });
        }
      }
    }
    return boxes;
  }

  function recognize(useCrop) {
    const S = window.WS.S;
    if (!S.img) { window.WS.setStatus('先打开图纸'); return; }
    const W = S.img.width, H = S.img.height;
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const cx = cvs.getContext('2d');
    cx.drawImage(S.img, 0, 0);
    const data = cx.getImageData(0, 0, W, H).data;
    const { grayFill, yellow, black } = colorMasks(data, W, H);

    let segs = [];
    // 灰色填充：长条中线（厚 2..12px）
    segs = segs.concat(runsFromMask(grayFill, W, H, 30, 12));
    // 黄色线
    segs = segs.concat(runsFromMask(yellow, W, H, 18, 8));
    // 黑色：只取粗线（厚>=2）或长线
    const blacks = runsFromMask(black, W, H, 120, 8);
    segs = segs.concat(blacks.filter(s => s.th >= 2 || (s.a1 - s.a0) >= 120));

    segs = collapseFaces(segs, 14, 0.45);
    segs = mergeCollinear(segs, 8, 10);
    segs = segs.filter(s => (s.a1 - s.a0) >= 25);

    let cols = findColumns(grayFill, W, H);

    // 框选过滤
    if (useCrop && S.crop) {
      const { x0, y0, x1, y1 } = S.crop;
      segs = segs.filter(s => {
        const mx = s.typ === 'H' ? (s.a0 + s.a1) / 2 : s.c;
        const my = s.typ === 'H' ? s.c : (s.a0 + s.a1) / 2;
        return mx >= x0 && mx <= x1 && my >= y0 && my <= y1;
      });
      cols = cols.filter(b => b.x >= x0 - 20 && b.x <= x1 && b.y >= y0 - 20 && b.y <= y1);
    }

    return {
      segs: segs.map(s => s.typ === 'H'
        ? { a: { x: s.a0, y: s.c }, b: { x: s.a1, y: s.c }, len: null, adj: '' }
        : { a: { x: s.c, y: s.a0 }, b: { x: s.c, y: s.a1 }, len: null, adj: '' }),
      cols,
    };
  }

  window.JG = { recognize };
})();
