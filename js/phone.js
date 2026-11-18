/* 手机端：连徕卡 → 读数 → 通过 MQTT 发给平板 */
(function () {
  const SERVICE = '3ab10100-f831-4395-b29d-570977d5bf94';
  const MEASURE = '3ab1010d-f831-4395-b29d-570977d5bf94';
  const $ = (id) => document.getElementById(id);
  const setStatus = (s) => { $('status').textContent = s; };
  let device = null, code = '';

  if (window.RELAY) {
    window.RELAY.init({
      onStatus: (s) => setStatus(s),
      onMessage: () => {},
    });
  }

  $('btnRelay').onclick = () => {
    code = ($('code').value || '').trim();
    if (!/^\d{3,6}$/.test(code)) { setStatus('请先输入 3~6 位配对码'); return; }
    window.RELAY.connect(code, 'phone');
  };
  $('btnRelayOff').onclick = () => { window.RELAY.disconnect(); setStatus('已断开中转'); };

  async function connectBle() {
    if (!navigator.bluetooth) { alert('此浏览器不支持蓝牙，请用 Chrome/Edge 并通过 https 或 localhost 打开'); return; }
    try {
      setStatus('搜索徕卡…');
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
        const ok = window.RELAY.publish({ type: 'meas', t: Date.now(), len, hex });
        addRow(len, ok);
        setStatus(ok ? '已发送 ' + len.toFixed(4) + ' m' : '蓝牙收到，但中转未连接：' + len.toFixed(4) + ' m');
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
      setStatus('徕卡已连接，按测量键发送');
    } catch (e) {
      setStatus('连接失败：' + (e.message || e));
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

  $('btnBle').onclick = connectBle;
  $('btnBleOff').onclick = () => {
    try { if (device) device.gatt.disconnect(); } catch (e) {}
    device = null;
    setStatus('徕卡已断开');
  };
})();
