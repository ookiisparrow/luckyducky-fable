import { COLLECTIONS } from '@ldrw/shared'
import { getDb, ok } from '../../../kit'

/**
 * 商品列表（公开只读·黄金 admin-misc §二：按排序升序下发；只下发在售——
 * listed:false 停售不露给顾客，旧无 listed 字段的商品仍命中＝可售，向后兼容免回灌）。
 */
export const getProducts = async () => {
  const db = getDb()
  const res = await db
    .collection(COLLECTIONS.products)
    .where({ listed: db.command.neq(false) })
    .orderBy('sort', 'asc')
    .get()
  return ok({ list: res.data })
}

/**
 * 首页内容（公开只读·黄金 learning-content §九：无记录返回空，前端回退默认文案）。
 */
export const getContent = async () => {
  const db = getDb()
  try {
    const got = await db.collection(COLLECTIONS.content).doc('home').get()
    return ok({ home: got.data || null })
  } catch {
    return ok({ home: null })
  }
}
