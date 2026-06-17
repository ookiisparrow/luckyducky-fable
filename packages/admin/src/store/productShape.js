/**
 * 商品形状的纯逻辑（无云依赖）：步骤名 / 新建骨架 / 脏数据归一化 / 每步完成判定。
 * 从 store/products.js 抽出——store 引云 API（@/api/cloud），纯逻辑独立才能被测试直接 import
 * 而不连带拉云依赖链（B8d 基线）。store 仍 re-export 这些，调用方无需改 import。
 */
export const STEP_NAMES = ['产品图片', '商品信息', '商品 SKU', '教学视频', '二维码卡片', '码批次与印刷包']

export function newProduct() {
  const id = 'p' + Date.now().toString(36)
  return {
    id,
    cover: '', // 封面图（商品的「脸」：列表卡与详情头图）；云模式为 fileID
    images: [], // 其余图（有序）
    name: '',
    price: '',
    was: '',
    tag: '',
    brief: '',
    skus: [], // [{ name, price }]
    params: [], // 详情参数表 [[k, v]]
    detailSections: [], // 详情段落 [{ lead, body }]（配图自动取其余图第 N 张）
    kit: [], // 套装清单 [{ icon, name, qty }]
    courseId: '', // 配套课程（步骤④ 首次进入时生成 course-<pid>）
    videoStats: null, // { total, done } 由步骤④ 保存草稿时同步
    cardStatus: '', // 步骤⑤ 卡面状态（draft/final）
    batchCount: 0, // 步骤⑥ 已有码批次数
    status: 'preparing', // preparing 筹备中 | onsale 在售
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// 云端来的商品归一化：保证数组字段恒为数组。productsDraft 可能存在缺字段的脏商品
// （旧 schema / 半建 / 控制台手改），ProductList 模板 `p.skus.length`、stepDone 的
// `p.skus.every` 遇 undefined 即抛错 → 整页白屏（根因#8·同调试日志 Q 订单白屏）。
// 入库边界一处收口，列表/向导/进度判定都拿到安全形状。
export function normalizeProduct(p) {
  const o = p && typeof p === 'object' ? p : {}
  const arr = (v) => (Array.isArray(v) ? v : [])
  return {
    ...o,
    images: arr(o.images),
    skus: arr(o.skus),
    params: arr(o.params),
    detailSections: arr(o.detailSections),
    kit: arr(o.kit),
  }
}

// 每步是否已完成（向导圆点与列表进度共用一套判定）
export function stepDone(p, n) {
  switch (n) {
    case 1:
      return !!p.cover
    case 2:
      return !!(p.name && p.price)
    case 3:
      return p.skus.length > 0 && p.skus.every((s) => s.name && s.price)
    case 4:
      // 视频编排：StepVideos 保存草稿时同步 videoStats = { total, done }
      return !!(p.videoStats && p.videoStats.total > 0 && p.videoStats.done >= p.videoStats.total)
    case 5:
      return p.cardStatus === 'final' // 卡面已定稿
    case 6:
      return (p.batchCount || 0) > 0 // 已有码批次
    default:
      return false
  }
}
