/* 蓝牙协议解析：纯函数，无 DOM 依赖 */
(function () {
  function decode(dv, uuid) {
    const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    const hex = Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const dist = dv.byteLength >= 4 ? dv.getFloat32(0, true) : NaN;
    return { hex, dist, uuid: (uuid || '').slice(4, 8), bytes: dv.byteLength };
  }

  function isMeasurement(dist) {
    return isFinite(dist) && dist > 0.001 && dist < 10000;
  }

  window.BLE_PROTO = { decode, isMeasurement };
})();
