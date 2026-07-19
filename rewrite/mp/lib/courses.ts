// 课程目录会话缓存（跨页共享·镜像 lib/catalog.ts 商品缓存范式·根因账本#15）：课程目录本会话内不变，
// player/me/my-courses 三页原各自重拉一次 api/learning 的 getCourses，每次多付一次真实云函数往返
// （实测 0.7-1.4s）。命中直接复用；miss（含深链冷启动直进播放页）内部兜底重拉一次；失败返 null、
// 不清空既有缓存（下次调用仍可重试，不因一次网络抖动把已缓存的旧数据抹掉）。不持久化（会话内即可）。
import { getCourses } from '../api/learning'

let cache: Record<string, unknown>[] | null = null
// 在途去重（G4·镜像 lib/catalog.ts getAllProducts / lib/pageContent.ts inflight 范式）：cache 未命中时并发
// 调用（player/me/my-courses 深链撞车）此前会各发一次真实云调用；改并发共享同一在途 promise，结算（成功/
// 失败都）即清键、不缓存 rejection。本函数无 force 形参（全仓也无调用方需要），故不新增——纯 inflight 去重
// （防过度工程）。
let inflight: Promise<Record<string, unknown>[] | null> | null = null

export async function getAllCourses(): Promise<Record<string, unknown>[] | null> {
  if (cache) return cache
  if (inflight) return inflight // 在途去重：并发调用共享同一在途 promise，不重复拉
  inflight = (async () => {
    try {
      const r = await getCourses()
      if (!r.ok || !Array.isArray(r.list)) return null
      cache = r.list as Record<string, unknown>[]
      return cache
    } finally {
      inflight = null // 结算即清在途键（成功/失败都清·不缓存 rejection）
    }
  })()
  return inflight
}

export async function getCourseById(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  const list = await getAllCourses()
  if (!list) return null
  return list.find((c) => String(c.id || c._id || '') === id) || null
}

// 区分度版（根因#14·守卫 rw-mp-list-loadfailed-state）：getCourseById 的 null 混同了「网络失败」与
// 「查无此课」，页面据此渲染「课程不存在」会把弱网抖动误报成课程消失。failed=目录拉取失败（可重试）；
// failed=false 且 course=null 才是真查无。catalog/player 用本函数，welcome 等 fail-soft 场景仍用上面的简版。
export async function getCourseByIdDetailed(id: string): Promise<{ failed: boolean; course: Record<string, unknown> | null }> {
  if (!id) return { failed: false, course: null }
  const list = await getAllCourses()
  if (!list) return { failed: true, course: null }
  return { failed: false, course: list.find((c) => String(c.id || c._id || '') === id) || null }
}
