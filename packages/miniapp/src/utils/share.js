/**
 * 分享卡构造（R29 / 占位⑩）。纯函数叶子（T4：utils 不依赖 store/data），入参是普通对象，
 * 出参贴 onShareAppMessage 的返回形状 { title, path, imageUrl }，便于页面直接 return + 单测。
 *
 * imageUrl 仅在是 http(s) 网络图时透传——商品封面多为云存储 fileID（cloud://…），微信分享卡
 * imageUrl 渲不出，留空即用当前页截图兜底（更稳，避免传无效地址）。
 */
const DEFAULT_TITLE = '幸运小鸭 · 钩织材料包'

export function buildProductShare({ id, name, image } = {}) {
  const useImg = typeof image === 'string' && /^https?:\/\//.test(image)
  return {
    title: (name && String(name).trim()) || DEFAULT_TITLE,
    path: `/pages/detail/index?id=${encodeURIComponent(id || '')}`,
    imageUrl: useImg ? image : '',
  }
}
