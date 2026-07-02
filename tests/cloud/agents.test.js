import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import cloud, { control } from 'wx-server-sdk'
import { createAgent, disableAgent, listAgents, setAgentWecomUserId } from '../../packages/cloud/src/functions/admin/adminApi/actions/agents'
import { checkKey } from '../../packages/cloud/src/functions/admin/adminApi/lib'

// 外包账号管理（B5.2·承面C 车道 C·§1.5）：商户超管建/停/列外包坐席账号（adminConfig 多账号·role=outsourced）。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
// 多账号 checkKey 分支须先有超管 'auth' doc（否则走 bootstrap·非多账号分支）
const seedSuper = () => control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-admin-key'), role: 'superadmin' }])

beforeEach(() => control.reset())

describe('createAgent 建外包账号', () => {
  it('建 outsourced 账号：keyHash 入库·不存明文·白名单回', async () => {
    const r = parse(await createAgent(ctx({ name: '客服-小李', key: 'agentpass1' })))
    expect(r.ok).toBe(true)
    expect(r.agent).toMatchObject({ role: 'outsourced', name: '客服-小李', disabled: false })
    const doc = control.dump('adminConfig').find((a) => a._id === r.agent.id)
    expect(doc.keyHash).toBe(sha('agentpass1')) // 哈希入库
    expect(doc.key).toBeUndefined() // 不存明文
    expect(doc.role).toBe('outsourced')
  })
  it('校验：空名 BAD_NAME / 短口令 KEY_TOO_SHORT / 撞口令 KEY_TAKEN', async () => {
    expect(parse(await createAgent(ctx({ name: '', key: 'agentpass1' }))).error).toBe('BAD_NAME')
    expect(parse(await createAgent(ctx({ name: 'x', key: '123' }))).error).toBe('KEY_TOO_SHORT')
    await createAgent(ctx({ name: 'A', key: 'dupkey123' }))
    expect(parse(await createAgent(ctx({ name: 'B', key: 'dupkey123' }))).error).toBe('KEY_TAKEN')
  })
})

describe('外包账号登录/开停（checkKey 集成·lib.ts 骨架）', () => {
  it('建号后可经 checkKey 登录·role→caps 派生（outsourced 最小权）', async () => {
    seedSuper()
    await createAgent(ctx({ name: '客服', key: 'agentpass1' }))
    const res = await checkKey(db, 'agentpass1', false)
    expect(res.ok).toBe(true)
    expect(res.caps).toEqual(['agent:handle']) // ROLES.outsourced 派生（master 整合收窄为仅 agent:handle·去裸 customer:view 闭合批量导出洞）
    expect(res.operator).toBe('客服') // 审计操作者身份（B5.4）
  })
  it('disableAgent 停用后 checkKey 拒（ACCOUNT_DISABLED）·恢复后放行', async () => {
    seedSuper()
    const a = parse(await createAgent(ctx({ name: '客服', key: 'agentpass1' }))).agent
    expect(parse(await disableAgent(ctx({ id: a.id, disabled: true }))).ok).toBe(true)
    expect((await checkKey(db, 'agentpass1', false)).error).toBe('ACCOUNT_DISABLED')
    await disableAgent(ctx({ id: a.id, disabled: false }))
    expect((await checkKey(db, 'agentpass1', false)).ok).toBe(true)
  })
  it('disableAgent 不许停超管（id=auth → BAD_ID）', async () => {
    expect(parse(await disableAgent(ctx({ id: 'auth', disabled: true }))).error).toBe('BAD_ID')
  })
  it('disableAgent 非外包/不存在 → AGENT_NOT_FOUND', async () => {
    expect(parse(await disableAgent(ctx({ id: 'agent:ghost', disabled: true }))).error).toBe('AGENT_NOT_FOUND')
  })
})

describe('listAgents 列外包账号', () => {
  it('只列 outsourced·白名单不回 keyHash·回 wecomUserId·排除超管', async () => {
    seedSuper()
    await createAgent(ctx({ name: '甲', key: 'passaaa1' }))
    await createAgent(ctx({ name: '乙', key: 'passbbb1' }))
    const r = parse(await listAgents(ctx({})))
    expect(r.agents.length).toBe(2) // 不含超管 auth
    expect(r.agents.every((a) => a.role === 'outsourced')).toBe(true)
    expect(r.agents[0].keyHash).toBeUndefined() // 白名单·不回口令哈希
    expect(r.agents.every((a) => 'wecomUserId' in a)).toBe(true) // 回 wecomUserId 供超管看绑没绑
    expect(r.agents.map((a) => a.name).sort()).toEqual(['乙', '甲'])
  })
})

describe('企微 userid 绑定（M⑦ 地基·免登用）', () => {
  it('createAgent 带 wecomUserId 入库·白名单回显', async () => {
    seedSuper()
    const a = parse(await createAgent(ctx({ name: '小李', key: 'agentpass1', wecomUserId: 'LiSi' }))).agent
    expect(a.wecomUserId).toBe('LiSi')
    const doc = control.dump('adminConfig').find((x) => x._id === a.id)
    expect(doc.wecomUserId).toBe('LiSi')
    const listed = parse(await listAgents(ctx({}))).agents.find((x) => x.id === a.id)
    expect(listed.wecomUserId).toBe('LiSi')
  })
  it('setAgentWecomUserId 回填/改绑/解绑（空串）', async () => {
    seedSuper()
    const a = parse(await createAgent(ctx({ name: '小王', key: 'agentpass1' }))).agent
    expect(parse(await listAgents(ctx({}))).agents.find((x) => x.id === a.id).wecomUserId).toBe('') // 建时未绑
    expect(parse(await setAgentWecomUserId(ctx({ id: a.id, wecomUserId: 'WangWu' }))).ok).toBe(true) // 回填
    expect(parse(await listAgents(ctx({}))).agents.find((x) => x.id === a.id).wecomUserId).toBe('WangWu')
    await setAgentWecomUserId(ctx({ id: a.id, wecomUserId: '' })) // 解绑
    expect(parse(await listAgents(ctx({}))).agents.find((x) => x.id === a.id).wecomUserId).toBe('')
  })
  it('唯一性：两账号撞同一 userid 拒（免登不歧义·建时 + 回填时）', async () => {
    seedSuper()
    await createAgent(ctx({ name: '甲', key: 'passaaa1', wecomUserId: 'DupId' }))
    // 建时撞
    expect(parse(await createAgent(ctx({ name: '乙', key: 'passbbb1', wecomUserId: 'DupId' }))).error).toBe('WECOM_ID_TAKEN')
    // 回填时撞
    const b = parse(await createAgent(ctx({ name: '丙', key: 'passccc1' }))).agent
    expect(parse(await setAgentWecomUserId(ctx({ id: b.id, wecomUserId: 'DupId' }))).error).toBe('WECOM_ID_TAKEN')
    // 改绑自己不算撞（exceptId 排除自身）
    const a = parse(await listAgents(ctx({}))).agents.find((x) => x.name === '甲')
    expect(parse(await setAgentWecomUserId(ctx({ id: a.id, wecomUserId: 'DupId' }))).ok).toBe(true)
  })
  it('setAgentWecomUserId 作用于超管 auth（超管也可免登·§2.2）·非账号 doc 拒', async () => {
    seedSuper()
    expect(parse(await setAgentWecomUserId(ctx({ id: 'auth', wecomUserId: 'BossId' }))).ok).toBe(true)
    expect(parse(await setAgentWecomUserId(ctx({ id: 'agent:ghost', wecomUserId: 'x' }))).error).toBe('AGENT_NOT_FOUND')
    expect(parse(await setAgentWecomUserId(ctx({ id: '', wecomUserId: 'x' }))).error).toBe('BAD_ID')
  })
})
