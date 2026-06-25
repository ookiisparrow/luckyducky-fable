import { withOpenId, ok } from '../../kit'

// 我的学习进度（trackEvent 折叠写入；目录角标 / 继续学习卡读这里）。只返回本人记录。
export const main = withOpenId(async ({ db, OPENID }) => {
  try {
    // 显式上界（规模·根因#7）：progress 每用户每课一条·本人远不及 200·防裸 .get() 默认 100 静默截断
    const res = await db.collection('progress').where({ _openid: OPENID }).limit(200).get()
    return ok({ list: res.data })
  } catch {
    return ok({ list: [] }) // 集合未建 = 还没有任何进度
  }
})
