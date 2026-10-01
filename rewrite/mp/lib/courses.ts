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
// 按 id 取来的单门课（与整本里的同一形状·云端同走 publicCourse）：只供按 id 取，不冒充整本目录。
const byId = new Map<string, Record<string, unknown>>()
const BY_IDS_MAX = 20 // 云端 getCourses 按 id 单次上限（app/actions/learning.ts requestedCourseIds）

export async function getAllCourses(): Promise<Record<string, unknown>[] | null> {
  if (cache) return cache
  return flight.run('all', async () => {
    const r = await getCourses()
    if (!r.ok || !Array.isArray(r.list)) return null
    return (cache = r.list as Record<string, unknown>[])
  })
}

/** 「我」页继续学习 / 「我的课程」只要已解锁、学过的那几门，不拉整本树（#441）。
 *  整本缓存已热则只筛；否则先查按 id 缓存，缺的才按 id 拉（结果进按 id 缓存，不写整本缓存·防毒化目录页）。
 *  超过云端单次上限（20 门）改走整本目录，不截断。任一次拉取失败返 null（失败≠空目录）。 */
export async function getCoursesByIds(ids: string[]): Promise<Record<string, unknown>[] | null> {
  const uniq = [...new Set(ids.map((id) => String(id || '')).filter(Boolean))]
  if (!uniq.length) return []
  const all = uniq.length > BY_IDS_MAX ? await getAllCourses() : cache
  if (all) return uniq.map((id) => all.find((x) => idOf(x) === id)).filter((c): c is Record<string, unknown> => !!c)
  if (uniq.length > BY_IDS_MAX) return null // 整本拉取失败（按 id 拉会被云端截到 20 门·不能拿残缺冒充）
  const missing = uniq.filter((id) => !byId.has(id))
  if (missing.length) {
    const r = await getCourses({ ids: missing })
    if (!r.ok || !Array.isArray(r.list)) return null
    for (const c of r.list as Record<string, unknown>[]) byId.set(idOf(c), c)
  }
  return uniq.map((id) => byId.get(id)).filter((c): c is Record<string, unknown> => !!c)
}

// 简版：null 混同「网络失败」与「查无此课」，只给 welcome 等 fail-soft 场景用。
export async function getCourseById(id: string): Promise<Record<string, unknown> | null> {
  return (await getCourseByIdDetailed(id)).course
}

// 区分度版（根因#14·守卫 rw-mp-list-loadfailed-state）：页面若按 null 渲染「课程不存在」会把弱网抖动
// 误报成课程消失。failed=目录拉取失败（可重试）；failed=false 且 course=null 才是真查无。catalog/player 用本函数。
export async function getCourseByIdDetailed(id: string): Promise<{ failed: boolean; course: Record<string, unknown> | null }> {
  if (!id) return { failed: false, course: null }
  const hit = byId.get(id) // 「我」/「我的课程」按 id 取过 → 播放页、目录页零请求（#441）
  if (hit) return { failed: false, course: hit }
  const list = await getAllCourses()
  if (!list) return { failed: true, course: null }
  return { failed: false, course: list.find((c) => idOf(c) === id) || null }
}
