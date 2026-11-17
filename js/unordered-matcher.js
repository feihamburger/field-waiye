/* 无序识别：模板匹配（纯数学，无 DOM 依赖） */
(function () {
const UO_TEMPLATES = {
  rect: {
    name: '矩形', n: 4, params: ['a', 'b'],
    edges: [[1,0],[0,1],[1,0],[0,1]],
    build: p => [[0,0],[p.a,0],[p.a,p.b],[0,p.b]],
    valid: p => p.a > 0.2 && p.b > 0.2,
  },
  L: {
    name: 'L 形', n: 6, params: ['W','H','nw','nh'],
    edges: [[1,0,0,0],[0,1,0,-1],[0,0,1,0],[0,0,0,1],[1,0,-1,0],[0,1,0,0]],
    build: p => [[0,0],[p.W,0],[p.W,p.H-p.nh],[p.W-p.nw,p.H-p.nh],[p.W-p.nw,p.H],[0,p.H]],
    valid: p => p.W > 0.4 && p.H > 0.4 && p.nw > 0.1 && p.nh > 0.1 &&
                p.W - p.nw > 0.1 && p.H - p.nh > 0.1,
  },
  U: {
    name: 'U 形', n: 8, params: ['W','H','rw','hb','lw'],
    edges: [[1,0,0,0,0],[0,1,0,0,0],[0,0,1,0,0],[0,1,0,-1,0],[1,0,-1,0,-1],[0,1,0,-1,0],[0,0,0,0,1],[0,1,0,0,0]],
    build: p => [[0,0],[p.W,0],[p.W,p.H],[p.W-p.rw,p.H],[p.W-p.rw,p.hb],[p.lw,p.hb],[p.lw,p.H],[0,p.H]],
    valid: p => p.W > 1 && p.H > p.hb + 0.2 && p.rw > 0.2 && p.lw > 0.2 && p.hb > 0.1 &&
                p.W - p.rw - p.lw > 0.2,
  },
  stair: {
    name: '阶梯形', n: 8, params: ['W','H','w1','w2','h1','h2'],
    edges: [[1,0,0,0,0,0],[0,1,0,0,0,0],[1,0,-1,-1,0,0],[0,1,0,0,0,-1],[0,0,0,1,0,0],[0,0,0,0,-1,1],[0,0,1,0,0,0],[0,0,0,0,1,0]],
    build: p => [[0,0],[p.W,0],[p.W,p.H],[p.W-p.w1-p.w2,p.H],[p.W-p.w1-p.w2,p.h2],[p.w1,p.h2],[p.w1,p.h1],[0,p.h1]],
    valid: p => p.W > 1 && p.H > p.h2 + 0.2 && p.h2 > p.h1 + 0.1 && p.h1 > 0.1 &&
                p.w1 > 0.1 && p.w2 > 0.1 && p.W - p.w1 - p.w2 > 0.1,
  },
  T: {
    name: 'T 形', n: 8, params: ['W','H','th','sw','x'],
    edges: [[1,0,0,0,0],[0,1,-1,0,0],[1,0,0,-0.5,-1],[0,0,1,0,0],
            [0,0,0,1,0],[0,0,1,0,0],[0,0,0,-0.5,1],[0,1,-1,0,0]],
    build: p => [[0,0],[p.W,0],[p.W,p.H-p.th],[p.x+p.sw/2,p.H-p.th],
                 [p.x+p.sw/2,p.H],[p.x-p.sw/2,p.H],[p.x-p.sw/2,p.H-p.th],[0,p.H-p.th]],
    valid: p => p.W > 1 && p.H > p.th + 0.2 && p.th > 0.2 && p.sw > 0.2 &&
                p.x - p.sw/2 > 0.1 && p.W - (p.x + p.sw/2) > 0.1,
  },
};

function uoPermute(arr) {
  const out = [];
  const n = arr.length;
  const used = new Array(n).fill(false);
  const cur = [];
  (function rec() {
    if (cur.length === n) { out.push(cur.slice()); return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; cur.push(arr[i]);
      rec();
      cur.pop(); used[i] = false;
    }
  })();
  return out;
}

function uoSolveLS(edges, y) {
  const n = edges.length, k = edges[0].length;
  const ata = Array.from({ length: k }, () => new Array(k).fill(0));
  const aty = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < k; r++) {
      aty[r] += edges[i][r] * y[i];
      for (let c = 0; c < k; c++) ata[r][c] += edges[i][r] * edges[i][c];
    }
  }
  for (let r = 0; r < k; r++) ata[r][r] += 1e-9;
  const m = ata.map((row, r) => row.concat([aty[r]]));
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    const pv = m[col][col];
    for (let c = col; c <= k; c++) m[col][c] /= pv;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (!f) continue;
      for (let c = col; c <= k; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map(row => row[k]);
}

function uoArea(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function uoSimple(v) {
  const n = v.length;
  const cross = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n], c = v[(i + 2) % n];
    if (Math.abs(cross(a, b, c)) < 1e-9) return false;
  }
  return uoArea(v) > 0.3;
}

// 最少边模板：矩形 2 个、L/U/T 4 个、阶梯形 6 个（顺序随意）
const UO_MINIMAL = {
  rect: {
    name: '矩形', n: 2, params: ['a', 'b'],
    build: p => [[0,0],[p.a,0],[p.a,p.b],[0,p.b]],
    valid: p => p.a > 0.2 && p.b > 0.2,
  },
  L: {
    name: 'L 形', n: 4, params: ['W', 'Hnh', 'nw', 'nh'],
    build: p => [[0,0],[p.W,0],[p.W,p.Hnh],[p.W-p.nw,p.Hnh],[p.W-p.nw,p.Hnh+p.nh],[0,p.Hnh+p.nh]],
    valid: p => p.W > p.nw + 0.1 && p.nw > 0.1 && p.nh > 0.1 && p.Hnh > 0.1,
  },
  stair: {
    name: '阶梯形', n: 6, params: ['W', 'H', 'Wtop', 'Hright', 'w2', 'h2h1'],
    build: p => [[0,0],[p.W,0],[p.W,p.H],[p.W-p.Wtop,p.H],[p.W-p.Wtop,p.H-p.Hright],[p.w2,p.H-p.Hright],[p.w2,p.H-p.Hright-p.h2h1],[0,p.H-p.Hright-p.h2h1]],
    valid: p => p.W > p.Wtop + p.w2 + 0.1 && p.Wtop > 0.1 && p.w2 > 0.1 &&
                p.Hright > 0.1 && p.h2h1 > 0.1 && p.H > p.Hright + p.h2h1 + 0.1,
  },
};

function uoMatchMinimal(vals) {
  const n = vals.length;
  const out = [];
  for (const key of Object.keys(UO_MINIMAL)) {
    const tpl = UO_MINIMAL[key];
    if (tpl.n !== n) continue;
    // 参数就是这些长度本身，排列尝试
    for (const perm of uoPermute(vals)) {
      const p = {};
      tpl.params.forEach((name, i) => { p[name] = perm[i]; });
      if (!tpl.valid(p)) continue;
      const verts = tpl.build(p);
      if (!uoSimple(verts)) continue;
      const area = uoArea(verts);
      if (area < 0.5) continue;
      {
        const maxIn = Math.max(...vals);
        const ed = verts.map((v, i) => {
          const w = verts[(i + 1) % verts.length];
          return Math.hypot(w[0] - v[0], w[1] - v[1]);
        });
        if (Math.max(...ed) > maxIn + 0.01) continue;
      }
      out.push({
        template: key, name: tpl.name, params: p, vertices: verts,
        residual_mm: 0, area,
        assignment: verts.map((v, i) => {
          const w = verts[(i + 1) % verts.length];
          return { measured: null, fitted: Math.hypot(w[0]-v[0], w[1]-v[1]) };
        }),
      });
      break; // 同模板只取一个排列
    }
  }
  out.sort((a, b) => b.area - a.area);
  return { candidates: out.slice(0, 6) };
}

function uoCombos(n, k) {
  const out = [];
  const cur = [];
  (function rec(start) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < n; i++) { cur.push(i); rec(i + 1); cur.pop(); }
  })(0);
  return out;
}

// 5 条边：一般 U/T（含偏心），枚举“哪 5 条边 + 顺序”
// 5 条实体墙边：U（W,H,rw,lw,hh）与 T（W,Hth,sw,a,th），全部是图上真实墙边
const UO5 = {
  U: {
    name: 'U 形', params: ['W','H','rw','lw','hh'],
    build: p => [[0,0],[p.W,0],[p.W,p.H],[p.W-p.rw,p.H],[p.W-p.rw,p.H-p.hh],
                 [p.lw,p.H-p.hh],[p.lw,p.H],[0,p.H]],
    valid: p => p.W > p.rw + p.lw + 0.1 && p.H > p.hh + 0.1 && p.rw > 0.05 && p.lw > 0.05 && p.hh > 0.05,
  },
  T: {
    name: 'T 形', params: ['W','Hth','sw','a','th'],
    build: p => [[0,0],[p.W,0],[p.W,p.Hth],[p.a+p.sw,p.Hth],[p.a+p.sw,p.Hth+p.th],
                 [p.a,p.Hth+p.th],[p.a,p.Hth],[0,p.Hth]],
    valid: p => p.W > p.a + p.sw + 0.1 && p.a > 0.05 && p.Hth > 0.05 && p.th > 0.05 && p.sw > 0.05,
  },
};

function uoMatch5(vals, tpl, tolMm) {
  const res = [];
  const seen = new Set();
  const maxIn = Math.max(...vals);
  for (const perm of uoPermute(vals)) {
    const p = {};
    tpl.params.forEach((name, i) => { p[name] = perm[i]; });
    if (!tpl.valid(p)) continue;
    const verts = tpl.build(p);
    if (!uoSimple(verts)) continue;
    const area = uoArea(verts);
    if (area < 0.5) continue;
    const ed = verts.map((v, i) => {
      const w = verts[(i + 1) % verts.length];
      return Math.hypot(w[0] - v[0], w[1] - v[1]);
    });
    if (Math.max(...ed) > maxIn + 0.02) continue;
    const key = tpl.name + '|' + tpl.params.map(nm => p[nm].toFixed(2)).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    res.push({
      template: tpl.name, name: tpl.name + '（5 条实体边）', params: p, vertices: verts,
      residual_mm: 0, area,
      assignment: ed.map(L => ({ measured: null, fitted: L })),
    });
  }
  res.sort((a, b) => b.area - a.area);
  return res;
}

function uoMatch(lengths, tolMm = 15, mode = 'both') {
  const vals = lengths.filter(v => v > 0);
  const n = vals.length;
  if (![2, 4, 5, 6, 8].includes(n)) {
    return { error: '支持 2/4/5/6/8 个长度：2 矩形、4 L、5 一般 U/T、6 L/阶梯、8 U/T/阶梯', candidates: [] };
  }
  let res = [];
  // 2/4/6：最少边（矩形 / L / 阶梯）
  if (n === 2 || n === 4 || n === 6) res = uoMatchMinimal(vals).candidates;
  // 5：一般 U / T（不假设对称，枚举任取 5 条边）
  if (n === 5) {
    res = res.concat(uoMatch5(vals, UO5.U, tolMm));
    res = res.concat(uoMatch5(vals, UO5.T, tolMm));
  }
  // 全参数模板（4/6/8）
  if (n === 4 || n === 6 || n === 8) {
    const found = new Map();
    for (const key of Object.keys(UO_TEMPLATES)) {
      const tpl = UO_TEMPLATES[key];
      if (tpl.n !== n) continue;
      for (const perm of uoPermute(vals)) {
        const x = uoSolveLS(tpl.edges, perm);
        if (!x) continue;
        const p = {};
        tpl.params.forEach((name, i) => { p[name] = x[i]; });
        if (!tpl.valid(p)) continue;
        const fit = tpl.edges.map(row => row.reduce((s, c, j) => s + c * x[j], 0));
        const s2 = fit.reduce((s, f, i) => s + (f - perm[i]) ** 2, 0);
        const resMm = Math.sqrt(s2 / n) * 1000;
        if (resMm > tolMm) continue;
        const verts = tpl.build(p);
        if (!uoSimple(verts)) continue;
        const area = uoArea(verts);
        if (area < 0.5) continue;
      {
        const maxIn = Math.max(...vals);
        const ed = verts.map((v, i) => {
          const w = verts[(i + 1) % verts.length];
          return Math.hypot(w[0] - v[0], w[1] - v[1]);
        });
        if (Math.max(...ed) > maxIn + 0.01) continue;
      }
        const k2 = key + '|' + tpl.params.map(nm => p[nm].toFixed(2)).join(',');
        if (found.has(k2) && found.get(k2).residual_mm <= resMm) continue;
        found.set(k2, {
          template: key, name: tpl.name, params: p, vertices: verts,
          residual_mm: resMm, area,
          assignment: perm.map((meas, i) => ({ measured: meas, fitted: fit[i] })),
        });
      }
    }
    res = res.concat([...found.values()]);
  }
  const seen = new Set();
  const merged = [];
  for (const c of res) {
    const k = c.template + '|' + c.params && Object.keys(c.params).map(nm => c.params[nm].toFixed(2)).join(',');
    const key = c.template + '|' + c.vertices.map(v => v.map(x => x.toFixed(2)).join(',')).join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  merged.sort((a, b) => Math.round(a.residual_mm) - Math.round(b.residual_mm) || b.area - a.area);
  return { candidates: merged };
}

  window.UOM = { uoMatch, uoPermute, uoSolveLS, uoArea, uoSimple, UO_TEMPLATES, UO_MINIMAL, UO5 };
})();
