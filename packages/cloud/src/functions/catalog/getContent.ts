import { getDb, ok } from '../../kit'

// 取首页内容（hero 文案/信任条/FAQ；控制台「小程序橱窗」编辑，存 content 集合 doc 'home'）。
// 只读、公开；无记录返回 null（前端回退本地默认文案）。
export const main = async () => {
  const db = getDb()
  try {
    const got = await db.collection('content').doc('home').get()
    return ok({ home: got.data || null })
  } catch {
    return ok({ home: null }) // 集合/文档未建 = 用默认文案
  }
}
