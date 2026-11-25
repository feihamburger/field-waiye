/* 导出：CSV / PDF 手稿（依赖通过 hooks 注入） */
(function () {
  let hooks = null;
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function exportCsv() {
  const S = hooks.getState();
  if (!S.segments.length && !S.notes.length) { alert('还没有数据'); return; }
  const rows = [['序号', '类型', '长度(m)', '修正', '修正后长度(m)', '墙厚(cm)', '起点x', '起点y', '终点x', '终点y', '照片']];
  S.segments.forEach((sg, i) => {
    const corr = sg.len == null ? '' : hooks.corrected(sg).toFixed(4);
    rows.push([i + 1, '段', sg.len == null ? '' : sg.len.toFixed(4), sg.adj || '',
      corr, (sg.thickCm != null ? sg.thickCm : hooks.thickValue()), sg.a.x.toFixed(1), sg.a.y.toFixed(1), sg.b.x.toFixed(1), sg.b.y.toFixed(1),
      sg.photo ? '有' : '']);
  });
  S.notes.forEach((nt, i) => {
    rows.push(['点' + (i + 1), '点注', nt.len == null ? '' : nt.len.toFixed(4), nt.adj || '',
      '', hooks.thickValue(), nt.pos.x.toFixed(1), nt.pos.y.toFixed(1), '', '', nt.photo ? '有' : '']);
  });
  const csv = '\ufeff' + rows.map(r => r.join(',')).join('\n');
  download('测量数据.csv', new Blob([csv], { type: 'text/csv' }));
}

function exportPdf() {
  const S = hooks.getState();
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
    let rad = Math.atan2(uy, ux);
    if (rad > Math.PI / 2) rad -= Math.PI;
    else if (rad < -Math.PI / 2) rad += Math.PI;
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
    const txt = sg.adj ? `${sg.len.toFixed(3)} ${sg.adj}` : sg.len.toFixed(3);
    labelAlong(txt, mp(sg.a), mp(sg.b), 7.5);
  });

  S.notes.forEach(nt => {
    let txt = nt.len == null ? '?' : nt.len.toFixed(3);
    if (nt.adj) txt = `${nt.adj[0]} ${txt} ${nt.adj[1] || ' '}`;
    if (nt.a && nt.b) labelAlong(txt, mp(nt.a), mp(nt.b), 8.5);
    else putText(txt, mp(nt.pos).x, mp(nt.pos).y - 12, 0, 8.5);
  });

  try {
   const S2 = hooks.getState();
   if (S2.sizhi && S2.segments.length) {
     let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
     S2.segments.filter(sg => !sg.sizhiDim).forEach(sg => {
       [sg.a, sg.b].forEach(p => {
         minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
         miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
       });
     });
     const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
     const near = 150, far = 260, tick = 18;
     const line = (x1, y1, x2, y2) => { const a2 = mp({ x: x1, y: y1 }), b2 = mp({ x: x2, y: y2 }); doc.line(a2.x, a2.y, b2.x, b2.y); };
     const txtAt = (txt, x, y) => { const q = mp({ x, y }); doc.text(txt, q.x, q.y, { align: 'center' }); };
     doc.setDrawColor(141, 110, 99); doc.setTextColor(109, 76, 65); doc.setFontSize(10);
     const geoms = {
       up:    { y: miny - far, x1: minx, x2: maxx, horiz: true, tx: cx, ty: miny - near, dx: cx, dy: miny - far - 16, sign: -1 },
       down:  { y: maxy + far, x1: minx, x2: maxx, horiz: true, tx: cx, ty: maxy + near, dx: cx, dy: maxy + far + 16, sign: 1 },
       right: { x: maxx + far, y1: miny, y2: maxy, horiz: false, tx: maxx + near, ty: cy, dx: maxx + far + 22, dy: cy, sign: 1 },
       left:  { x: minx - far, y1: miny, y2: maxy, horiz: false, tx: minx - near, ty: cy, dx: minx - far - 22, dy: cy, sign: -1 },
     };
     ['up', 'right', 'down', 'left'].forEach(side => {
       const it = S2.sizhi[side];
       if (!it) return;
       const g2 = geoms[side];
       if (it.adj && it.adj.on) {
         if (g2.horiz) {
           line(g2.x1, g2.y, g2.x2, g2.y);
           line(g2.x1, g2.y, g2.x1, g2.y + g2.sign * tick);
           line(g2.x2, g2.y, g2.x2, g2.y + g2.sign * tick);
         } else {
           line(g2.x, g2.y1, g2.x, g2.y2);
           line(g2.x, g2.y1, g2.x + g2.sign * tick, g2.y1);
           line(g2.x, g2.y2, g2.x + g2.sign * tick, g2.y2);
         }
         if (it.adj.door) txtAt('#' + it.adj.door, g2.dx, g2.dy);
       }
       txtAt(it.text || '', g2.tx, g2.ty);
     });
   }
  } catch (e) {}
  try {
   const S2 = hooks.getState();
   (S2.doors || []).forEach(d => {
     const p2 = mp(d.pos);
     doc.setDrawColor(93, 64, 55); doc.setTextColor(93, 64, 55);
     doc.setFontSize(11);
     doc.text('#' + d.num, p2.x, p2.y - 6, { align: 'center' });
     doc.line(p2.x, p2.y, p2.x, p2.y - 2);
   });
  } catch (e) {}
  try {
   const S2 = hooks.getState();
   if (S2.signature) {
     const sw = 120, sh = 44;
     doc.addImage(S2.signature, 'PNG', W - 30 - sw, H - 24 - sh, sw, sh);
   }
 } catch (e) {}
 try {
   const S2 = hooks.getState();
   if (typeof S2.north === 'number') {
     const cx = 60, cy = H - 60, r = 16;
     const rad = -S2.north * Math.PI / 180;
     const pt = (vx, vy) => ({ x: cx + vx * Math.cos(rad) - vy * Math.sin(rad), y: cy + vx * Math.sin(rad) + vy * Math.cos(rad) });
     const tip = pt(0, -r), l = pt(-6, 6), m = pt(0, 2), rr = pt(6, 6);
     doc.setDrawColor(18, 58, 99); doc.setFillColor(18, 58, 99);
     doc.circle(cx, cy, r);
     doc.triangle(tip.x, tip.y, l.x, l.y, m.x, m.y, 'F');
     doc.triangle(tip.x, tip.y, rr.x, rr.y, m.x, m.y, 'F');
     doc.setFontSize(10); doc.setTextColor(18, 58, 99);
     doc.text('N', cx, cy + r + 10, { align: 'center' });
     doc.text('北向角 ' + S2.north.toFixed(1) + '°', cx, cy + r + 22, { align: 'center' });
   }
 } catch (e) {}
 doc.save('手稿电子版.pdf');
}

  window.EXP = {
    init(h) { hooks = h; },
    exportCsv,
    exportPdf,
  };
})();
