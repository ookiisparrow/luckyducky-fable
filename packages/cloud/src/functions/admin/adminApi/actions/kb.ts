import { reply, ensure, str, type Ctx } from '../lib'

// 知识库维护（后台360工作站 B4.1·admin 侧）：管理端维护 FAQ/知识条目（问题 + 答案 + 分类 + 启用 + 顺序），
// 客服 bot（cs/kfCallback/dispatch.ts）按 _id（=FAQ 键·同分流菜单叶子 id）读 kb 发答案——FAQ 答案单源（守卫
// faq-via-kb-single-source·根因#5）。整体覆盖式保存（同 saveCheckpoints 范式）：admin 提交整份条目列表，
// 后端 upsert 全部 + 删除不在列表里的旧条目，一个 action 兼「增删改」。确定性 _id=key（doc(key).set·data 不带 _id）。

const ENTRY_LIMIT = 100 // 单次保存条目上限（防一次塞爆·FAQ 量级远低于此）
const SCAN = 500 // 列表/清理扫描上界（bounded·capacity-reads-bounded）
const CATS = ['logistics', 'activation', 'aftersale', 'tutorial', 'other'] // 分类白名单·越界归 other

// 列出全部知识条目（bounded·读类·shouldAudit 跳 ^list 降噪）：按 分类→order 升序，供 admin 维护页编辑。
export async function listKb({ db }: Ctx) {
  const r = await db.collection('kb').limit(SCAN).get().catch(() => ({ data: [] }))
  const list = ((r && r.data) || [])
    .map((d: any) => ({
      key: d._id,
      question: d.question || '',
      answer: d.answer || '',
      category: CATS.includes(d.category) ? d.category : 'other',
      enabled: d.enabled !== false, // 旧条目无字段时默认启用
      order: Number(d.order) || 0,
    }))
    .sort((a: any, b: any) => a.category.localeCompare(b.category) || a.order - b.order)
  return reply(200, { ok: true, list })
}

// 整体覆盖式保存知识条目（白名单字段 + 长度上限·不信前端·根因#3）：upsert 传入条目 + 删本册不在列表里的旧条目。
export async function saveKb({ db, data }: Ctx) {
  await ensure(db, 'kb')
  const entries = (Array.isArray(data && data.entries) ? data.entries : []).slice(0, ENTRY_LIMIT)
  const keep = new Set<string>()
  let i = 0
  for (const e of entries) {
    const key = str(e && e.key, 64).trim()
    if (!key) continue // 无键的行跳过（key 即 _id·FAQ 路由键）
    keep.add(key)
    await db
      .collection('kb')
      .doc(key)
      .set({
        data: {
          question: str(e.question, 200),
          answer: str(e.answer, 2000),
          category: CATS.includes(e.category) ? e.category : 'other',
          enabled: e.enabled !== false,
          order: Number(e.order) || i,
          updatedAt: Date.now(),
        },
      })
    i++
  }
  // 删本册不在新列表里的旧条目（整体覆盖式同步·admin 删一条即真删）
  const old = await db.collection('kb').limit(SCAN).get().catch(() => ({ data: [] }))
  for (const d of (old && old.data) || []) {
    if (!keep.has(d._id)) await db.collection('kb').doc(d._id).remove().catch(() => {})
  }
  return reply(200, { ok: true, count: keep.size })
}
