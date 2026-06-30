import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { getCsatReport } from '../../packages/cloud/src/functions/admin/adminApi/actions/csat'
import { route, parseRate, recordCsat, attachCsatNote, handleMessage } from '../../packages/cloud/src/functions/cs/kfCallback/dispatch'

// 后台360工作站 B4.3 CSAT：会话后评分 1-5 + 可选备注（recordCsat·fail-closed 校验 1..5·守卫 csat-score-bounded）
// + 备注预设标签回写（attachCsatNote）+ 报表 getCsatReport（均分/分布·bounded）。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)
const mkKf = () => {
  const sent = []
  return { sent, ctx: { db, openKfId: 'wk', cfg: {}, send: async (p) => sent.push(p), transfer: async () => {} } }
}

beforeEach(() => control.reset())

describe('route + parseRate（CSAT 分流·deterministic）', () => {
  it('评价入口 → 评分菜单；rate:N → csat 记分；csatnote:tag → 备注', () => {
    expect(route('csat').type).toBe('menu')
    expect(route('csat').content.list.map((i) => i.click.id)).toContain('rate:5')
    expect(route('rate:5')).toEqual({ type: 'csat', score: 5 })
    expect(route('csatnote:slow')).toEqual({ type: 'csat_note', note: '回复有点慢' })
    expect(route('csatnote:none')).toEqual({ type: 'csat_note', note: '' }) // 不补充=空备注
  })
  it('parseRate 只认 1..5；越界/非法 → null（route 据此不当 csat·入库再校验一次）', () => {
    expect(parseRate('rate:3')).toBe(3)
    expect(parseRate('rate:9')).toBeNull()
    expect(parseRate('rate:0')).toBeNull()
    expect(parseRate('ratex')).toBeNull()
    expect(route('rate:9').type).toBe('faq') // 越界 rate 落 faq 兜底（非 csat·不会脏分）
  })
})

describe('recordCsat（fail-closed 校验 1..5·守卫 csat-score-bounded·根因#3）', () => {
  it('合法分 → 落库 csat（确定性 _id·绑字段）+ kfState 记最近一条', async () => {
    const id = await recordCsat(db, { externalUserId: 'e1', openid: 'oA', score: 5 })
    expect(id).toMatch(/^csat:e1:/)
    const rows = control.dump('csat')
    expect(rows).toHaveLength(1)
    expect(rows[0].score).toBe(5)
    expect(rows[0].externalUserId).toBe('e1')
    expect(rows[0].openid).toBe('oA')
    expect(rows[0].note).toBe('')
    const last = control.dump('kfState').find((d) => d._id === 'csatlast:e1')
    expect(last && last.csatId).toBe(id)
  })
  it('越界分（0 / 6 / NaN）一律拒·绝不入库（防脏分污染均分）', async () => {
    expect(await recordCsat(db, { externalUserId: 'e1', openid: null, score: 0 })).toBeNull()
    expect(await recordCsat(db, { externalUserId: 'e1', openid: null, score: 6 })).toBeNull()
    expect(await recordCsat(db, { externalUserId: 'e1', openid: null, score: 'x' })).toBeNull()
    expect(control.dump('csat')).toHaveLength(0)
  })
  it('空 euid → 拒', async () => {
    expect(await recordCsat(db, { externalUserId: '', openid: null, score: 5 })).toBeNull()
  })
})

describe('attachCsatNote（备注回写最近一条·非热路径）', () => {
  it('有最近评分 → 回写 note + 清最近标记', async () => {
    const id = await recordCsat(db, { externalUserId: 'e1', openid: null, score: 4 })
    await attachCsatNote(db, 'e1', '回复有点慢')
    expect(control.dump('csat').find((d) => d._id === id).note).toBe('回复有点慢')
    expect(control.dump('kfState').some((d) => d._id === 'csatlast:e1')).toBe(false) // 已清
  })
  it('无最近评分 → 静默跳过（不崩）', async () => {
    await attachCsatNote(db, 'eNone', '随便')
    expect(control.dump('csat')).toHaveLength(0)
  })
})

describe('handleMessage CSAT 编排', () => {
  it('点 rate:5 → 记分 + 发「补充原因」菜单', async () => {
    const { ctx: kf, sent } = mkKf()
    await handleMessage(kf, { externalUserId: 'e1', menuId: 'rate:5', text: '' })
    expect(control.dump('csat')[0].score).toBe(5)
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(sent[0].msgmenu.list.map((i) => i.click.id)).toContain('csatnote:slow')
  })
  it('评分后点备注标签 → 回写备注 + 谢一句', async () => {
    const { ctx: kf, sent } = mkKf()
    await handleMessage(kf, { externalUserId: 'e1', menuId: 'rate:2', text: '' })
    await handleMessage(kf, { externalUserId: 'e1', menuId: 'csatnote:unresolved', text: '' })
    expect(control.dump('csat')[0].note).toBe('问题没解决')
    expect(sent[sent.length - 1].msgtype).toBe('text')
    expect(sent[sent.length - 1].text.content).toContain('谢谢')
  })
  it('伪造 rate:9 → 不记分（落 faq 兜底·不污染均分）', async () => {
    const { ctx: kf } = mkKf()
    await handleMessage(kf, { externalUserId: 'e1', menuId: 'rate:9', text: '' })
    expect(control.dump('csat')).toHaveLength(0)
  })
})

describe('getCsatReport（均分/分布·bounded·忽略越界）', () => {
  it('聚合均分 + 1-5 分布 + 总数 + 带备注数', async () => {
    control.seed('csat', [
      { _id: 'csat:a:1', score: 5, note: '很满意' },
      { _id: 'csat:b:1', score: 3, note: '' },
      { _id: 'csat:c:1', score: 4, note: '' },
      { _id: 'csat:bad:1', score: 9, note: '' }, // 越界·不计入（防御）
    ])
    const r = parse(await getCsatReport(ctx({})))
    expect(r.total).toBe(3) // 越界那条不计
    expect(r.avg).toBe(4) // (5+3+4)/3=4
    expect(r.dist[5]).toBe(1)
    expect(r.dist[3]).toBe(1)
    expect(r.withNote).toBe(1)
  })
  it('空集 → total 0·avg 0·不崩', async () => {
    const r = parse(await getCsatReport(ctx({})))
    expect(r.total).toBe(0)
    expect(r.avg).toBe(0)
  })
})
