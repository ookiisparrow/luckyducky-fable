import { COLLECTIONS } from '@ldrw/shared'
import { getDb, ok } from '../../../kit'

const FAQ_LIMIT = 20 // bounded（黄金 §七）：FAQ 量级远低于此，非近似截断

/**
 * 精选 FAQ 公开读（R37b·播放页求助面板内容源扩展 b 项）：常见问题单源＝客服知识库 `kb` 集合
 * （同 admin listKb/saveKb·守卫 faq-via-kb-single-source 扩面覆盖本函数）——不另立数据源、不内联
 * 写死 FAQ。公开只读无鉴权（同 getProducts/getContent 口径：无 withOpenId，前台通用免费内容）：
 * 只回管理端勾选「精选」(featured:true) 且未被禁用(enabled!==false) 的条目，字段瘦身
 * {key,title,content}（title←question / content←answer）——不带 category/order/enabled 等 kb 管理元数据。
 */
export const getPublicFaq = async () => {
  const db = getDb()
  const got = await db
    .collection(COLLECTIONS.kb)
    .where({ featured: true })
    .orderBy('order', 'asc') // 遵 admin 策展顺序（同 listKb order 字段口径·同 getProducts sort 惯例）——不是数据库任意返回序
    .limit(FAQ_LIMIT)
    .get()
    .catch(() => ({ data: [] }))
  const items = ((got && got.data) || [])
    .filter((d: any) => d && d.enabled !== false)
    .map((d: any) => ({
      key: String(d._id || ''),
      title: String(d.question || ''),
      content: String(d.answer || ''),
    }))
  return ok({ items })
}
