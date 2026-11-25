/* 绘图工具模块：点选/拖动端点 + 各模式的统一绘图入口
   目标：任何模式都通过 window.DRAW 调用同一套“手绘类”操作，保证体验一致。 */
(function () {
  let hooks = null;
  let drag = null;
  const PAINT_MODES = ['draw', 'free', 'select', 'addline', 'split', 'note'];

  function init(h) { hooks = h; }
  function isPaintMode(m) { return PAINT_MODES.indexOf(m) >= 0; }

  // 统一入口：切绘图模式 / 处理点击
  function setMode(m) { if (hooks && hooks.setPaintMode) hooks.setPaintMode(m); }
  function tap(ip) { if (hooks && hooks.paintTap) return hooks.paintTap(ip); }

  function vertexCandidates() {
    const S = hooks.getState();
    const arr = [];
    S.segments.forEach(sg => { arr.push(sg.a, sg.b); });
    S.notes.forEach(n => {
      if (n.pos) arr.push(n.pos);
      if (n.a) arr.push(n.a);
      if (n.b) arr.push(n.b);
    });
    return arr;
  }

  // 命中端点（屏幕 28px 内）
  function hitVertex(ip) {
    let best = null;
    for (const p of vertexCandidates()) {
      if (!p) continue;
      const a = hooks.i2s(p), b = hooks.i2s(ip);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d <= 28 && (!best || d < best.d)) best = { d, p };
    }
    return best;
  }

  function same(p, q) { return Math.hypot(p.x - q.x, p.y - q.y) < 0.6; }

  // 开始拖动端点；返回 true 表示事件被接管（不再平移画布）
  function beginVertexDrag(ip, mode) {
    if (mode !== 'select') return false;
    const hit = hitVertex(ip);
    if (!hit) return false;
    drag = { origin: { x: hit.p.x, y: hit.p.y }, started: false };
    hooks.setStatus('拖动端点调整形状（测量长度不变）');
    return true;
  }

  function moveVertexDrag(ip) {
    if (!drag) return;
    if (!drag.started) { drag.started = true; if (hooks.pushUndo) hooks.pushUndo(); }
    const S = hooks.getState();
    const q = { x: ip.x, y: ip.y };
    S.segments.forEach(sg => {
      if (same(sg.a, drag.origin)) sg.a = { ...q };
      if (same(sg.b, drag.origin)) sg.b = { ...q };
    });
    S.notes.forEach(n => {
      if (n.pos && same(n.pos, drag.origin)) n.pos = { ...q };
      if (n.a && same(n.a, drag.origin)) n.a = { ...q };
      if (n.b && same(n.b, drag.origin)) n.b = { ...q };
    });
    hooks.render();
  }

  function endVertexDrag() {
    if (!drag) return false;
    const moved = drag.started;
    drag = null;
    if (!moved) return false;
    if (hooks.refreshList) hooks.refreshList();
    hooks.setStatus('已移动端点（如需恢复测量值请重新绑定）');
    return true;
  }

  window.DRAW = {
    init, isPaintMode, setMode, tap,
    hitVertex, beginVertexDrag, moveVertexDrag, endVertexDrag,
    get dragging() { return !!drag; },
  };
})();
