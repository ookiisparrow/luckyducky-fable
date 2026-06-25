/**
 * 播放器分段导航（纯函数）——「上一段/下一段」= 小段切换、连续跨课时。
 *
 * 规格 R8 原意（设计规格-课程电商系统 §四-5）：段末停 + 「下一段」播本 lesson 的下一个 segment。
 * 用户拍板升级为「连续跨课时」：到本课时最后一段再「下一段」→ 自动进下一课时第一段；
 * 第一段「上一段」→ 回上一课时最后一段。整门课变成连续的小段序列，按钮永远可用直到全课首/末段。
 *
 * 抽成纯函数单独可单测——边界逻辑（跨课时/课程首末/空课时）最易出错（根因#8）；播放器只负责
 * 把返回的 { lessonIdx, segIdx } 落到 idx/fileSeg 并起播。
 *
 * @param {Array} lessons 当前课程拍平课时表（每项含 segments 数组）
 * @param {number} lessonIdx 当前课时下标
 * @param {number} segIdx 当前小段下标
 * @param {number} dir +1=下一段 / -1=上一段
 * @returns {{lessonIdx:number, segIdx:number}|null} 目标位置；全课首段按上一段 / 末段按下一段 → null
 */
export function stepSegment(lessons, lessonIdx, segIdx, dir) {
  if (!Array.isArray(lessons) || !lessons.length) return null
  const segCount = (i) =>
    lessons[i] && Array.isArray(lessons[i].segments) ? lessons[i].segments.length : 0
  // 可播课时：有段 + 每段都有视频（= 播放器 fileMode 口径）。跨课时只落到可播课时——否则会落到
  // 「整理中」占位态（stage==='placeholder'），那里底部上一段/下一段控件全隐藏（v-if stage==='ready'）→
  // 用户被困、回不去原课时（审计 P1·根因#8 真机·半上线课程相邻无视频课时触发）。
  const playable = (i) => segCount(i) > 0 && lessons[i].segments.every((s) => s.hasVideo)

  if (dir > 0) {
    if (segIdx < segCount(lessonIdx) - 1) return { lessonIdx, segIdx: segIdx + 1 }
    // 本课时最后一段 → 下一个可播课时第一段（跳过无段/无视频课时，防卡死/困死）
    for (let i = lessonIdx + 1; i < lessons.length; i++) {
      if (playable(i)) return { lessonIdx: i, segIdx: 0 }
    }
    return null // 全课最后一段
  }
  if (dir < 0) {
    if (segIdx > 0) return { lessonIdx, segIdx: segIdx - 1 }
    // 本课时第一段 → 上一个可播课时最后一段
    for (let i = lessonIdx - 1; i >= 0; i--) {
      if (playable(i)) return { lessonIdx: i, segIdx: segCount(i) - 1 }
    }
    return null // 全课第一段
  }
  return null
}
