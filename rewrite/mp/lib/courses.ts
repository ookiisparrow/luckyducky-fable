// 课程目录会话缓存（跨页共享·镜像 lib/catalog.ts 商品缓存范式·根因账本#15）：课程目录本会话内不变，
// player/me/my-courses 三页原各自重拉一次 api/learning 的 getCourses，每次多付一次真实云函数往返
// （实测 0.7-1.4s）。命中直接复用；miss（含深链冷启动直进播放页）内部兜底重拉一次；失败返 null、
// 不清空既有缓存（下次调用仍可重试，不因一次网络抖动把已缓存的旧数据抹掉）。不持久化（会话内即可）。
import { getCourses } from '../api/learning'

let cache: Record<string, unknown>[] | null = null

export async function getAllCourses(): Promise<Record<string, unknown>[] | null> {
  if (cache) return cache
  const r = await getCourses()
  if (!r.ok || !Array.isArray(r.list)) return null
  cache = r.list as Record<string, unknown>[]
  return cache
}

export async function getCourseById(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null
  const list = await getAllCourses()
  if (!list) return null
  return list.find((c) => String(c.id || c._id || '') === id) || null
}
