/* 电子签名：弹层画板，保存为 dataURL 存到 S.signature */
(function () {
  let hooks = null;
  let drawing = false, last = null, dirty = false;

  function ctxOf() { return document.getElementById('signCanvas').getContext('2d'); }

  function clear() {
    const c = document.getElementById('signCanvas');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    dirty = false;
  }

  function open() {
    const modal = document.getElementById('signModal');
    modal.classList.add('open');
    clear();
    hooks.setStatus('请输入签名');
  }

  function save() {
    const S = hooks.getState();
    const c = document.getElementById('signCanvas');
    if (!dirty) { hooks.setStatus('签名是空的'); return; }
    S.signature = c.toDataURL('image/png');
    document.getElementById('signModal').classList.remove('open');
    hooks.setStatus('签名已保存，导出 PDF 时会出现在右下角');
  }

  function bind() {
    const c = document.getElementById('signCanvas');
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      drawing = true; dirty = true;
      last = pos(e);
      const g = ctxOf();
      g.beginPath(); g.moveTo(last.x, last.y);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      const g = ctxOf();
      g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = '#123a63';
      g.lineTo(p.x, p.y); g.stroke();
      g.beginPath(); g.moveTo(p.x, p.y);
      last = p;
    });
    const end = () => { drawing = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    document.getElementById('signClear').onclick = clear;
    document.getElementById('signSave').onclick = save;
    document.getElementById('signClose').onclick = () => document.getElementById('signModal').classList.remove('open');
  }

  window.SIGN = {
    init(h) { hooks = h; bind(); },
    open,
    has() { const S = hooks.getState(); return !!S.signature; },
    data() { return hooks.getState().signature || null; },
  };
})();
