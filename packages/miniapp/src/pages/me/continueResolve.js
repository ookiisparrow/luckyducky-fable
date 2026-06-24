/**
 * 「我」页「继续学习」定位（纯函数）——决定续播哪门课、哪一课时。
 *
 * 病根#8（同 bug W「扫码激活显默认课」家族）：原 cont 用 courses.current 的课时表去找最近观看的课时，
 * 而 current 在 currentId 未设时回退 list[0]=演示鸭课 → 用户在小熊课的观看记录在鸭课里找不到 → 回退
 * 演示样例；进小程序显演示课、点进演示列表，去过目录把 currentId 设成小熊后才纠正（要退出再进）。
 * 根治：按观看记录自己的 courseId 取课；无记录则用用户最近解锁的课（act.mine 末项）——绝不靠默认 current、
 * 绝不对真实有课用户回退演示。
 *
 * @param {{courseId?:string,lessonId?:string,at?:number,dur?:number}|null} lastWatch 云端最近观看点
 * @param {(id:string)=>object|null} getById 按 id 取课程（courses.getById）
 * @param {Array<{courseId:string}>} mine 用户已解锁课程（act.mine）
 * @returns {{course:object, lessons:Array, index:number}|null} 定位结果；无可定位课程→null（卡片走兜底）
 */
export function resolveContinue(lastWatch, getById, mine) {
  const mineLast = Array.isArray(mine) && mine.length ? mine[mine.length - 1].courseId : ''
  const courseId = (lastWatch && lastWatch.courseId) || mineLast
  const course = courseId && typeof getById === 'function' ? getById(courseId) : null
  if (!course) return null
  const lessons = (course.chapters || []).flatMap((c) =>
    (c.lessons || []).map((l) => ({ ...l, chapter: c.id }))
  )
  if (!lessons.length) return null
  // 课时：有最近观看定位它（找不到则回退第一课时），否则第一课时（开始学）
  let index = lastWatch ? lessons.findIndex((l) => l.id === lastWatch.lessonId) : 0
  if (index < 0) index = 0
  return { course, lessons, index }
}
