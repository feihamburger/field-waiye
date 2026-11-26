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

let cjkState = 0; // 0 未加载 1 加载中 2 就绪
function ensureCJK(cb) {
  if (window.CJK_FONT_B64) { cjkState = 2; return cb(); }
  if (cjkState === 1) { setTimeout(() => ensureCJK(cb), 80); return; }
  cjkState = 1;
  const s = document.createElement('script');
  s.src = 'lib/cjkfont.js?v=266';
  s.onload = () => { cjkState = 2; cb(); };
  s.onerror = () => { cjkState = 0; cb(); };
  document.head.appendChild(s);
}
function applyCJK(doc) {
  if (!window.CJK_FONT_B64) return;
  try {
    doc.addFileToVFS('cjk.ttf', window.CJK_FONT_B64);
    doc.addFont('cjk.ttf', 'cjk', 'normal');
    doc.setFont('cjk', 'normal');
  } catch (e) {}
}

function exportCsv() {
  const S = hooks.getState();
  if (!S.segments.length && !S.notes.length) { alert('还没有数据'); return; }
  const rows = [['序号', '类型', '长度(m)', '修正', '修正后长度(m)', '墙厚(cm)', '起点x', '起点y', '终点x', '终点y', '照片']];
  S.segments.forEach((sg, i) => {
    if (sg.neighborStair || sg.neighborWall) return;
    const corr = sg.len == null ? '' : hooks.corrected(sg).toFixed(4);
    rows.push([i + 1, '段', sg.len == null ? '' : sg.len.toFixed(4), sg.adj || '',
      corr, (sg.thickCm != null ? sg.thickCm : hooks.thickValue()), sg.a.x.toFixed(1), sg.a.y.toFixed(1), sg.b.x.toFixed(1), sg.b.y.toFixed(1),
      sg.photo ? '有' : '']);
  });
  S.notes.forEach((nt, i) => {
    rows.push(['点' + (i + 1), '点注', nt.len == null ? '' : nt.len.toFixed(4), nt.adj || '',
      '', hooks.thickValue(), nt.pos.x.toFixed(1), nt.pos.y.toFixed(1), '', '', nt.photo ? '有' : '']);
  });
  const hs = S.heights || {};
  if (hs[1] != null) rows.push(['', '层高', hs[1].toFixed(4), '', '', '', '', '', '', '', '']);
  if (hs[2] != null) rows.push(['', '层高(2层及以上)', hs[2].toFixed(4), '', '', '', '', '', '', '', '']);
  if (hs.roof != null) rows.push(['', '天面梯屋高度', hs.roof.toFixed(4), '', '', '', '', '', '', '', '']);
  const csv = '\ufeff' + rows.map(r => r.join(',')).join('\n');
  download('测量数据.csv', new Blob([csv], { type: 'text/csv' }));
}

function exportPhotoSheet(projectNo, items) { ensureCJK(() => _exportPhotoSheetNow(projectNo, items)); }
function _exportPhotoSheetNow(projectNo, items) {
  const jr = window.jspdf && window.jspdf.jsPDF;
  if (!jr) { alert('PDF 库未加载'); return; }
  const doc = new jr('p', 'mm', 'a4');
  applyCJK(doc);
  const W = 210;
  doc.setFontSize(14);
  doc.text('工程编号：' + (projectNo || ''), 15, 16);
  doc.setFontSize(18);
  doc.text('现场实景拍摄相片', W / 2, 28, { align: 'center' });
  // 3 列网格
  const cols = 3, cellW = 60, cellH = 42, gap = 4;
  const startX = (W - (cols * cellW + (cols - 1) * gap)) / 2;
  const startY = 38;
  (items || []).forEach((it, i) => {
    const name = it && it.name ? it.name : String(it);
    const url = it && it.url ? it.url : null;
    const r = Math.floor(i / cols), c = i % cols;
    const x = startX + c * (cellW + gap);
    const y = startY + r * (cellH + 14);
    doc.setDrawColor(144, 164, 174);
    if (url) {
      try {
        const props = doc.getImageProperties(url);
        const ratio = Math.min(cellW / props.width, cellH / props.height);
        const w = props.width * ratio, h = props.height * ratio;
        doc.addImage(url, 'JPEG', x + (cellW - w) / 2, y + (cellH - h) / 2, w, h);
      } catch (e) {
        doc.rect(x, y, cellW, cellH);
      }
    } else {
      doc.setLineDashPattern([2, 2], 0);
      doc.rect(x, y, cellW, cellH);
      doc.setLineDashPattern([], 0);
      doc.setFontSize(9); doc.setTextColor(150);
      doc.text('（待拍）', x + cellW / 2, y + cellH / 2, { align: 'center' });
    }
    doc.setFontSize(10); doc.setTextColor(18, 58, 99);
    doc.text(String(name), x + cellW / 2, y + cellH + 6, { align: 'center' });
  });
  const d = new Date();
  const ds = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  doc.setFontSize(10); doc.setTextColor(18, 58, 99);
  doc.text('拍摄日期：' + ds, W - 15, 285, { align: 'right' });
  doc.save('现场实景拍摄相片.pdf');
}

function exportPhotoSheetExcel(projectNo, items) {
  const ExcelJS = window.ExcelJS;
  if (!ExcelJS) { alert('ExcelJS 未加载'); return; }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('现场照片');
  ws.columns = [{ width: 30 }, { width: 30 }, { width: 30 }];
  ws.mergeCells('A1:C1');
  const a1 = ws.getCell('A1');
  a1.value = '工程编号：' + (projectNo || '');
  a1.font = { size: 12 };
  ws.mergeCells('A2:C2');
  const a2 = ws.getCell('A2');
  a2.value = '现场实景拍摄相片';
  a2.font = { size: 16, bold: true };
  a2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 28;
  const list = (items || []).filter(it => it && it.url);
  list.forEach((it, i) => {
    const col = i % 3;
    const group = Math.floor(i / 3);
    const imgRow = 4 + group * 4;      // 图片行
    const capRow = imgRow + 3;         // 说明行
    ws.getRow(imgRow).height = 70;
    ws.getRow(imgRow + 1).height = 70;
    ws.getRow(imgRow + 2).height = 20;
    ws.getRow(capRow).height = 20;
    // 图片锚点
    const imgId = wb.addImage({ base64: it.url, extension: 'jpeg' });
    const colLetter = ['A', 'B', 'C'][col];
    ws.addImage(imgId, {
      tl: { col: col, row: imgRow - 1 },
      ext: { width: 190, height: 135 },
    });
    const capCell = ws.getCell(colLetter + capRow);
    capCell.value = it.name || '';
    capCell.alignment = { horizontal: 'center' };
    capCell.font = { size: 11 };
    // 边框
    const top = ws.getCell(colLetter + imgRow);
    top.border = { top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    const mid = ws.getCell(colLetter + (imgRow + 1));
    mid.border = { left: { style: 'thin' }, right: { style: 'thin' } };
    const bot = ws.getCell(colLetter + (imgRow + 2));
    bot.border = { bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
  });
  const d = new Date();
  const ds = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  const rows = list.length ? (Math.floor((list.length - 1) / 3) + 1) * 4 + 5 : 6;
  ws.mergeCells('A' + rows + ':C' + rows);
  const dc = ws.getCell('A' + rows);
  dc.value = '拍摄日期：' + ds;
  dc.alignment = { horizontal: 'right' };
  dc.font = { size: 11 };
  return wb.xlsx.writeBuffer().then(buf => {
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    download('现场实景拍摄相片.xlsx', blob);
    return buf.byteLength;
  });
}

function exportPdf() { ensureCJK(() => _exportPdfNow()); }
function _exportPdfNow() {
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
  applyCJK(doc);
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
     S2.segments.filter(sg => !sg.sizhiDim && !sg.neighborWall && !sg.stair && !sg.balcony).forEach(sg => {
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
 const hh = S2.heights || {};
 const htxt = [];
 if (hh[1] != null) htxt.push('一层层高 ' + hh[1].toFixed(3) + ' m');
 if (hh[2] != null) htxt.push('二层及以上层高 ' + hh[2].toFixed(3) + ' m');
 if (hh.roof != null) htxt.push('天面梯屋高度 ' + hh.roof.toFixed(3) + ' m');
 const phh = doc.internal.pageSize.getHeight();
 htxt.forEach((s, i) => doc.text(s, 20, phh - 8 - i * 6));
 doc.save('手稿电子版.pdf');
}

  window.EXP = {
    init(h) { hooks = h; },
    exportCsv,
    exportPdf,
    exportPhotoSheet,
    exportPhotoSheetExcel,
    ensureCJK,
    fontWidth() {
      const jr = window.jspdf && window.jspdf.jsPDF;
      if (!jr) return -1;
      const d = new jr('p', 'mm', 'a4');
      applyCJK(d);
      return d.getTextWidth('门牌');
    },
  };
})();
