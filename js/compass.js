/* 平板指北针：读 DeviceOrientation，提供航向与稳定度 */
(function () {
  let heading = null;
  let last = null;
  let samples = [];
  let started = false;
  let cb = null;

  function norm(a) { return ((a % 360) + 360) % 360; }

  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      h = e.webkitCompassHeading;               // iOS
    } else if (e.absolute && typeof e.alpha === 'number') {
      h = 360 - e.alpha;                        // Android（absolute）
    } else if (typeof e.alpha === 'number') {
      h = 360 - e.alpha;                        // 退路：非 absolute
    }
    if (h == null) return;
    // 屏幕方向补偿（横屏时设备上边缘不是屏幕上方）
    let sa = 0;
    try {
      sa = (screen.orientation && typeof screen.orientation.angle === 'number')
        ? screen.orientation.angle : (window.orientation || 0);
    } catch (err) { sa = 0; }
    if (sa) h = norm(h + sa);
    last = h;
    samples.push({ h, t: Date.now() });
    while (samples.length > 30) samples.shift();
    // 稳定度：最近 2 秒样本离散
    const now = Date.now();
    const recent = samples.filter(s => now - s.t < 2000).map(s => s.h);
    let spread = 0;
    if (recent.length > 2) {
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      spread = Math.max.apply(null, recent.map(x => Math.abs(x - mean)));
    }
    heading = last;
    if (cb) cb({ heading, spread, samples: recent.length });
  }

  function start(callback) {
    cb = callback || null;
    if (started) return;
    started = true;
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
  }

  window.COMPASS = {
    start,
    get heading() { return heading; },
    get spread() {
      const now = Date.now();
      const recent = samples.filter(s => now - s.t < 2000).map(s => s.h);
      if (recent.length < 3) return null;
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      return Math.max.apply(null, recent.map(x => Math.abs(x - mean)));
    },
    get ready() { return heading != null; },
    norm,
  };
})();
