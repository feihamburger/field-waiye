/* 手机 ↔ 平板 数据中转（MQTT over WebSocket，公共 broker）
   用途：手持测距仪的“手机端”把测量值发给“平板端”，避免平板与徕卡超距离。
   主题：waice/<配对码>/meas
*/
(function () {
  const BROKER = 'wss://broker.emqx.io:8084/mqtt';
  let client = null;
  let opts = null;
  let topic = null;
  let last = null;   // {code, role}

  function init(o) {
    opts = o || {};               // { onMessage(obj), onStatus(str) }
  }

  function status(msg) {
    if (opts && opts.onStatus) opts.onStatus(msg);
  }

  function connect(code, role) {
    disconnect();
    topic = 'waice/' + code + '/meas';
    last = { code, role };
    status('正在连接中转服务…');
    try {
      client = window.mqtt.connect(BROKER, {
        clientId: 'waice_' + role + '_' + Math.random().toString(16).slice(2, 10),
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000,
      });
    } catch (e) {
      status('连接失败：' + e.message);
      return;
    }
    client.on('connect', () => {
      status('中转已连接（' + role + '），配对码 ' + code);
      if (role === 'tablet') {
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) status('订阅失败：' + err.message);
          else status('等待手机数据…（配对码 ' + code + '）');
        });
      }
    });
    client.on('message', (t, payload) => {
      try {
        const obj = JSON.parse(payload.toString());
        if (opts && opts.onMessage) opts.onMessage(obj);
      } catch (e) { /* 忽略非 JSON */ }
    });
    client.on('error', (e) => status('中转错误：' + (e.message || e)));
    client.on('offline', () => status('中转离线，重连中…'));
  }

  function publish(obj) {
    if (!client || !topic) return false;
    try {
      client.publish(topic, JSON.stringify(obj), { qos: 0 });
      return true;
    } catch (e) { return false; }
  }

  function disconnect() {
    try { if (client) client.end(true); } catch (e) {}
    client = null;
  }

  function ensure() {
    if (!last) return;
    if (!client) { connect(last.code, last.role); return; }
    try { if (!client.connected) client.reconnect(); } catch (e) {}
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) ensure();
    });
  }

  window.RELAY = {
    init, connect, publish, disconnect, status, ensure,
    get active() { return !!client; },
    BROKER,
  };
})();
