// 备份默认集合清单（db-export.mjs 消费）。挑 P0 关键子集而非全量 37 集合——理由见
// docs/重构日志.md 本批条目：全量镜像清单会重蹈「样板复制即漂移」（根因#5）覆辙，需要时
// 用 --collections 显式指定即可，不预先立一份用不上的全量维护负担（YAGNI）。
//
// 挑选标准：身份 / 交易 / 权益凭证 / UGC 类——丢了无法从别处重建（商品/课程内容有源文件/
// 种子数据可重建，故不进默认清单）。
//
// 【手工对齐提醒】与 rewrite/shared/src/collections.ts 的 COLLECTIONS 手工对齐、未做跨语言
// import（该文件是 .ts，本仓 .mjs 脚本不能直接 import）——新增/改名集合需同步维护本清单，
// tests/scripts/db-backup-collections.test.js 用文本 grep 交叉核验防手抄漂移。
export const DEFAULT_COLLECTIONS = [
  'users', // 身份主档，openid↔用户唯一映射，无法从别处重建
  'orders', // 交易记录，唯一收入/履约凭证
  'afterSales', // 售后/退款记录，钱链留痕
  'activations', // 课程/权益激活凭证，用户已付费权益的唯一证明
  'inventory', // 库存台账，供应链状态单源
  'progress', // 用户学习进度，UGC 无法从别处重建
  'reviews', // 商品评价，UGC
  'checkpoints', // 学习打卡记录，UGC
  'feedback', // 用户反馈，UGC
  'qrcodes', // 权益二维码/核销凭证
]

// 明文凭证集合（见 rewrite/cloud/src/kit/secureConfig.ts）——默认排除，避免备份文件本身
// 变成一份新的泄漏面；需要时须显式 --include-secrets 加回。
export const SECRET_COLLECTIONS = ['secureConfig']

// 纯函数：给 CLI argv 解析结果，返回最终导出集合清单。
// 无 --collections → DEFAULT_COLLECTIONS；有 → 按逗号切分（不校验集合是否真实存在，交给
// manager.database.export 调用时的真实报错兜底）。含 secureConfig 且未显式 includeSecrets
// → 剔除并标 droppedSecrets:true，供调用方打印提示。
export function resolveCollections({ collections, includeSecrets } = {}) {
  let list
  if (!collections) {
    list = [...DEFAULT_COLLECTIONS]
  } else {
    list = String(collections)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  let droppedSecrets = false
  if (!includeSecrets) {
    const before = list.length
    list = list.filter((c) => !SECRET_COLLECTIONS.includes(c))
    if (list.length !== before) droppedSecrets = true
  }

  return { list, droppedSecrets }
}
