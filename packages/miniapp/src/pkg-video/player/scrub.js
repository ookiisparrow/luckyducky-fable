/**
 * 进度条触点定位（纯函数）——点按/拖拽进度条时，把触点屏幕坐标换算成目标播放时间。
 *
 * 抽成纯函数单独可单测：钳位边界（拖出条左/条右、无 rect、无时长）最易出错（根因#8）；
 * 播放器只负责拿 rect（createSelectorQuery 量进度条）+ 触点 clientX，调它得到 seek 目标。
 *
 * @param {number} clientX 触点屏幕 X（touches[0].clientX）
 * @param {{left:number,width:number}} rect 进度条 boundingClientRect
 * @param {number} duration 当前段总时长（秒）
 * @returns {number|null} 钳位到 0~duration 的目标时间；无法换算（无 rect/无时长/x 非数）→ null
 */
export function scrubTimeAt(clientX, rect, duration) {
  if (typeof clientX !== 'number' || !rect || !(rect.width > 0) || !(duration > 0)) return null
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return ratio * duration
}
