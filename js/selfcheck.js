/* 运行时自检：?selfcheck=1 */
(function () {
  if (!location.search.includes('selfcheck')) return;
  setTimeout(() => {
    const out = [];
    try {
      const unbound = [];
      document.querySelectorAll('button').forEach(b => {
        const handled = !!b.onclick || b.dataset.mode !== undefined;
        if (!handled) unbound.push(b.id || (b.textContent || '').trim());
      });
      out.push('未绑定按钮: ' + (unbound.length ? unbound.join(',') : '无'));
    } catch (e) { out.push('按钮检查失败:' + e.message); }
    try {
      const r = window.UOM.uoMatch([5, 3, 1, 2, 1], 15, 'full');
      const cls = c => (String(c.template || '') + String(c.name || '')).match(/T|矩形/) ? '外凸' : '内凹';
      const cnt = {};
      r.candidates.forEach(c => { const k = cls(c); cnt[k] = (cnt[k] || 0) + 1; });
      out.push('5边候选: ' + JSON.stringify(cnt) + ' 总数=' + r.candidates.length);
    } catch (e) { out.push('候选统计失败:' + e.message); }
    const el = document.getElementById('list');
    if (el) el.textContent = 'SELFCHECK: ' + out.join(' ; ');
  }, 400);
})();
