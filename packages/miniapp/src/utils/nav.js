/**
 * 导航工具。集中「返回」逻辑——栈里有上一页就 navigateBack，
 * 否则(被直接打开/深链)reLaunch 到兜底页。各页只需传自己的兜底路径。
 */
export function goBack(fallback = '/pages/index/index') {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: fallback })
}

/**
 * 跳商品详情。详情页按 id 从商品总表(catalog)取数据，name 仅作兜底。
 * 详情导航单一来源（病根#5）——首页卡 / 购物车条目+推荐卡 / 详情「为你推荐」/ 订单复购
 * 都走这里，URL 形状只此一处构造；守卫 detail-nav-single-source 禁别处内联 navigateTo 到详情。
 */
export function goProductDetail(id, name = '') {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}&name=${encodeURIComponent(name)}` })
}
