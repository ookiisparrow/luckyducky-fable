/**
 * 中文快递公司名 → 快递100 编码（com，小写）。
 * 订单 shipping.company 存中文（卖家发货时填，如「顺丰」），快递100 插件结果页要编码（如 shunfeng）。
 * 模糊匹配（含关键字即命中），覆盖常用快递；未命中返回 ''——调用方回退复制运单号（R17/占位③）。
 * 编码取自快递100 公开编码表；新增快递在此加一行即可。
 */
const EXPRESS_CODES = [
  ['顺丰', 'shunfeng'],
  ['圆通', 'yuantong'],
  ['中通', 'zhongtong'],
  ['申通', 'shentong'],
  ['韵达', 'yunda'],
  ['京东', 'jd'],
  ['极兔', 'jtexpress'],
  ['百世', 'huitongkuaidi'],
  ['汇通', 'huitongkuaidi'],
  ['德邦', 'debangkuaidi'],
  ['天天', 'tiantian'],
  ['EMS', 'ems'],
  ['邮政', 'youzhengguonei'],
]

export function expressCode(name) {
  if (!name) return ''
  const s = String(name)
  for (const [key, code] of EXPRESS_CODES) {
    if (s.includes(key)) return code
  }
  return ''
}
