/**
 * 「我的课程」列表解析（纯函数）——用户已激活课程（act.mine）→ 去重 + 取课程对象，保序。
 *
 * 「全部教程」入口指向「我已购买激活过的课程列表」，而非某单门课的课时列表（根因#8 多课）。
 * 同一门课可能有多张激活码 → act.mine 里同 courseId 重复，须去重（否则列表出现重复课程）。
 *
 * @param {Array<{courseId:string}>} mine act.mine（已解锁课程）
 * @param {(id:string)=>object|null} getById courses.getById
 * @returns {Array<object>} 去重后的课程对象数组（查不到/空 id 跳过）
 */
export function resolveMyCourses(mine, getById) {
  if (!Array.isArray(mine)) return []
  const seen = new Set()
  const out = []
  for (const m of mine) {
    const id = m && m.courseId
    if (!id || seen.has(id)) continue
    seen.add(id)
    const c = typeof getById === 'function' ? getById(id) : null
    if (c) out.push(c)
  }
  return out
}
