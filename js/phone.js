/* 手机端：连徕卡 → 读数 → 通过 MQTT 发给平板 */
(function () {
  const SERVICE = '3ab10100-f831-4395-b29d-570977d5bf94';
  const MEASURE = '3ab1010d-f831-4395-b29d-570977d5bf94';
  const $ = (id) => document.getElementById(id);
  const setRelay = (s) => { $('relayStatus').textContent = s; };
  const setBle = (s) => { $('bleStatus').textContent = s; };
  let geoOn = false;
  let device = null, code = '';

  if (window.RELAY) {
    window.RELAY.init({
      onStatus: (s) => setRelay(s),
      onMessage: () => {},
    });
  }

  $('btnRelay').onclick = () => {
    code = ($('code').value || '').trim();
    if (!/^\d{3,6}$/.test(code)) { setStatus('请先输入 3~6 位配对码'); return; }
    window.RELAY.connect(code, 'phone');
  };
  $('btnRelayOff').onclick = () => { window.RELAY.disconnect(); setRelay('已断开中转'); };

  async function connectBle() {
    if (!navigator.bluetooth) { setBle('此浏览器不支持蓝牙，请改用 Microsoft Edge 打开'); alert('此浏览器不支持蓝牙，请用 Microsoft Edge 打开本页'); return; }
    try {
      setBle('搜索徕卡…（选择框里要选 DISTO）');
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE] }], optionalServices: [SERVICE],
      });
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(SERVICE);
      const chars = await svc.getCharacteristics();
      let subs = 0;
      const onPacket = (ev) => {
        const dv = ev.target.value;
        if (dv.byteLength < 4) return;
        const len = dv.getFloat32(0, true);
        if (!isFinite(len) || len <= 0.001 || len > 10000) return;
        const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        const hex = Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const g = window.GEO && window.GEO.current();
        const ok = window.RELAY.publish({ type: 'meas', t: Date.now(), len, hex, phoneGeo: g || null });
        addRow(len, ok);
        setBle(ok ? '已发送 ' + len.toFixed(4) + ' m' : '蓝牙收到，但中转未连接：' + len.toFixed(4) + ' m');
      };
      for (const ch of chars) {
        try {
          if (!ch.properties || !(ch.properties.notify || ch.properties.indicate)) continue;
          ch.addEventListener('characteristicvaluechanged', onPacket);
          await ch.startNotifications();
          subs++;
        } catch (e) {}
      }
      if (!subs) {
        const ch = await svc.getCharacteristic(MEASURE);
        ch.addEventListener('characteristicvaluechanged', onPacket);
        await ch.startNotifications();
      }
      setBle('徕卡已连接，按测量键发送');
    } catch (e) {
      const msg = String(e && e.message || e);
      if (msg.indexOf('cancel') >= 0 || (e && e.name === 'NotFoundError')) {
        setBle('未选择设备：请确认测距仪已开机、未被其他设备连接，靠近手机后重试');
      } else {
        setBle('连接失败：' + msg);
      }
    }
  }

  function addRow(len, sent) {
    const list = $('list');
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = '<span>' + new Date().toLocaleTimeString() + '</span><span>' +
      len.toFixed(4) + ' m ' + (sent ? '✓' : '✗') + '</span>';
    list.prepend(div);
    while (list.children.length > 50) list.removeChild(list.lastChild);
  }

  if (location.search.includes('mtest')) setTimeout(() => {
    window.RELAY.connect('4321', 'phone');
    setTimeout(() => { window.RELAY.publish({ type: 'meas', t: Date.now(), len: 1.2345 }); }, 3000);
  }, 300);

  $('btnSendManual').onclick = () => {
    const v = parseFloat($('manualLen').value);
    if (!isFinite(v) || v <= 0) { setBle('请输入有效长度'); return; }
    const g = window.GEO && window.GEO.current();
    const ok = window.RELAY.publish({ type: 'meas', t: Date.now(), len: v, manual: true, phoneGeo: g || null });
    addRow(v, ok);
    setBle(ok ? '已发送 ' + v.toFixed(4) + ' m（手动）' : '中转未连接，发送失败');
  };
  $('manualLen').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnSendManual').click(); });

  if (window.GEO) {
    window.GEO.start((s) => { if (!geoOn && s.indexOf('定位中') === 0) { geoOn = true; setBle(s); } });
  }

  $('btnBle').onclick = connectBle;
  $('btnBleOff').onclick = () => {
    try { if (device) device.gatt.disconnect(); } catch (e) {}
    device = null;
    setBle('徕卡已断开');
  };
})();
