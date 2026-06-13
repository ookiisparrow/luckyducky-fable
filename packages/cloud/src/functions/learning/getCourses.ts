import { getDb, ok } from '../../kit'

// 取课程列表（三层，按 sort 升序）。只读、公开（课程目录公开可见）；
// 播放鉴权与 videoFileId 换临时 URL 见设计规格 §四（另做）。
export const main = async () => {
  const db = getDb()
  const res = await db.collection('courses').orderBy('sort', 'asc').get()
  return ok({ list: res.data })
}
