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

  window.REC.init({
    getState: () => S, setStatus, pushUndo, render, refreshList, i2s, s2i, itemOf,
  });

  if (window.GEO) window.GEO.start((s) => { if (s.indexOf('定位中') === 0) setStatus(s); });

  if (window.RELAY) window.RELAY.init({
    onStatus: (s) => setStatus(s),
    onMessage: (m) => {
      if (m && m.type === 'meas' && isFinite(m.len)) {
        let dirTxt = '';
        let why = '';
        try {
          if (m.phoneGeo && window.GEO) {
            const mine = window.GEO.current();
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
                  sg.dirSrc = 'GPS';
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
  if (verEl) verEl.textContent = 'v150';
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

  window.__ready = true;
})();
