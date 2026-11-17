/* 竣工图矢量识别：用 pdf.js 的 getOperatorList 直接读 PDF 矢量绘制指令
   与电脑版 page.get_drawings() 等价，不经过像素渲染 */
(function () {
  'use strict';

  const OPS = window.pdfjsLib ? window.pdfjsLib.OPS : null;

  function mul(m1, m2) {
    // m = [a,b,c,d,e,f]，先应用 m2 再 m1
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  }

  function apply(m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  }

  function normColor(c) {
    if (!c || !c.length) return null;
    const mx = Math.max(...c);
    const k = mx <= 1.0001 ? 1 : 1 / 255;
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  function cmykToRgb(c, m, y, k) {
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }

  function q(c) {
    if (!c) return null;
    return c.map(v => Math.round(v * 10) / 10);
  }

  function eq(a, b) {
    a = q(a); b = q(b);
    if (!a || !b) return false;
    return Math.abs(a[0] - b[0]) <= 0.1 && Math.abs(a[1] - b[1]) <= 0.1 && Math.abs(a[2] - b[2]) <= 0.1;
  }

  function sameColor(a, b) { return eq(a, b); }

  async function parseDrawings(page) {
    const ol = await page.getOperatorList();
    const fns = ol.fnArray, args = ol.argsArray;
    const drawings = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let fill = null, stroke = null, lw = 1;
    let path = [];
    let start = null, cur = null;

    const commit = (mode) => {
      if (!path.length) return;
      drawings.push({ fill, stroke, lw, segs: path.slice() });
      path = [];
    };

    const opCodes = OPS || {};
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i], a = args[i];
      switch (fn) {
        case opCodes.save: stack.push(ctm.slice()); break;
        case opCodes.restore: ctm = stack.pop() || ctm; break;
        case opCodes.transform: ctm = mul(ctm, a); break;
        case opCodes.setLineWidth: lw = a[0]; break;
        case opCodes.setFillRGBColor: fill = normColor(a); break;
        case opCodes.setStrokeRGBColor: stroke = normColor(a); break;
        case opCodes.setFillGray: fill = [a[0], a[0], a[0]]; break;
        case opCodes.setStrokeGray: stroke = [a[0], a[0], a[0]]; break;
        case opCodes.setFillCMYKColor: fill = cmykToRgb(a[0], a[1], a[2], a[3]); break;
        case opCodes.setStrokeCMYKColor: stroke = cmykToRgb(a[0], a[1], a[2], a[3]); break;
        case opCodes.constructPath: {
          const codes = a[0], coords = a[1];
          let k = 0;
          for (const code of codes) {
            if (code === 0) { // moveTo
              const p = apply(ctm, coords[k], coords[k + 1]); k += 2;
              start = p; cur = p;
            } else if (code === 1) { // lineTo
              const p = apply(ctm, coords[k], coords[k + 1]); k += 2;
              if (cur) path.push([cur, p]);
              cur = p;
            } else if (code === 2) { // curveTo
              const p = apply(ctm, coords[k + 4], coords[k + 5]); k += 6;
              if (cur) path.push([cur, p]);
              cur = p;
            } else if (code === 3 || code === 4) { // curveTo2/3
              const p = apply(ctm, coords[k + 2], coords[k + 3]); k += 4;
              if (cur) path.push([cur, p]);
              cur = p;
            } else if (code === 5) { // closePath
              if (cur && start) path.push([cur, start]);
              cur = start;
            } else if (code === 13) { // rectangle
              const x = coords[k], y = coords[k + 1], w = coords[k + 2], h = coords[k + 3]; k += 4;
              const p1 = apply(ctm, x, y), p2 = apply(ctm, x + w, y), p3 = apply(ctm, x + w, y + h), p4 = apply(ctm, x, y + h);
              path.push([p1, p2], [p2, p3], [p3, p4], [p4, p1]);
              cur = p1; start = p1;
            }
          }
          break;
        }
        case opCodes.fill:
        case opCodes.eoFill:
        case opCodes.fillStroke:
        case opCodes.stroke:
        case opCodes.closeStroke:
        case opCodes.closeFillStroke: {
          const isStroke = fn === opCodes.stroke || fn === opCodes.closeStroke ||
                           fn === opCodes.fillStroke || fn === opCodes.closeFillStroke;
          commit(isStroke);
          break;
        }
        default: break;
      }
    }
    return drawings;
  }

  function rectOf(drawing) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [p, q] of drawing.segs) {
      for (const r of [p, q]) {
        minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
        miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
      }
    }
    if (!isFinite(minx)) return null;
    return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
  }

  function axisSegs(drawing, tol = 0.6) {
    const out = [];
    for (const [p, q] of drawing.segs) {
      const dx = Math.abs(q.x - p.x), dy = Math.abs(q.y - p.y);
      if (dx <= tol && dy > 0.3) out.push({ typ: 'V', a0: Math.min(p.y, q.y), a1: Math.max(p.y, q.y), c: (p.x + q.x) / 2 });
      else if (dy <= tol && dx > 0.3) out.push({ typ: 'H', a0: Math.min(p.x, q.x), a1: Math.max(p.x, q.x), c: (p.y + q.y) / 2 });
    }
    return out;
  }

  function collapseFaces(segs, tol = 12, overlap = 0.45) {
    const out = [];
    for (const s of segs.slice().sort((a, b) => a.c - b.c)) {
      let done = false;
      for (const o of out) {
        if (o.typ !== s.typ || Math.abs(o.c - s.c) > tol) continue;
        const lo = Math.max(o.a0, s.a0), hi = Math.min(o.a1, s.a1);
        if (hi - lo > overlap * Math.min(o.a1 - o.a0, s.a1 - s.a0)) {
          const l1 = Math.max(1, o.a1 - o.a0), l2 = Math.max(1, s.a1 - s.a0);
          o.c = (o.c * l1 + s.c * l2) / (l1 + l2);
          o.a0 = Math.min(o.a0, s.a0); o.a1 = Math.max(o.a1, s.a1);
          done = true; break;
        }
      }
      if (!done) out.push({ ...s });
    }
    return out;
  }

  function mergeCollinear(segs, ctol = 6, gap = 8) {
    const out = [];
    for (const s of segs.slice().sort((a, b) => a.c - b.c || a.a0 - b.a0)) {
      let done = false;
      for (const o of out) {
        if (o.typ !== s.typ || Math.abs(o.c - s.c) > ctol) continue;
        if (s.a0 <= o.a1 + gap && s.a1 >= o.a0 - gap) {
          o.a0 = Math.min(o.a0, s.a0); o.a1 = Math.max(o.a1, s.a1);
          done = true; break;
        }
      }
      if (!done) out.push({ ...s });
    }
    return out;
  }

  // 只保留紧贴填充（灰/蓝）的线：空地上的标注/引线剔除
  function buildFillMask(img) {
    if (!img) return null;
    const W = img.width, H = img.height;
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const g = cvs.getContext('2d');
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const r = data[i], gg = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const v = (r + gg + b) / 3, sat = mx - mn;
      if ((sat < 30 && v > 85 && v < 218) || (b > 150 && r < 120 && gg < 120)) mask[p] = 1;
    }
    return { mask, W, H };
  }

  function nearFill(fm, s, W, H) {
    if (!fm) return true;
    const { mask } = fm;
    const L = s.a1 - s.a0;
    const n = Math.max(4, Math.floor(L / 12));
    let hit = 0;
    for (let i = 0; i <= n; i++) {
      const t0 = s.a0 + L * i / n;
      const px = s.typ === 'H' ? t0 : s.c;
      const py = s.typ === 'H' ? s.c : t0;
      const x0 = Math.max(0, Math.floor(px) - 6), x1 = Math.min(W, Math.floor(px) + 7);
      const y0 = Math.max(0, Math.floor(py) - 6), y1 = Math.min(H, Math.floor(py) + 7);
      let any = false;
      for (let y = y0; y < y1 && !any; y++) {
        for (let x = x0; x < x1; x++) if (mask[y * W + x]) { any = true; break; }
      }
      if (any) hit++;
    }
    return hit / (n + 1) >= 0.3;
  }

  // 主入口：page 为 pdf.js page，vp 为渲染视口（用于换算像素坐标）
  async function recognizeVector(page, vp, crop) {
    const drawings = await parseDrawings(page);
    const scale = vp.scale;
    const toPx = (p) => {
      const q = vp.convertToViewportPoint(p.x, p.y);
      return { x: q[0], y: q[1] };
    };

    const walls = [];
    const cols = [];
    for (const d of drawings) {
      const rect = rectOf(d);
      if (!rect) continue;
      const pw = rect.w, ph = rect.h; // PDF 用户单位
      // 柱子：小方块（灰填充或洋红描边）
      if (pw >= 4 && pw <= 15 && ph >= 4 && ph <= 15 && pw / Math.max(0.1, ph) >= 0.55 && pw / Math.max(0.1, ph) <= 1.8) {
        const isGrayFill = sameColor(d.fill, [0.5, 0.5, 0.5]);
        const isGrayStroke = sameColor(d.stroke, [0.5, 0.5, 0.5]);
        const isMagenta = sameColor(d.stroke, [1, 0, 1]);
        if (isGrayFill || isGrayStroke || isMagenta) {
          const a = toPx({ x: rect.x, y: rect.y });
          cols.push({ x: a.x, y: a.y, w: pw * scale, h: ph * scale });
          continue;
        }
      }
      // 墙：洋红粗描边 / 深蓝描边 / 灰色长条填充
      const grayFill = sameColor(d.fill, [0.5, 0.5, 0.5]);
      const magentaStrokeOne = sameColor(d.stroke, [1, 0, 1]) && d.lw >= 0.8;
      const darkBlue = sameColor(d.stroke, [0, 0, 0.7]);
      const grayLong = grayFill && Math.max(pw, ph) > 30 && Math.min(pw, ph) <= 6;
      if (!(magentaStrokeOne || darkBlue || grayLong)) continue;
      for (const s of axisSegs(d)) {
        const p0 = toPx({ x: s.typ === 'H' ? s.a0 : s.c, y: s.typ === 'H' ? s.c : s.a0 });
        const p1 = toPx({ x: s.typ === 'H' ? s.a1 : s.c, y: s.typ === 'H' ? s.c : s.a1 });
        if (s.typ === 'H') walls.push({ typ: 'H', a0: Math.min(p0.x, p1.x), a1: Math.max(p0.x, p1.x), c: (p0.y + p1.y) / 2 });
        else walls.push({ typ: 'V', a0: Math.min(p0.y, p1.y), a1: Math.max(p0.y, p1.y), c: (p0.x + p1.x) / 2 });
      }
    }

    const fm = buildFillMask(window.WS.S.img);
    walls = walls.filter(s => nearFill(fm, s, window.WS.S.img.width, window.WS.S.img.height));
    let segs = collapseFaces(walls, 20, 0.45);
    segs = mergeCollinear(segs);
    segs = segs.filter(s => (s.a1 - s.a0) >= 10);

    let columns = cols;
    if (crop) {
      segs = segs.filter(s => {
        const mx = s.typ === 'H' ? (s.a0 + s.a1) / 2 : s.c;
        const my = s.typ === 'H' ? s.c : (s.a0 + s.a1) / 2;
        return mx >= crop.x0 && mx <= crop.x1 && my >= crop.y0 && my <= crop.y1;
      });
      columns = columns.filter(b => b.x >= crop.x0 - 20 && b.x <= crop.x1 && b.y >= crop.y0 - 20 && b.y <= crop.y1);
    }

    return {
      segs: segs.map(s => s.typ === 'H'
        ? { a: { x: s.a0, y: s.c }, b: { x: s.a1, y: s.c }, len: null, adj: '' }
        : { a: { x: s.c, y: s.a0 }, b: { x: s.c, y: s.a1 }, len: null, adj: '' }),
      cols: columns,
      drawings: drawings.length,
    };
  }

  window.JGV = { recognizeVector };
})();
