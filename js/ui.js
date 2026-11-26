/* 列表/长度修正：itemOf、墙厚修正、列表渲染（依赖注入） */
(function () {
  let hooks = null;
  const Sget = () => hooks.getState();
// ---------- 列表 ----------
function itemOf(sel) {
  if (!sel) return null;
  const S = Sget();
  if (sel.kind === 'seg') return S.segments[sel.idx];
  if (sel.kind === 'note') return S.notes[sel.idx];
  if (sel.kind === 'total') return S.totals[sel.idx];
  return null;
}

function thicknessM() {
  const v = parseFloat(hooks.$('thick').value);
  return isNaN(v) ? 0 : Math.max(0, v / 100);
}

function effLen(it) {
  if (it.len == null) return null;
  return it.len + (it.adj || '').split('+').length - 1 + 0; // placeholder, replaced below
}

function nPlus(adj) { return (adj || '').split('+').length - 1; }

function thicknessMOf(it) {
  if (it && it.thickCm != null && !isNaN(it.thickCm)) return Math.max(0, it.thickCm / 100);
  return thicknessM();
}

function corrected(it) {
  if (it.len == null) return null;
  return it.len + nPlus(it.adj) * thicknessMOf(it);
}

function totalOk(tt) {
  const S = Sget();
  if (tt.len == null || !tt.children) return true;
  const kids = tt.children.map(cid => S.segments.find(x => x.id === cid)).filter(Boolean);
  if (!kids.length || !kids.every(k => k.len != null)) return true;
  const sum = kids.reduce((a, k) => a + (k.len || 0), 0);
  return Math.abs(sum - tt.len) <= 0.01;
}

function refreshList() {
    const S = hooks.getState();
  try {
    if (S.selected) {
      const it = itemOf(S.selected);
      hooks.$('adj').value = it && it.adj ? it.adj : '+0+0';
    }
  } catch (e) {}
  const list = hooks.$('list');
  list.innerHTML = '';
  S.segments.forEach((sg, i) => {
    if (sg.neighborStair || sg.neighborWall) return;
    const div = document.createElement('div');
    div.className = 'row' + (S.selected && S.selected.kind === 'seg' && S.selected.idx === i ? ' sel' : '');
    const val = sg.len == null ? '?' : sg.len.toFixed(3) + ' m';
    const corr = sg.len != null && sg.adj ? ` → ${corrected(sg).toFixed(3)} m` : '';
    const ph = sg.photo ? ' 📷' : '';
    div.innerHTML = `<span>段${i + 1}<span class="tag"> ${sg.adj || ''}${ph}</span></span>
                     <span class="val">${val}${corr}</span>`;
    div.onclick = () => { S.selected = { kind: 'seg', idx: i }; window.WS.render(); refreshList(); };
    list.appendChild(div);
  });
  S.notes.forEach((nt, i) => {
    const div = document.createElement('div');
    div.className = 'row' + (S.selected && S.selected.kind === 'note' && S.selected.idx === i ? ' sel' : '');
    let txt = nt.len == null ? '?' : nt.len.toFixed(3) + ' m';
    if (nt.adj) txt = `${nt.adj[0]} ${txt} ${nt.adj[1] || ''}`;
    const ph = nt.photo ? ' 📷' : '';
    div.innerHTML = `<span>点${i + 1}<span class="tag"> ${ph}</span></span><span class="val">${txt}</span>`;
    div.onclick = () => { S.selected = { kind: 'note', idx: i }; window.WS.render(); refreshList(); };
    list.appendChild(div);
  });
  S.totals.forEach((tt, i) => {
    const div = document.createElement('div');
    div.className = 'row' + (S.selected && S.selected.kind === 'total' && S.selected.idx === i ? ' sel' : '');
    const val = (tt.len == null ? '?' : tt.len.toFixed(3) + ' m') + (totalOk(tt) ? '' : ' !');
    div.innerHTML = `<span>总长${i + 1}<span class="tag"> ${tt.adj || ''}</span></span>
                     <span class="val">${val}</span>`;
    div.onclick = () => { S.selected = { kind: 'total', idx: i }; window.WS.render(); refreshList(); };
    list.appendChild(div);
  });
  if (!S.segments.length && !S.notes.length && !S.totals.length) {
    list.innerHTML = '<div class="row">暂无数据：先「自动描线」或「手绘」</div>';
  }
  notifyInfoBar();
}

  function notifyInfoBar() {
    try { if (window.INT && window.INT.renderInfoBar) window.INT.renderInfoBar(); } catch (e) {}
  }

  window.UI = {
    init(h) { hooks = h; },
    itemOf,
    thicknessM,
    nPlus,
    corrected,
    refreshList: function () { refreshList(); notifyInfoBar(); },
  };
})();
