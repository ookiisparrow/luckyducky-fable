/**
 * 导航工具。集中「返回」逻辑——栈里有上一页就 navigateBack，
 * 否则(被直接打开/深链)reLaunch 到兜底页。各页只需传自己的兜底路径。
 */
export function goBack(fallback = '/pages/index/index') {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: fallback })
}
