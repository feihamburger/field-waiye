/* GPS 采集：持续定位，取最近样本中位数，供“收到测量瞬间”的方向计算 */
(function () {
  const samples = [];
  let last = null;
  let watching = false;
  let statusCb = null;
  let lastErr = null;

  function median(arr) {
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function start(cb) {
    statusCb = cb || null;
    if (!navigator.geolocation) { if (statusCb) statusCb('本机不支持定位'); return; }
    if (watching) return;
    watching = true;
    navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      samples.push({ lat: c.latitude, lng: c.longitude, acc: c.accuracy, t: Date.now() });
      while (samples.length > 40) samples.shift();
      last = samples[samples.length - 1];
      if (statusCb) statusCb('定位中 ±' + Math.round(c.accuracy) + ' m');
    }, (err) => {
      lastErr = err;
      const msg = err && err.code === 1 ? '定位权限被拒绝，请在浏览器设置里允许位置'
        : err && err.code === 2 ? '定位不可用（系统定位关闭？）'
        : '定位超时，走到开阔处重试';
      if (statusCb) statusCb('定位失败：' + msg);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }

  function current() {
    if (!last) return null;
    const recent = samples.filter(s => Date.now() - s.t < 30000);
    if (!recent.length) return last;
    return {
      lat: median(recent.map(s => s.lat)),
      lng: median(recent.map(s => s.lng)),
      acc: median(recent.map(s => s.acc)),
      t: recent[recent.length - 1].t,
      n: recent.length,
    };
  }

  function distM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const la = a.lat * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearing(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
              Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  window.GEO = {
    start, current, distM, bearing, samples,
    get lastError() { return lastErr; },
    get active() { return watching; },
  };
})();
