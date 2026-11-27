/* 外业测量 · 平板网页版 (附图模式 + 手绘 + 点注 + 蓝牙) */
(() => {
  window.addEventListener('error', (e) => {
    try {
      const el = document.getElementById('status');
      if (el) el.textContent = '脚本错误：' + (e.message || e.type) + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : '');
    } catch (err) {}
  });

  'use strict';

  const BLE_SERVICE = '3ab10100-f831-4395-b29d-570977d5bf94';
  const BLE_MEASURE = '3ab1010d-f831-4395-b29d-570977d5bf94';

  // ---------- 状态/绘制（实现已移到 js/state.js） ----------
  const {
    S, $, setStatus, setBle, resizeCanvas, fitView,
    rotPoint, i2s, s2i, zoomAt, render, drawLabel,
  } = window.WS;

  // 列表/修正薄封装（实现在 js/ui.js）
  function itemOf(sel) { return window.UI.itemOf(sel); }
  function thicknessM() { return window.UI.thicknessM(); }
  function nPlus(adj) { return window.UI.nPlus(adj); }
  function corrected(it) { return window.UI.corrected(it); }
  function refreshList() { return window.UI.refreshList(); }
  function pushUndo() { return window.INT.pushUndo(); }
  function renderUnordered() { return window.UOR.renderUnordered(); }
  function uoMatch(...args) { return window.UOR.uoMatch(...args); }

  // ---------- 蓝牙 ----------
  function onMeasure(v) {
    if (!isFinite(v)) return;
    S.lastMeas = v;
    if (S.selected && S.selected.kind === 'height') {
      const key = window.floorHeightKey();
      S.heights = S.heights || {};
      S.heights[key] = v;
      setStatus('层高已写入 ' + v.toFixed(4) + ' m');
      render(); refreshList();
      return;
    }
    if (S.app === 'unordered') {
      S.lengths.push(v);
      renderUnordered();
      setStatus(`已收集 ${S.lengths.length} 个长度：${v.toFixed(4)} m`);
      return;
    }
    const it = itemOf(S.selected);
    if (!it) { setStatus(`收到 ${v.toFixed(4)} m（未选中）`); return; }
    // 自动累加：选中项不变时，后续读数依次累加
    const sel = S.selected;
    if (!S.accSel || S.accSel.kind !== sel.kind || S.accSel.idx !== sel.idx) {
      S.accSel = { kind: sel.kind, idx: sel.idx };
      S.accValue = 0;
    }
    const sign = S.accSign || 1;
    S.accSign = 1;
    if (S.autoAcc) {
      S.accValue += sign * v;
      it.len = S.accValue;
      setStatus(`自动累加 ${S.accValue.toFixed(4)} m（本次 ${sign > 0 ? '+' : '-'}${v.toFixed(4)}）`);
    } else {
      it.len = v;
      S.accValue = v;
      setStatus(`收到 ${v.toFixed(4)} m（设备累加模式：取最新读数）`);
    }
    render(); refreshList();
  }

  window.INT.init({
    getState: () => S, render, refreshList, setStatus, setBle, i2s, s2i, itemOf, corrected, thicknessM, cv, resizeCanvas, fitView, zoomAt,
  });

  window.UOR.init({ getState: () => S, setStatus, render, refreshList, cv });

  window.UI.init({ getState: () => S, $ });

  if (window.UOR && window.UOR.updateModeBars) window.UOR.updateModeBars();

  window.REC.init({
    getState: () => S, setStatus, pushUndo, render, refreshList, i2s, s2i, itemOf,
  });

  if (window.GEO) window.GEO.start((s) => { if (s.indexOf('定位中') === 0) setStatus(s); });

  if (window.RELAY) window.RELAY.init({
    onStatus: (s) => setStatus(s),
    onMessage: (m) => {
      if (m && m.type === 'geo' && isFinite(m.lat)) {
        window.__peerGeo = { lat: m.lat, lng: m.lng, acc: m.acc, t: m.t };
        setStatus('已收到对方位置 ±' + Math.round(m.acc || 0) + ' m');
        return;
      }
      if (m && m.type === 'meas' && isFinite(m.len)) {
        let dirTxt = '';
        let why = '';
        try {
          if (m.phoneGeo && window.GEO) {
            const mine = window.GEO.current() || window.__peerGeo;
            if (mine && mine.acc && m.phoneGeo.acc) {
              const Lm = window.GEO.distM(m.phoneGeo, mine);
              const deg = window.GEO.bearing(m.phoneGeo, mine);
              const sigma = Math.atan2(Math.SQRT2 * Math.hypot(m.phoneGeo.acc, mine.acc), Math.max(1, Lm)) * 180 / Math.PI;
              const sel = S.selected;
              if (sel && sel.kind === 'seg') {
                const sg = S.segments[sel.idx];
                if (sg) {
                  sg.dir = deg;
                  sg.dirAcc = sigma;
                  sg.dirSrc = window.GEO.current() ? 'GPS(本机)' : 'GPS(双机)';
                  sg.dirLen = Lm;
                }
              }
              dirTxt = '，方向 ' + deg.toFixed(1) + '° ±' + sigma.toFixed(0) + '°';
            } else {
              why = m.phoneGeo ? '（平板无定位）' : '（手机无GPS）';
            }
          } else {
            why = '（无GPS数据）';
          }
        } catch (e) {}
        onMeasure(m.len);
        render(); refreshList();
        setStatus('手机收到 ' + m.len.toFixed(4) + ' m' + dirTxt + (why || ''));
      }
    },
  });

  window.BLE.init({ setStatus, setBle, onMeasure, state: S });

  // ---------- 导出 ----------
  // ---------- 导出（实现已移到 js/export.js） ----------
  if (window.SIGN) window.SIGN.init({ getState: () => S, setStatus });

  window.EXP.init({ getState: () => S, corrected, thickValue: () => $('thick').value });

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  refreshList();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (location.search.includes('jgtest')) setTimeout(() => {
    try {
      const c = document.createElement('canvas');
      c.width = 600; c.height = 400;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 400);
      g.fillStyle = '#808080';
      g.fillRect(50, 60, 500, 8);    // 上墙灰填充
      g.fillRect(50, 330, 500, 8);   // 下墙
      g.fillRect(50, 60, 8, 278);    // 左墙
      g.fillRect(542, 60, 8, 278);   // 右墙
      g.fillStyle = '#808080';
      g.fillRect(280, 180, 14, 14);  // 柱子
      g.strokeStyle = '#ffff00'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(80, 200); g.lineTo(250, 200); g.stroke();
      S.img = c;
      const r = window.JG.recognize(false);
      S.segments = r.segs; S.columns = r.cols;
      render(); refreshList();
      setStatus('JGTEST segs=' + r.segs.length + ' cols=' + r.cols.length);
    } catch (e) {
      const el = document.getElementById('status');
      if (el) el.textContent = 'JGTEST ERR ' + e.message;
    }
  }, 400);


  if (location.search.includes('jgvtest')) setTimeout(async () => {
    try {
      const data = await (await fetch('testv.pdf')).arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 2 });
      const r = await window.JGV.recognizeVector(page, vp, null);
      S.segments = r.segs; S.columns = r.cols;
      render(); refreshList();
      setStatus('JGVTEST draws=' + r.drawings + ' segs=' + r.segs.length + ' cols=' + r.cols.length);
    } catch (e) {
      const el = document.getElementById('status');
      if (el) el.textContent = 'JGVTEST ERR ' + e.message;
    }
  }, 500);


  if (location.search.includes('jgvfile')) setTimeout(async () => {
    const el = document.getElementById('status');
    const show = (s) => { if (el) el.textContent = s; };
    try {
      show('JGVFILE loading');
      const data = await (await fetch('jgtest.pdf')).arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 2 });
      const off = document.createElement('canvas');
      off.width = Math.round(vp.width); off.height = Math.round(vp.height);
      await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
      S.img = null;
      const r = await window.JGV.recognizeVector(page, vp, null);
      S.segments = r.segs; S.columns = r.cols;
      render(); refreshList();
      show('JGVFILE draws=' + r.drawings + ' segs=' + r.segs.length + ' cols=' + r.cols.length);
    } catch (e) {
      show('JGVFILE ERR ' + e.message);
    }
  }, 500);


  if (location.search.includes('uitest')) setTimeout(() => {
    const el = document.getElementById('status');
    const st = (s) => { if (el) el.textContent = s; };
    try {
      const sel = document.getElementById('appModeSel');
      sel.value = 'jg'; sel.dispatchEvent(new Event('change'));
      const jg1 = document.getElementById('jgBar').style.display;
      const fc1 = document.getElementById('fcBar').style.display;
      const ed1 = document.getElementById('editBar').style.display;
      sel.value = 'plan'; sel.dispatchEvent(new Event('change'));
      const jg2 = document.getElementById('jgBar').style.display;
      const fc2 = document.getElementById('fcBar').style.display;
      sel.value = 'sketch'; sel.dispatchEvent(new Event('change'));
      const sk = document.getElementById('sketchBar').style.display;
      st('UITEST jg: jgBar=' + jg1 + ' fcBar=' + fc1 + ' editBar=' + ed1 +
         ' ; plan: jgBar=' + jg2 + ' fcBar=' + fc2 + ' ; sketch: sketchBar=' + sk);
    } catch (e) {
      st('UITEST ERR ' + e.message);
    }
  }, 400);


  if (location.search.includes('inputtest')) setTimeout(() => {
    const el = document.getElementById('status');
    try {
      window.prompt = () => '5';
      S.segments = [{ a: { x: 100, y: 100 }, b: { x: 400, y: 100 }, len: null, adj: '' }];
      S.selected = { kind: 'seg', idx: 0 };
      S.img = S.img || document.createElement('canvas');
      if (!S.img.width) { S.img.width = 600; S.img.height = 400; }
      document.getElementById('btnInputLen').click();
      if (el) el.textContent = 'INPUTTEST ok len=' + S.segments[0].len;
    } catch (e) {
      if (el) el.textContent = 'INPUTTEST ERR ' + e.message + ' | ' + (e.stack || '').split('\n')[1];
    }
  }, 500);


  if (location.search.includes('sketchinput')) setTimeout(() => {
    const el = document.getElementById('status');
    const errs = [];
    window.addEventListener('error', e => errs.push(e.message + ' @ ' + (e.filename||'') + ':' + e.lineno));
    try {
      const sel = document.getElementById('appModeSel');
      sel.value = 'sketch'; sel.dispatchEvent(new Event('change'));
      S.mode = 'draw';
      S.segments = [{ a: { x: 200, y: 200 }, b: { x: 500, y: 200 }, len: null, adj: '' }];
      S.selected = { kind: 'seg', idx: 0 };
      render(); refreshList();
      window.prompt = () => '5';
      const btn = document.getElementById('btnInputLen');
      const hasHandler = !!btn && !!btn.onclick;
      btn.click();
      if (el) el.textContent = 'SKETCHINPUT handler=' + hasHandler + ' len=' + S.segments[0].len + ' errs=' + errs.join(' | ');
    } catch (e) {
      if (el) el.textContent = 'SKETCHINPUT ERR ' + e.message + ' | ' + errs.join(' | ');
    }
  }, 600);


  if (location.search.includes('splittest')) setTimeout(() => {
    const el = document.getElementById('status');
    try {
      const c = document.createElement('canvas');
      c.width = 1000; c.height = 700;
      c.getContext('2d').fillStyle = '#fff';
      c.getContext('2d').fillRect(0, 0, 1000, 700);
      S.img = c;
      window.WS.fitView();
      S.segments = [{ a: { x: 200, y: 350 }, b: { x: 800, y: 350 }, len: 5, adj: '' }];
      S.totals = [];
      S.selected = { kind: 'seg', idx: 0 };
      S.mode = 'split';
      const mid = window.WS.i2s({ x: 500, y: 350 });
      window.INT.handleTap({ x: mid.x, y: mid.y });
      const listTxt = (document.getElementById('list').textContent || '').replace(/\s+/g, ' ').slice(0, 120);
      if (el) el.textContent = 'SPLITTEST totals=' + S.totals.length + ' segs=' + S.segments.length + ' | ' + listTxt;
    } catch (e) {
      if (el) el.textContent = 'SPLITTEST ERR ' + e.message;
    }
  }, 700);

  const verEl = document.getElementById('appVer');
  if (verEl) verEl.textContent = 'v267';
  if (location.search.includes('relaytest')) setTimeout(() => {
    window.RELAY.init({
      onStatus: (s) => setStatus('RELAY ' + s),
      onMessage: (m) => {
        if (m && m.type === 'meas') setStatus('RELAYTEST got ' + m.len);
      },
    });
    window.RELAY.connect('4321', 'tablet');
  }, 500);
  if (location.search.includes('relayselftest')) setTimeout(() => {
    window.RELAY.init({
      onStatus: (s) => setStatus('SELFTEST ' + s),
      onMessage: (m) => {
        if (m && m.type === 'meas') setStatus('SELFTEST got ' + m.len);
      },
    });
    window.RELAY.connect('4321', 'tablet');
    setTimeout(() => { window.RELAY.publish({ type: 'meas', t: Date.now(), len: 1.2345 }); }, 4000);
  }, 500);
  document.title = '外业测量 · 平板版 v149';
  try {
    let wake = null;
    const req = async () => {
      try { wake = await navigator.wakeLock.request('screen'); } catch (e) {}
    };
    req();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { req(); if (window.RELAY && window.RELAY.ensure) window.RELAY.ensure(); }
    });
  } catch (e) {}

  if (location.search.includes('zhtest')) setTimeout(() => {
    const sel = document.getElementById('appModeSel');
    sel.value = 'zh';
    sel.dispatchEvent(new Event('change'));
    setTimeout(() => {
      try {
        document.getElementById('zhHouseNo').value = '18';
        document.getElementById('zhFloors').value = '3';
        document.getElementById('zhInitOk').click();
      } catch (e) {}
      document.getElementById('btnZhCut').click();
      setStatus('ZHTEST app=' + S.app + ' floors=' + S.floorCount + ' opts=' + document.getElementById('zhFloorSel').options.length + ' segs=' + S.segments.length + ' panel=' + getComputedStyle(document.getElementById('panel')).display +
        ' sketchBar=' + getComputedStyle(document.getElementById('sketchBar')).display +
        ' editBar=' + getComputedStyle(document.getElementById('editBar')).display);
    }, 400);
  }, 600);

  if (location.search.includes('dragtest')) setTimeout(() => {
    try {
      const c = document.createElement('canvas');
      c.width = 1240; c.height = 1754;
      c.getContext('2d').fillStyle = '#fff';
      c.getContext('2d').fillRect(0, 0, c.width, c.height);
      S.img = c;
      S.app = 'sketch';
      S.mode = 'select';
      S.segments = [{ a: { x: 300, y: 600 }, b: { x: 800, y: 600 }, len: 5, adj: '' }];
      S.selected = null;
      render();
      const before = JSON.stringify(S.segments[0].b);
      const ip = { x: S.segments[0].b.x, y: S.segments[0].b.y };
      const began = window.DRAW.beginVertexDrag(ip, 'select');
      window.DRAW.moveVertexDrag({ x: S.segments[0].b.x + 40, y: S.segments[0].b.y + 25 });
      const moved = window.DRAW.endVertexDrag();
      setStatus('DRAGTEST began=' + began + ' moved=' + moved + ' before=' + before + ' after=' + JSON.stringify(S.segments[0].b));
    } catch (e) {
      setStatus('DRAGTEST ERR ' + e.message);
    }
  }, 800);

  if (location.search.includes('multitest')) setTimeout(() => {
    S.img = document.createElement('canvas'); S.img.width = 1240; S.img.height = 1754;
    S.app = 'sketch';
    S.segments = [
      { a: { x: 100, y: 100 }, b: { x: 300, y: 100 }, len: null, adj: '' },
      { a: { x: 300, y: 100 }, b: { x: 300, y: 300 }, len: null, adj: '' },
      { a: { x: 100, y: 300 }, b: { x: 300, y: 300 }, len: null, adj: '' },
    ];
    S.multi = [0, 1];
    document.getElementById('btnMirror').click();
    const afterMirror = S.segments[0].a.x;
    document.getElementById('btnCopy').click();
    const n = S.segments.length;
    const bars = ['editBar','fcBar','jgBar'].map(id => id + '=' + getComputedStyle(document.getElementById(id)).display).join(' ');
    setStatus('MULTITEST mirrorX=' + afterMirror + ' segs=' + n + ' | ' + bars);
  }, 900);

  if (location.search.includes('doortest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    c.getContext('2d').fillStyle = '#fff'; c.getContext('2d').fillRect(0, 0, 1240, 1754);
    S.img = c; S.app = 'sketch'; S.mode = 'select';
    S.segments = [{ a: { x: 220, y: 560 }, b: { x: 1020, y: 560 }, len: null, adj: '' }];
    S.doors = [{ pos: { x: 600, y: 500 }, num: '18' }];
    render(); refreshList();
    setStatus('DOORTEST doors=' + S.doors.length);
  }, 700);

  if (location.search.includes('sizhitest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754);
    S.img = c;
    S.app = 'zh';
    S.mode = 'select';
    S.segments = [
      { a: { x: 220, y: 560 }, b: { x: 1020, y: 560 }, len: null, adj: '' },
      { a: { x: 1020, y: 560 }, b: { x: 1020, y: 1160 }, len: null, adj: '' },
      { a: { x: 1020, y: 1160 }, b: { x: 220, y: 1160 }, len: null, adj: '' },
      { a: { x: 220, y: 1160 }, b: { x: 220, y: 560 }, len: null, adj: '' },
    ];
    S.north = 96;
    S.sizhi = {
      east: '巷', south: '巷', west: '巷', north: '巷',
      adj: { east: { on: false, door: '' }, south: { on: false, door: '' }, west: { on: false, door: '' }, north: { on: true, door: '7' } },
    };
    window.WS.fitView();
    render(); refreshList();
    setStatus('SIZHITEST ok');
  }, 800);

  if (location.search.includes('floortest')) setTimeout(() => {
    const sel = document.getElementById('appModeSel');
    sel.value = 'zh'; sel.dispatchEvent(new Event('change'));
    setTimeout(() => {
      window.UOR.zhSetFloors(3);
      window.UOR.zhSwitchFloor(2);
      setStatus('FLOORTEST count=' + S.floorCount + ' idx=' + S.floorIdx + ' segs=' + S.segments.length + ' adj=' + S.segments.filter(x=>x.adj==='++').length);
    }, 300);
  }, 700);

  if (location.search.includes('balctest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754);
    S.img = c; S.app = 'zh'; S.mode = 'select';
    S.segments = [
      { a: { x: 220, y: 560 }, b: { x: 1020, y: 560 }, len: null, adj: '' },
      { a: { x: 1020, y: 560 }, b: { x: 1020, y: 1160 }, len: null, adj: '' },
      { a: { x: 1020, y: 1160 }, b: { x: 220, y: 1160 }, len: null, adj: '' },
      { a: { x: 220, y: 1160 }, b: { x: 220, y: 560 }, len: null, adj: '' },
    ];
    S.balconies = []; S.doors = []; S.sizhi = null;
    window.WS.fitView();
    S.mode = 'balcony';
    window.INT.handleTap(window.WS.i2s({ x: 620, y: 560 }));
    window.INT.handleTap(window.WS.i2s({ x: 760, y: 760 }));
    setStatus('BALCTEST segs=' + S.segments.length + ' balconies=' + (S.balconies ? S.balconies.length : 0));
  }, 800);

  if (location.search.includes('stairtest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754);
    S.img = c; S.app = 'zh'; S.mode = 'stairhouse'; S.floorIdx = 'roof';
    S.segments = [
      { a: { x: 220, y: 560 }, b: { x: 1020, y: 560 }, len: null, adj: '' },
      { a: { x: 1020, y: 560 }, b: { x: 1020, y: 1160 }, len: null, adj: '' },
      { a: { x: 1020, y: 1160 }, b: { x: 220, y: 1160 }, len: null, adj: '' },
      { a: { x: 220, y: 1160 }, b: { x: 220, y: 560 }, len: null, adj: '' },
    ];
    S.stairStart = null; S.stairPrev = null;
    window.WS.fitView();
    const tap = (x, y) => window.INT.handleTap(window.WS.i2s({ x, y }));
    tap(620, 560);
    tap(620, 800);
    tap(900, 800);
    tap(900, 600);
    setStatus('STAIRTEST segs=' + S.segments.length + ' stair=' + S.segments.filter(x => x.stair).length);
  }, 800);

  if (location.search.includes('sizhidimtest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754);
    S.img = c; S.app = 'zh'; S.mode = 'select';
    S.segments = [
      { a: { x: 220, y: 560 }, b: { x: 1020, y: 560 }, len: null, adj: '' },
      { a: { x: 1020, y: 560 }, b: { x: 1020, y: 1160 }, len: null, adj: '' },
      { a: { x: 1020, y: 1160 }, b: { x: 220, y: 1160 }, len: null, adj: '' },
      { a: { x: 220, y: 1160 }, b: { x: 220, y: 560 }, len: null, adj: '' },
    ];
    const off = (txt) => ({ text: txt, adj: { on: false, door: '' } });
    S.sizhi = {
      up: { text: '巷', adj: { on: true, door: '7', struct: 'B', floors: '2', labels: [{ door: '7', struct: 'B', floors: '2' }, { door: '9', struct: 'C', floors: '3' }] } },
      right: off('巷'), down: off('巷'), left: off('巷'),
    };
    window.WS.fitView();
    window.UOR.rebuildSizhiDims();
    render(); refreshList();
    setStatus('SIZHIDIMTEST segs=' + S.segments.length + ' dims=' + S.segments.filter(x => x.sizhiDim).length);
  }, 800);

  if (location.search.includes('sizhidialog')) setTimeout(() => {
    const sel = document.getElementById('appModeSel');
    sel.value = 'zh'; sel.dispatchEvent(new Event('change'));
    setTimeout(() => {
      document.getElementById('zhHouseNo').value = '18';
      document.getElementById('zhFloors').value = '3';
      document.getElementById('zhInitOk').click();
      setTimeout(() => {
        document.getElementById('btnZhSizhi').click();
        document.getElementById('szAdjU').click();
        setStatus('SIZHIDIALOG ok');
      }, 400);
    }, 400);
  }, 700);

  if (location.search.includes('neighstairtest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754);
    S.img = c; S.app = 'zh'; S.mode = 'select'; S.floorIdx = '1';
    S.segments = [
      { a: { x: 220, y: 560 }, b: { x: 1020, y: 560 }, len: null, adj: '' },
      { a: { x: 1020, y: 560 }, b: { x: 1020, y: 1160 }, len: null, adj: '' },
      { a: { x: 1020, y: 1160 }, b: { x: 220, y: 1160 }, len: null, adj: '' },
      { a: { x: 220, y: 1160 }, b: { x: 220, y: 560 }, len: null, adj: '' },
    ];
    const off = () => ({ text: '巷', adj: { on: false } });
    S.sizhi = {
      up: { text: '巷', adj: { on: true, door: '7', struct: 'B', floors: '2', labels: [{ door: '7', struct: 'B', floors: '2' }, { door: '9', struct: 'C', floors: '3' }] } },
      right: off(), down: off(), left: off(),
    };
    window.WS.fitView();
    window.UOR.rebuildSizhiDims();
    render(); refreshList(); window.UOR.updateModeBars();
    // 模拟点梯屋，然后点邻墙
    document.getElementById('btnZhStair').click();
    window.INT.handleTap(window.WS.i2s({ x: 620, y: 300 }));
    setStatus('NEIGHSTAIRTEST segs=' + S.segments.length + ' stair=' + S.segments.filter(x => x.stair).length);
  }, 900);

  if (location.search.includes('nbrtest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 1754);
    S.img = c; S.app = 'zh'; S.mode = 'select'; S.floorIdx = '1';
    S.segments = [
      { a: { x: 220, y: 560 }, b: { x: 1020, y: 560 }, len: null, adj: '' },
      { a: { x: 1020, y: 560 }, b: { x: 1020, y: 1160 }, len: null, adj: '' },
      { a: { x: 1020, y: 1160 }, b: { x: 220, y: 1160 }, len: null, adj: '' },
      { a: { x: 220, y: 1160 }, b: { x: 220, y: 560 }, len: null, adj: '' },
    ];
    window.WS.fitView();
    render(); refreshList();
    document.getElementById('btnZhSizhi').click();
    document.getElementById('szAdjU').click();
    document.getElementById('szAdjR').click();
    document.getElementById('szDoorU').value = '7';
    document.getElementById('szStructU').value = 'B';
    document.getElementById('szFloorsU').value = '2';
    document.getElementById('szDoorR').value = '9';
    document.getElementById('szStructR').value = 'C';
    document.getElementById('szFloorsR').value = '3';
    document.getElementById('szSave').click();
    setStatus('NBRTEST segs=' + S.segments.length);
  }, 900);

  if (location.search.includes('drawtoggle')) setTimeout(() => {
    document.getElementById('btnZhToDraw').click();
    setStatus('DRAWTOGGLE zhBar=' + getComputedStyle(document.getElementById('zhBar')).display +
      ' sketchBar=' + getComputedStyle(document.getElementById('sketchBar')).display +
      ' cancel=' + getComputedStyle(document.getElementById('btnSketchCancel')).display);
  }, 1500);

  if (location.search.includes('drawtogglecancel')) setTimeout(() => {
    document.getElementById('btnZhToDraw').click();
    setTimeout(() => document.getElementById('btnSketchCancel').click(), 500);
    setTimeout(() => setStatus('DRAWTOGGLE2 zhBar=' + getComputedStyle(document.getElementById('zhBar')).display +
      ' sketchBar=' + getComputedStyle(document.getElementById('sketchBar')).display +
      ' cancel=' + getComputedStyle(document.getElementById('btnSketchCancel')).display), 800);
  }, 1500);

  if (location.search.includes('gridsnaptest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = '1'; S.zhDrawing = true;
    S.segments = [];
    window.WS.fitView();
    S.mode = 'draw';
    window.INT.handleTap(window.WS.i2s({ x: 233, y: 318 }));
    window.INT.handleTap(window.WS.i2s({ x: 601, y: 316 }));
    const sg = S.segments[0];
    setStatus('GRIDSNAP a=' + (sg ? [sg.a.x, sg.a.y, sg.b.x, sg.b.y].join(',') : 'none'));
  }, 900);

  if (location.search.includes('splitsnaptest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = '1'; S.zhDrawing = true;
    S.segments = [{ a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '' }];
    S.selected = { kind: 'seg', idx: 0 };
    S.mode = 'split';
    window.WS.fitView();
    window.INT.handleTap(window.WS.i2s({ x: 333, y: 550 }));
    const s = S.segments.map(g => g.a.x + '-' + g.b.x).join(' | ');
    setStatus('SPLITSNAP ' + s + ' adj=' + S.segments.map(g => g.adj).join('|') + ' totAdj=' + S.totals.map(x => x.adj).join('|'));
  }, 900);

  if (location.search.includes('balcsnaptest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = '1'; S.zhDrawing = true;
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: null, adj: '' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: null, adj: '' },
    ];
    window.WS.fitView();
    S.mode = 'balcony';
    window.INT.handleTap(window.WS.i2s({ x: 650, y: 550 }));
    window.INT.handleTap(window.WS.i2s({ x: 700, y: 850 }));
    const pts = S.segments.filter(g => g.balcony).map(g => [g.a.x, g.a.y, g.b.x, g.b.y].join(','));
    setStatus('BALCSNAP ' + pts.join(' | '));
  }, 900);

  if (location.search.includes('doorsnaptest')) setTimeout(() => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = '1';
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '' },
    ];
    window.WS.fitView();
    S.mode = 'door'; S.doorPending = '7';
    window.INT.handleTap(window.WS.i2s({ x: 333, y: 590 }));
    const d1 = JSON.parse(JSON.stringify(S.doors));
    S.mode = 'door'; S.doorPending = '9';
    window.INT.handleTap(window.WS.i2s({ x: 1080, y: 700 }));
    setStatus('DOORSNAP ' + JSON.stringify(S.doors));
  }, 900);

  if (location.search.includes('leninputtest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = '1';
    S.segments = [{ a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '' }];
    S.selected = { kind: 'seg', idx: 0 };
    window.WS.fitView(); render(); refreshList();
    const inp = document.getElementById('infoLenInput');
    inp.value = '12.345';
    inp.dispatchEvent(new Event('change'));
    setStatus('LENINPUT len=' + S.segments[0].len + ' input=' + inp.value + ' label=' + document.getElementById('infoLen').textContent);
  }, 900);

  if (location.search.includes('balc2test')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = '1'; S.zhDrawing = true;
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: 10, adj: '' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: 10, adj: '' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: 10, adj: '' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: 10, adj: '' },
    ];
    window.WS.fitView();
    S.mode = 'balcony';
    window.INT.handleTap(window.WS.i2s({ x: 1040, y: 555 }));
    window.INT.handleTap(window.WS.i2s({ x: 700, y: 850 }));
    const segs = S.segments.map(g => [g.a.x, g.a.y, g.b.x, g.b.y].join(','));
    setStatus('BALC2 segs=' + segs.length + ' totals=' + S.totals.length + ' | ' + segs.join(' ; '));
  }, 900);

  if (location.search.includes('totalhittest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = '1'; S.zhDrawing = true;
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: 10, adj: '' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: 10, adj: '' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: 10, adj: '' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: 10, adj: '' },
    ];
    window.WS.fitView();
    S.mode = 'balcony';
    window.INT.handleTap(window.WS.i2s({ x: 1040, y: 555 }));
    window.INT.handleTap(window.WS.i2s({ x: 700, y: 850 }));
    S.mode = 'select';
    window.INT.handleTap(window.WS.i2s({ x: 650, y: 480 }));
    setStatus('TOTALHIT sel=' + JSON.stringify(S.selected) + ' totals=' + S.totals.length);
  }, 900);

  if (location.search.includes('floorsizhitest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.app = 'zh'; S.floorIdx = 1; S.zhDrawing = false;
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: null, adj: '' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: null, adj: '' },
    ];
    window.WS.fitView();
    window.UOR.zhSetFloors(4);
    const off = () => ({ text: '巷', adj: { on: false } });
    S.sizhi = { up: { text: '巷', adj: { on: true, door: '7', struct: 'B', floors: '2', labels: [{ door: '7', struct: 'B', floors: '2' }] } }, right: off(), down: off(), left: off() };
    window.UOR.rebuildSizhiDims(); render(); refreshList();
    const before = { sizhi: !!S.sizhi, nbr: S.segments.filter(sg => sg.neighborWall).length, idx: S.floorIdx, type: typeof S.floorIdx };
    window.UOR.zhSwitchFloor('4');
    const mid = { sizhi: !!S.sizhi, idx: S.floorIdx, type: typeof S.floorIdx };
    window.UOR.zhSwitchFloor('1');
    const after = { sizhi: !!S.sizhi, nbr: S.segments.filter(sg => sg.neighborWall).length, idx: S.floorIdx, type: typeof S.floorIdx };
    setStatus('FLOORSIZHI bef=' + JSON.stringify(before) + ' mid=' + JSON.stringify(mid) + ' aft=' + JSON.stringify(after));
  }, 900);

  if (location.search.includes('roofpicktest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.floorIdx = 'roof'; window.UOR.setApp('zh'); window.WS.resizeCanvas(); S.zhDrawing = false;
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: null, adj: '+0+0' },
    ];
    window.WS.fitView();
    S.mode = 'stairhouse';
    window.INT.handleTap(window.WS.i2s({ x: 600, y: 555 }));
    window.INT.handleTap(window.WS.i2s({ x: 600, y: 800 }));
    window.INT.handleTap(window.WS.i2s({ x: 900, y: 555 }));
    const mode1 = S.mode;
    const splitOK = !!(S.roofSplit);
    window.INT.handleTap(window.WS.i2s({ x: 700, y: 700 }));
    const rs2 = S.roofSplit;
    let dbg = 'none';
    if (rs2) dbg = rs2.polys.map(pl => pl.length + ':' + pl.slice(0, 2).map(q => Math.round(q.x) + ',' + Math.round(q.y)).join('/')).join(' ; ');
    setStatus('ROOFPICK splitOK=' + splitOK + ' mode=' + S.mode + ' open=' + S.segments.filter(g => g.roofOpen).length + ' segs=' + S.segments.length + ' split=' + dbg);
  }, 900);

  if (location.search.includes('roofdbg')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.floorIdx = 'roof'; window.UOR.setApp('zh'); window.WS.resizeCanvas();
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: null, adj: '+0+0' },
    ];
    window.WS.fitView();
    S.mode = 'stairhouse';
    window.INT.handleTap(window.WS.i2s({ x: 600, y: 555 }));
    window.INT.handleTap(window.WS.i2s({ x: 600, y: 800 }));
    window.INT.handleTap(window.WS.i2s({ x: 900, y: 555 }));
    const g = window.__ROOFDBG;
    const loop = g ? g.buildOutlineLoop() : null;
    const stSeg = S.segments.filter(x => x.stair)[0];
    const chain = (g && stSeg) ? g.chainOrdered({ ...stSeg.a }, stSeg.stairId) : null;
    setStatus('ROOFDBG segs=' + S.segments.map(g => Math.round(g.a.x) + ',' + Math.round(g.a.y) + '-' + Math.round(g.b.x) + ',' + Math.round(g.b.y) + (g.stair ? 'S' : '')).join('|') + ' loop=' + (loop ? loop.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join('|') : 'null') + ' chain=' + (chain ? chain.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join('|') : 'null'));
  }, 900);

  if (location.search.includes('stairmergetest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.floorIdx = '1'; window.UOR.setApp('zh'); window.WS.resizeCanvas();
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: null, adj: '+0+0' },
    ];
    window.WS.fitView();
    S.mode = 'stairhouse';
    window.INT.handleTap(window.WS.i2s({ x: 603, y: 553 }));
    window.INT.handleTap(window.WS.i2s({ x: 601, y: 698 }));
    window.INT.handleTap(window.WS.i2s({ x: 602, y: 802 }));
    window.INT.handleTap(window.WS.i2s({ x: 701, y: 801 }));
    window.INT.handleTap(window.WS.i2s({ x: 702, y: 902 }));
    const stair = S.segments.filter(g => g.stair).map(g => [g.a.x, g.a.y, g.b.x, g.b.y].join(','));
    setStatus('STAIRMERGE count=' + stair.length + ' segs=' + stair.join(' | '));
  }, 900);

  if (location.search.includes('heighttest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.floorIdx = 1; window.UOR.setApp('zh'); window.WS.resizeCanvas();
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: null, adj: '+0+0' },
    ];
    window.WS.fitView(); render(); refreshList();
    const hp = window.floorHeightAnchor();
    window.INT.handleTap(window.WS.i2s(hp));
    const inp = document.getElementById('infoLenInput');
    const title = document.getElementById('infoTitle').textContent;
    inp.value = '3.2';
    inp.dispatchEvent(new Event('change'));
    setStatus('HEIGHTTEST anchor=' + JSON.stringify(hp) + ' sel=' + JSON.stringify(S.selected) + ' title=' + title + ' h1=' + (S.heights && S.heights[1]) + ' info=' + document.getElementById('infoLen').textContent);
  }, 900);

  if (location.search.includes('photosheettest')) setTimeout(() => {
    document.getElementById('btnPhotoSheet').click();
    setStatus('PHOTOSHEET open=' + document.getElementById('photoSheetModal').classList.contains('open') + ' cells=' + document.querySelectorAll('#psGrid .ps-cell').length);
  }, 900);

  if (location.search.includes('photosheetdemo')) setTimeout(() => {
    const mk = (txt, bg) => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 400, 300);
      g.fillStyle = '#fff'; g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.fillText(txt, 200, 160);
      return c.toDataURL('image/jpeg', 0.8);
    };
    S.photoBind = {
      door: { url: mk('门牌', '#1565c0'), name: '门牌' },
      walls: [{ url: mk('东墙', '#2e7d32'), dir: '东', name: '一层东墙' }],
      structure: { 2: { url: mk('结构', '#6d4c41'), name: '内部结构' } },
      stair: { url: mk('梯屋', '#8d6e63'), name: '梯屋' },
      thick: { url: mk('墙厚', '#455a64'), name: '墙厚' },
    };
    document.getElementById('btnPhotoSheet').click();
    setStatus('PHOTOSHEETDEMO items=5');
  }, 900);

  if (location.search.includes('photosheetexcel')) setTimeout(() => {
    const mk = (txt, bg) => {
      const c = document.createElement('canvas'); c.width = 400; c.height = 300;
      const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 400, 300);
      g.fillStyle = '#fff'; g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.fillText(txt, 200, 170);
      return c.toDataURL('image/jpeg', 0.8);
    };
    const items = [
      { name: '门牌', url: mk('门牌', '#1565c0') },
      { name: '一层东墙', url: mk('东墙', '#2e7d32') },
      { name: '一层南墙', url: mk('南墙', '#ef6c00') },
      { name: '内部结构', url: mk('结构', '#6d4c41') },
      { name: '梯屋', url: mk('梯屋', '#8d6e63') },
      { name: '墙厚', url: mk('墙厚', '#455a64') },
    ];
    window.EXP.exportPhotoSheetExcel('（2025）复23B800-042', items).then(len => {
      setStatus('XLSX len=' + len);
    }).catch(e => setStatus('XLSX ERR ' + e.message));
  }, 1200);

  if (location.search.includes('photobtntest')) setTimeout(() => {
    const c = document.createElement('canvas'); c.width = 1240; c.height = 1754;
    S.img = c; S.floorIdx = 1; window.UOR.setApp('zh'); window.WS.resizeCanvas();
    S.segments = [
      { a: { x: 250, y: 550 }, b: { x: 1050, y: 550 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 550 }, b: { x: 1050, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 1050, y: 1150 }, b: { x: 250, y: 1150 }, len: null, adj: '+0+0' },
      { a: { x: 250, y: 1150 }, b: { x: 250, y: 550 }, len: null, adj: '+0+0' },
    ];
    S.doors = [{ pos: { x: 600, y: 550 }, num: '18', horiz: true, in: 1 }];
    S.selected = { kind: 'door', idx: 0 };
    render(); refreshList();
    window.INT.renderInfoBar();
    const before = document.getElementById('btnInfoPhoto').textContent;
    S.photoBind = { door: { url: 'x', name: '门牌' }, walls: [], structure: {}, stair: null, thick: null };
    window.INT.renderInfoBar();
    const after = document.getElementById('btnInfoPhoto').textContent;
    setStatus('PHOTOBTN before=' + before + ' after=' + after);
  }, 900);

  if (location.search.includes('cjkfonttest')) setTimeout(() => {
    window.EXP.ensureCJK(() => {
      setStatus('CJKFONT width=' + window.EXP.fontWidth() + ' b64=' + (window.CJK_FONT_B64 ? window.CJK_FONT_B64.length : 0));
    });
  }, 900);

  if (location.search.includes('pdfmultipagetest')) setTimeout(() => {
    const rect = (y0) => [
      { a: { x: 250, y: y0 }, b: { x: 1050, y: y0 }, len: 10, adj: '+0+0' },
      { a: { x: 1050, y: y0 }, b: { x: 1050, y: y0 + 600 }, len: 10, adj: '+0+0' },
      { a: { x: 1050, y: y0 + 600 }, b: { x: 250, y: y0 + 600 }, len: 10, adj: '+0+0' },
      { a: { x: 250, y: y0 + 600 }, b: { x: 250, y: y0 }, len: 10, adj: '+0+0' },
    ];
    S.app = 'zh'; S.floorCount = 3; S.floorIdx = 1;
    S.segments = rect(550);
    S.notes = []; S.doors = []; S.totals = []; S.sizhi = null;
    S.floors = {
      1: { segments: rect(550), notes: [], doors: [], sizhi: null, totals: [] },
      2: { segments: rect(550).map(g => ({ a: { ...g.a }, b: { ...g.b }, len: 10, adj: '++' })), notes: [], doors: [], sizhi: null, totals: [] },
      roof: { segments: rect(550).concat([{ a: { x: 600, y: 550 }, b: { x: 600, y: 800 }, len: null, adj: '+0+0', stair: true, stairLabel: true, stairId: 'st1' }]), notes: [], doors: [], sizhi: null, totals: [] },
    };
    S.floors[3] = S.floors[2];
    try {
      const n = window.EXP.pdfPageCount();
      setStatus('PDFPAGES ' + n);
    } catch (e) { setStatus('PDFPAGES ERR ' + e.message); }
  }, 900);

  window.__ready = true;
})();
