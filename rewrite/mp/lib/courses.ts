// 课程目录会话缓存（跨页共享·镜像 lib/catalog.ts 商品缓存范式·根因账本#15）：课程目录本会话内不变，
// player/me/my-courses 三页若各自重拉 api/learning 的 getCourses，每次多付一次真实云函数往返
// （实测 0.7-1.4s）。命中直接复用；miss（含深链冷启动直进播放页）内部兜底重拉一次；失败返 null、
// 不清空既有缓存（下次调用仍可重试，不因一次网络抖动把已缓存的旧数据抹掉）。不持久化（会话内即可）。
import { getCourses } from '../api/learning'
import { createInflight } from './inflight'

let cache: Record<string, unknown>[] | null = null
const idOf = (x: Record<string, unknown>) => String(x.id || x._id || '')
// 在途去重：cache 未命中时的并发调用（player/me/my-courses 深链撞车）共享一次云调用。
const flight = createInflight<Record<string, unknown>[] | null>()

export async function getAllCourses(): Promise<Record<string, unknown>[] | null> {
  if (cache) return cache
  return flight.run('all', async () => {
    const r = await getCourses()
    if (!r.ok || !Array.isArray(r.list)) return null
    return (cache = r.list as Record<string, unknown>[])
  })
}

/** 继续学习只要进度/已解锁里那几门（通常 1 门），不拉整本树。
 *  整本会话缓存已热则只筛、不发请求；未热则按 ids 取，且不把残片写进整本缓存（防毒化目录页）。 */
export async function getCoursesByIds(ids: string[]): Promise<Record<string, unknown>[] | null> {
  const uniq = [...new Set(ids.map((id) => String(id || '')).filter(Boolean))].slice(0, 20)
  if (!uniq.length) return []
  const all = cache
  if (all) return uniq.map((id) => all.find((x) => idOf(x) === id)).filter((c): c is Record<string, unknown> => !!c)
  const r = await getCourses({ ids: uniq })
  if (!r.ok || !Array.isArray(r.list)) return null
  return r.list as Record<string, unknown>[]
}

// 简版：null 混同「网络失败」与「查无此课」，只给 welcome 等 fail-soft 场景用。
export async function getCourseById(id: string): Promise<Record<string, unknown> | null> {
  return (await getCourseByIdDetailed(id)).course
}

// 区分度版（根因#14·守卫 rw-mp-list-loadfailed-state）：页面若按 null 渲染「课程不存在」会把弱网抖动
// 误报成课程消失。failed=目录拉取失败（可重试）；failed=false 且 course=null 才是真查无。catalog/player 用本函数。
export async function getCourseByIdDetailed(id: string): Promise<{ failed: boolean; course: Record<string, unknown> | null }> {
  if (!id) return { failed: false, course: null }
  const list = await getAllCourses()
  if (!list) return { failed: true, course: null }
  return { failed: false, course: list.find((c) => idOf(c) === id) || null }
}
