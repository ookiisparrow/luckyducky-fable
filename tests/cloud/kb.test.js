import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { listKb, saveKb } from '../../packages/cloud/src/functions/admin/adminApi/actions/kb'
import { route, faqAnswer, handleMessage } from '../../packages/cloud/src/functions/cs/kfCallback/dispatch'

// 后台360工作站 B4.1 知识库：admin 维护 FAQ 单源（listKb/saveKb·整体覆盖式·白名单）+ 客服 bot dispatch
// 读 kb 发答案（faqAnswer·守卫 faq-via-kb-single-source·根因#5·替代写死 TEXT_ANSWERS）。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)

beforeEach(() => {
  control.reset()
})

describe('adminApi 知识库维护（saveKb / listKb·整体覆盖式·白名单）', () => {
  it('saveKb upsert（确定性 _id=key）+ listKb 按分类→order 列出', async () => {
    await saveKb(
      ctx({
        entries: [
          { key: 'logistics:eta', question: '多久发货', answer: '48h 内发', category: 'logistics', order: 1 },
          { key: 'aftersale:policy', question: '退换', answer: '7 天无理由', category: 'aftersale', order: 0 },
        ],
      })
    )
    expect(control.dump('kb').map((d) => d._id).sort()).toEqual(['aftersale:policy', 'logistics:eta'])
    const list = parse(await listKb(ctx({}))).list
    expect(list.map((x) => x.key)).toEqual(['aftersale:policy', 'logistics:eta']) // 分类升序 aftersale<logistics
    expect(list[0].answer).toBe('7 天无理由')
    expect(list[1].question).toBe('多久发货')
  })

  it('整体覆盖式：删本册不在新列表的旧条目（admin 删一条即真删）', async () => {
    await saveKb(ctx({ entries: [{ key: 'a:1', answer: 'A' }, { key: 'b:1', answer: 'B' }] }))
    await saveKb(ctx({ entries: [{ key: 'a:1', answer: 'A2' }] })) // 去掉 b:1
    const rows = control.dump('kb')
    expect(rows.map((d) => d._id)).toEqual(['a:1'])
    expect(rows[0].answer).toBe('A2')
  })

  it('白名单：分类越界归 other·enabled 默认 true·无 key 跳过', async () => {
    const r = parse(
      await saveKb(ctx({ entries: [{ key: 'x:1', answer: 'y', category: 'bogus' }, { key: '', answer: '无键跳过' }] }))
    )
    expect(r.count).toBe(1) // 无 key 的那条被跳过
    const rows = control.dump('kb')
    expect(rows).toHaveLength(1)
    expect(rows[0].category).toBe('other')
    expect(rows[0].enabled).toBe(true)
  })

  it('enabled:false 落库保留（admin 关一条 FAQ·不删）', async () => {
    await saveKb(ctx({ entries: [{ key: 'x:1', answer: 'y', enabled: false }] }))
    expect(control.dump('kb')[0].enabled).toBe(false)
    expect(parse(await listKb(ctx({}))).list[0].enabled).toBe(false)
  })
})

describe('dispatch 读 kb 单源（faqAnswer·守卫 faq-via-kb-single-source）', () => {
  it('route：FAQ 键（含冒号·非结构路由）→ faq 路由（不再写死 text）', () => {
    expect(route('aftersale:policy')).toEqual({ type: 'faq', faqKey: 'aftersale:policy' })
    expect(route('logistics:eta')).toEqual({ type: 'faq', faqKey: 'logistics:eta' })
    expect(route('未知id').type).toBe('menu') // 无冒号未知 id → 兜底回根菜单
  })

  it('faqAnswer：命中返答案；未命中 / 未启用 / 空键返 null', async () => {
    control.seed('kb', [
      { _id: 'logistics:eta', answer: '48h 内发', enabled: true },
      { _id: 'off:1', answer: '停用的', enabled: false },
    ])
    expect(await faqAnswer(db, 'logistics:eta')).toBe('48h 内发')
    expect(await faqAnswer(db, 'off:1')).toBeNull() // enabled:false
    expect(await faqAnswer(db, 'none:1')).toBeNull() // 不存在
    expect(await faqAnswer(db, '')).toBeNull()
  })

  it('handleMessage：点 FAQ 菜单 → 发 kb 答案（答案来自 kb·非写死）', async () => {
    control.seed('kb', [{ _id: 'aftersale:policy', answer: '7 天无理由退换', enabled: true }])
    const sent = []
    const ctxKf = { db, openKfId: 'wk', cfg: {}, send: async (p) => sent.push(p), transfer: async () => {} }
    await handleMessage(ctxKf, { externalUserId: 'e1', menuId: 'aftersale:policy', text: '' })
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].text.content).toBe('7 天无理由退换')
  })

  it('handleMessage：kb 无此条 → 兜底回根菜单（不崩·不写死答案）', async () => {
    const sent = []
    const ctxKf = { db, openKfId: 'wk', cfg: {}, send: async (p) => sent.push(p), transfer: async () => {} }
    await handleMessage(ctxKf, { externalUserId: 'e1', menuId: 'logistics:eta', text: '' })
    expect(sent[0].msgtype).toBe('msgmenu') // 答案缺失兜底根菜单
  })
})
