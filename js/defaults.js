// 默认属性表（宅基地模式）
// 说明：只记录属性，不参与长度换算；具体含义由业务定义。
window.DEFAULT_ADJ_TABLE = {
  floor1_outline: '+0+0',   // 一层外墙轮廓
  floor1_split: '+0+0',     // 一层外墙手动/自动分割产生的段
  floor1_total: '+0+0',     // 一层分割产生的总长记录
  balcony_split: '++',      // 阳台切出的短墙段
  upper_outline: '+0+0',    // 二层及以上轮廓
  upper_inner: '++',        // 二层及以上内部长
  roof_outline: '+0+0',     // 天面轮廓
  stair: '+0+0',            // 天面梯屋折线
  neighbor_stair: '',       // 邻墙梯屋短段（不可测量，不设属性）
};

// 宅基地模式下，空属性统一按 +0+0 记录
window.defAdj = function (key) {
  const t = window.DEFAULT_ADJ_TABLE || {};
  if (key && t[key]) return t[key];
  return (window.S && window.S.app === 'zh') ? '+0+0' : '';
};
