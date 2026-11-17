/* 蓝牙连接层：网页版 Web Bluetooth 实现；将来 App 版换同名接口即可 */
(function () {
  const SERVICE = '3ab10100-f831-4395-b29d-570977d5bf94';
  const MEASURE = '3ab1010d-f831-4395-b29d-570977d5bf94';
  let hooks = null;

  function logPackets() {
    const st = hooks && hooks.state;
    const el = document.getElementById('bleLog');
    if (!st || !el || el.style.display === 'none') return;
    el.textContent = (st.blePackets || []).map((p, i) =>
      `${i + 1}. [${p.uuid}] f32=${isFinite(p.dist) ? p.dist.toFixed(4) : 'NaN'}  ${p.hex}`
    ).join('\n');
    el.scrollTop = el.scrollHeight;
  }

  async function connect() {
    if (!navigator.bluetooth) {
      alert('当前浏览器不支持 Web Bluetooth。\n请用安卓 Chrome/Edge，并通过 https 打开本页。');
      return;
    }
    try {
      hooks.setBle('搜索设备…');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE] }],
        optionalServices: [SERVICE],
      });
      hooks.state.bleDevice = device;
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(SERVICE);
      const chars = await svc.getCharacteristics();
      let subs = 0;
      const onPacket = (ev) => {
        try {
          const p = window.BLE_PROTO.decode(ev.target.value, ev.target.uuid);
          const S = hooks.state;
          S.blePackets.push({ t: Date.now(), uuid: p.uuid, hex: p.hex, dist: p.dist });
          if (S.blePackets.length > 40) S.blePackets.shift();
          logPackets();
          window.__lastBlePacket = p;
          if (window.BLE_PROTO.isMeasurement(p.dist)) {
            hooks.onMeasure(p.dist);
            hooks.setStatus(`收到 ${p.dist.toFixed(4)} m`);
          } else {
            window.__lastZero = p;
          }
        } catch (err) {
          hooks.setStatus('蓝牙数据解析失败: ' + err.message);
        }
      };
      for (const ch of chars) {
        try {
          if (!ch.properties || !(ch.properties.notify || ch.properties.indicate)) continue;
          ch.addEventListener('characteristicvaluechanged', onPacket);
          await ch.startNotifications();
          subs++;
        } catch (e) { /* 某个通道不支持就跳过 */ }
      }
      window.__bleChars = chars.map(c => ({ uuid: c.uuid.slice(4, 8), props: c.properties }));
      hooks.setStatus(`已订阅 ${subs} 个通知通道`);
      if (!subs) {
        const ch = await svc.getCharacteristic(MEASURE);
        ch.addEventListener('characteristicvaluechanged', onPacket);
        await ch.startNotifications();
        subs = 1;
      }
      hooks.setBle('徕卡已连接', true);
      window.__bleInfo = chars.map(c => c.uuid.slice(4, 8) +
        (c.properties && c.properties.notify ? 'N' : '') +
        (c.properties && c.properties.read ? 'R' : '') +
        (c.properties && c.properties.write ? 'W' : '')).join(',');
      hooks.setStatus('蓝牙已连接：选中线段/注记后按测距仪');
    } catch (e) {
      hooks.setBle('蓝牙未连接');
      alert('连接失败：' + (e.message || e));
    }
  }

  function disconnect() {
    try { if (hooks && hooks.state.bleDevice) hooks.state.bleDevice.gatt.disconnect(); } catch (e) {}
    if (hooks) hooks.setBle('蓝牙未连接');
  }

  window.BLE = {
    impl: 'web-bluetooth',
    init(h) { hooks = h; },
    connect,
    disconnect,
    logPackets,
  };
})();
