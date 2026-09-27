// 测版刷新 T1：口令命中清进度；正式/预发硬拒；人工接待中默认拒。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { welcomeMenu } from '../src/functions/cs/kfCallback/menus'
import { matchRefreshPassphrase } from '../src/functions/cs/kfCallback/trialRefresh'
import { CS_REFRESH_COPY, CS_SESSION_STATUS_SPEC, formatRefreshDone } from '@ldrw/shared'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import {
  DEFAULT_REFRESH_WORDS,
  applyTrialRefresh,
  flowStateId,
  getDb,
  loadTrialRefreshGate,
  sessionEpochId,
  trialRefreshDenyStatus,
} from '../src/kit'

const db = () => getDb()
const SUPER = 'super-secret-key'

const sendCollector = () => {
  const sent: any[] = []
  const ctx: DispatchCtx = {
    db: db(),
    openKfId: 'kf1',
    cfg: { appid: '', thumbMediaId: '' },
    send: async (p: any) => void sent.push(p),
  }
  return { sent, ctx }
}

const ENV_KEYS = [
  'CS_TRIAL_REFRESH',
  'CS_TRIAL_REFRESH_WORDS',
  'WX_ENV_VERSION',
  'TCB_ENV_VERSION',
  'TCB_ENV',
  'SCF_NAMESPACE',
  'JEV_CS_ROUTE',
  'TYPESAFE_API_KEY',
] as const

const post = (action: string, data: Record<string, unknown> = {}, key = SUPER) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

let fetchBackup: unknown
beforeEach(() => {
  control.reset()
  control.setOpenId('')
  fetchBackup = (globalThis as any).fetch
  for (const k of ENV_KEYS) delete process.env[k]
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
})
afterEach(() => {
  ;(globalThis as any).fetch = fetchBackup
  for (const k of ENV_KEYS) delete process.env[k]
})

function seedProgress(euid = 'eu1') {
  control.seed('kfState', [
    {
      _id: flowStateId(euid),
      node: 'askNext',
      topic: 'logistics',
      greeted: true,
      solved: true,
      humanAsks: 1,
      used: ['旧句'],
    },
    { _id: sessionEpochId(euid), epoch: 0, boundOrderId: 'ord-logic-1' },
    { _id: 'csatask:' + euid, at: Date.now() },
    { _id: 'token', accessToken: 'keep' },
  ])
  control.seed('kfIdentity', [{ _id: 'ext:' + euid, openid: 'o-real' }])
  control.seed('orders', [{ _id: 'ord-real', _openid: 'o-real', status: 'paid', amountFen: 9900 }])
  control.seed('conversations', [{ _id: 'in:old', externalUserId: euid, text: '旧档', direction: 'in', at: 1 }])
}

describe('口令匹配', () => {
  it('大白话：默认认「刷新」和 #reset，空的不算', () => {
    expect(DEFAULT_REFRESH_WORDS).toEqual(['刷新', '#reset'])
    expect(matchRefreshPassphrase('刷新', DEFAULT_REFRESH_WORDS)).toBe(true)
    expect(matchRefreshPassphrase('  #Reset  ', DEFAULT_REFRESH_WORDS)).toBe(true)
    expect(matchRefreshPassphrase('帮我刷新一下物流', DEFAULT_REFRESH_WORDS)).toBe(false)
    expect(matchRefreshPassphrase('', DEFAULT_REFRESH_WORDS)).toBe(false)
  })
})

describe('环境硬关', () => {
  it('大白话：正式字面或预发字面，旗标开了也关', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    process.env.WX_ENV_VERSION = 'release'
    expect((await loadTrialRefreshGate(db())).on).toBe(false)
    process.env.WX_ENV_VERSION = 'trial'
    expect((await loadTrialRefreshGate(db())).on).toBe(false)
  })

  it('大白话：生产云门牌硬关，旗标开了也关', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    process.env.TCB_ENV = 'cloudbase-prodlike'
    expect((await loadTrialRefreshGate(db())).on).toBe(false)
  })

  it('大白话：yaliceshi 测版云默认开；旗标也能开', async () => {
    process.env.TCB_ENV = 'yaliceshi-unit'
    expect((await loadTrialRefreshGate(db())).on).toBe(true)
    delete process.env.TCB_ENV
    process.env.CS_TRIAL_REFRESH = '1'
    const g = await loadTrialRefreshGate(db())
    expect(g.on).toBe(true)
    expect(g.words).toEqual(['刷新', '#reset'])
  })
})

describe('口令命中 → 清进度', () => {
  it('大白话：测版打「刷新」当新客，进度清掉，真订单和 openid 不动', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    seedProgress()
    const { sent, ctx } = sendCollector()
    const calls: string[] = []
    ;(globalThis as any).fetch = async (url: string) => {
      calls.push(String(url))
      throw new Error('jev-must-not-run')
    }
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '刷新' })
    expect(calls).toEqual([])
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(sent[0].msgmenu.head_content).toBe(CS_REFRESH_COPY.confirmPassphrase)
    expect(control.dump('kfState').find((x: any) => x._id === 'jevflow:eu1').greeted).toBe(true)
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'trial:refresh:ok', text: '确认重来' })
    expect(sent[1].text.content).toBe(formatRefreshDone(1))
    const flow = control.dump('kfState').find((x: any) => x._id === 'jevflow:eu1')
    expect(flow.greeted).toBe(false)
    expect(flow.topic).toBe('')
    expect(flow.used).toEqual([])
    const sess = control.dump('kfState').find((x: any) => x._id === 'jevsession:eu1')
    expect(sess.epoch).toBe(1)
    expect(sess.boundOrderId).toBe('')
    expect(control.dump('kfState').find((x: any) => x._id === 'csatask:eu1')).toBeUndefined()
    expect(control.dump('kfIdentity')[0].openid).toBe('o-real')
    expect(control.dump('orders')[0]).toMatchObject({ _id: 'ord-real', amountFen: 9900 })
    expect(control.dump('conversations')[0].text).toBe('旧档')
    expect(control.dump('kfState').find((x: any) => x._id === 'token').accessToken).toBe('keep')
    const log = control.dump('auditLog').find((x: any) => x.action === 'refreshTrialSession')
    expect(log.operator).toBe('passphrase')
    expect(log.summary.epochFrom).toBe('0')
    expect(log.summary.epochTo).toBe('1')
    expect(log.summary.reason).toBe('passphrase')
  })

  it('大白话：闸关时「刷新」不当口令，正式环境 API 也拒', async () => {
    seedProgress()
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '刷新' })
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(control.dump('kfState').find((x: any) => x._id === 'jevflow:eu1').greeted).toBe(true)
    process.env.WX_ENV_VERSION = 'release'
    const denied = await applyTrialRefresh(db(), {
      externalUserId: 'eu1',
      via: 'admin',
      reason: '试',
    })
    expect(denied).toEqual({ ok: false, error: 'TRIAL_ONLY', externalUserId: 'eu1' })
    const api = await post('refreshTrialSession', { externalUserId: 'eu1', reason: '试' })
    expect(api.status).toBe(404)
    expect(api.error).toBe('TRIAL_ONLY')
    expect(trialRefreshDenyStatus()).toBe(404)
  })
})

describe('人工接待中默认拒', () => {
  it('大白话：排队/接待中默认不刷；管理端强制才过并记审计', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    seedProgress()
    control.seed('csSession', [
      { _id: 'wxkf:kf1:eu1', status: 'active', externalUserId: 'eu1', openKfId: 'kf1', agentId: 'a1' },
    ])
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: '', text: '#reset' })
    expect(sent[0].text.content).toBe(CS_REFRESH_COPY.rejectInHuman)
    expect(control.dump('kfState').find((x: any) => x._id === 'jevflow:eu1').greeted).toBe(true)
    expect(control.dump('csSession')[0].status).toBe('active')

    const blocked = await post('refreshTrialSession', { externalUserId: 'eu1', reason: '复测' })
    expect(blocked.status).toBe(409)
    expect(blocked.error).toBe('HUMAN_ACTIVE')

    const forced = await post('refreshTrialSession', { externalUserId: 'eu1', reason: '复测强制', force: true })
    expect(forced.ok).toBe(true)
    expect(forced.results[0].epochTo).toBe(1)
    expect(control.dump('csSession')[0].status).toBe('closed')
    expect(control.dump('kfState').find((x: any) => x._id === 'jevflow:eu1').greeted).toBe(false)
    const log = control.dump('auditLog').find((x: any) => x.summary && x.summary.force === '1')
    expect(log.summary.reason).toBe('复测强制')
    expect(log.summary.epochFrom).toBe('0')
  })

  // 强制关会话的 transition 在 kit 里，守卫 rw-status-transitions-declared 只扫 functions/，由这条对着声明表锁边
  it('大白话：强制刷新把排队/接待/升级中的会话都关掉，每条边都在 csSession 声明流转表里', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    const held = ['pending', 'active', 'escalated']
    control.seed(
      'csSession',
      held.map((status, i) => ({ _id: `wxkf:kf${i}:eu1`, status, externalUserId: 'eu1', openKfId: `kf${i}` }))
    )
    const r = await applyTrialRefresh(db(), { externalUserId: 'eu1', via: 'admin', reason: '锁边', force: true })
    expect(r.ok && r.forced).toBe(true)
    held.forEach((from, i) => {
      const to = control.dump('csSession').find((x: any) => x._id === `wxkf:kf${i}:eu1`).status
      expect(to).toBe('closed')
      expect(CS_SESSION_STATUS_SPEC.transitions.some((t) => (t.from as readonly string[]).includes(from) && t.to === to)).toBe(true)
    })
  })
})

describe('会话按钮与欢迎菜单', () => {
  it('大白话：测版欢迎菜单多一颗「当作新客」；点下去要确认，确认后才清进度', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    seedProgress()
    const menu = await welcomeMenu(db())
    expect(menu.list.some((x) => x.click.id === 'trial:refresh')).toBe(true)
    const { sent, ctx } = sendCollector()
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'trial:refresh', text: '当作新客重新开始' })
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(sent[0].msgmenu.head_content).toBe(CS_REFRESH_COPY.confirmButton)
    expect(control.dump('kfState').find((x: any) => x._id === 'jevflow:eu1').greeted).toBe(true)
    await handleMessage(ctx, { externalUserId: 'eu1', menuId: 'trial:refresh:ok', text: '确认重来' })
    expect(sent[1].text.content).toBe(formatRefreshDone(1))
    expect(control.dump('kfState').find((x: any) => x._id === 'jevsession:eu1').epoch).toBe(1)
  })

  it('大白话：正式环境欢迎菜单没有刷新按钮', async () => {
    process.env.WX_ENV_VERSION = 'release'
    const menu = await welcomeMenu(db())
    expect(menu.list.some((x) => String(x.click.id).startsWith('trial:'))).toBe(false)
  })
})

describe('管理端 API', () => {
  it('大白话：原因必填；可批量；闸关回 403', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    seedProgress('euA')
    seedProgress('euB')
    expect((await post('refreshTrialSession', { externalUserId: 'euA' })).error).toBe('REASON_REQUIRED')
    const batch = await post('refreshTrialSession', { externalUserIds: ['euA', 'euB'], reason: '两人复测' })
    expect(batch.ok).toBe(true)
    expect(batch.results).toHaveLength(2)
    expect(batch.results.map((x: any) => x.epochTo)).toEqual([1, 1])
    delete process.env.CS_TRIAL_REFRESH
    process.env.WX_ENV_VERSION = 'trial'
    const preview = await post('refreshTrialSession', { externalUserId: 'euA', reason: '预发不该开' })
    expect(preview.status).toBe(403)
  })

  it('大白话：闸探测正式环境 enabled=false，测版 true', async () => {
    process.env.WX_ENV_VERSION = 'release'
    expect((await post('getTrialRefreshGate')).enabled).toBe(false)
    delete process.env.WX_ENV_VERSION
    process.env.CS_TRIAL_REFRESH = '1'
    expect((await post('getTrialRefreshGate')).enabled).toBe(true)
  })

  it('大白话：外包坐席调刷新 API 403，超管才能刷', async () => {
    process.env.CS_TRIAL_REFRESH = '1'
    control.seed('adminConfig', [{ _id: 'agent-1', keyHash: sha('out-key-1'), role: 'outsourced' }])
    const r = await post('refreshTrialSession', { externalUserId: 'eu1', reason: '坐席试' }, 'out-key-1')
    expect(r.status).toBe(403)
  })
})
