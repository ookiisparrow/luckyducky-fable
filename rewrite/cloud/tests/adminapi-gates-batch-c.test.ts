// Phase 3 清零战役·批C：adminApi 闸族与审计口径（C1–C5·先红后绿）。
//  C1 泛 action 鉴权失败补 GLOBAL_BRUTE 告警（比照 login·同 tag 'adminLogin' 聚合）
//  C2 loginByWecomCode 按返回码分类计频控——503/400 基建/客户端错不计不 reset、不告警；401/403 才计+告警
//  C3 审计 ok 判定纳入 HTTP200+{ok:false}（body 已序列化字符串·须解析）
//  C4 refund:manage 最小只读面：listRefunds/refundCounts/getRefundDetail/listOrders 登记「任一命中」cap 数组
//  C5 listOrders refundHold 徽标判据对齐 shipOne 三态（applied/approved/refunded）
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key'
const post = (action: string, key: string, data: Record<string, unknown> = {}, ip = '1.1.1.1') =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

// [LD_ALERT] 行捕获（alert()→console.error 同步落结构化行）
function captureAlerts(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  return fn()
    .then(() => seen)
    .finally(() => {
      console.error = orig
    })
}

const seedSuper = () => control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})
afterEach(() => vi.restoreAllMocks())

// —— C1 泛 action 鉴权失败缺 GLOBAL_BRUTE 告警 —— //
describe('C1 泛 action 鉴权失败补 GLOBAL_BRUTE 告警', () => {
  it('大白话：全局锁定态下，泛 action 拿错口令仍打 GLOBAL_BRUTE 告警（比照 login·tag=adminLogin）', async () => {
    seedSuper()
    // 20 个轮换 IP 各 1 次错口令 → 全局失败计数达阈（锁定），供 globalWait>0
    for (let i = 0; i < 20; i++) await post('login', 'wrong-long-key', {}, `12.0.0.${i}`)
    const alerts = await captureAlerts(async () => {
      // 全新 IP（per-IP 未锁）+ 错口令 + 泛 action：globalWait>0 → 补告警
      const r = await post('someProtectedAction', 'wrong-long-key', {}, '12.9.9.99')
      expect(r.status).toBe(401)
    })
    const brute = alerts.filter((s) => s.includes('[LD_ALERT]') && s.includes('code=GLOBAL_BRUTE'))
    expect(brute.length).toBeGreaterThanOrEqual(1)
    expect(brute[0]).toContain('fn=adminLogin') // 与 login 同 tag 聚合
  })

  it('大白话：全局未锁定时泛 action 错口令不误报 GLOBAL_BRUTE（globalWait=0 不告警）', async () => {
    seedSuper()
    const alerts = await captureAlerts(async () => {
      await post('someProtectedAction', 'wrong-long-key', {}, '13.0.0.1')
    })
    expect(alerts.filter((s) => s.includes('code=GLOBAL_BRUTE')).length).toBe(0)
  })
})

// —— C2 loginByWecomCode 按返回码分类计频控 —— //
describe('C2 loginByWecomCode 基建错不计入爆破频控', () => {
  const withFetch = async (impl: (url: string) => any, fn: () => Promise<void>) => {
    const saved = globalThis.fetch
    ;(globalThis as any).fetch = async (url: any) => ({ json: async () => impl(String(url)) })
    try {
      await fn()
    } finally {
      globalThis.fetch = saved
    }
  }
  const seedToken = () => control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
  const failDoc = (ip: string) => control.dump('rateLimit').find((r: any) => r._id === `rl_adminlogin:${ip}`)

  it('大白话：503 KF_TOKEN_UNAVAILABLE（令牌冷窗·非爆破）→ throttleFail 不被调、办公室 IP 不被记失败', async () => {
    seedSuper() // 无 kfState token → loginByWecomCode 返 503
    await post('loginByWecomCode', '', { code: 'c' }, '20.0.0.1')
    const doc = failDoc('20.0.0.1')
    expect(!doc || (doc.fails || 0) === 0).toBe(true) // 未计失败
  })

  it('大白话：401 BAD_CODE（真鉴权失败）→ throttleFail 被调、记一次失败', async () => {
    seedSuper()
    seedToken()
    await withFetch(
      () => ({ errcode: 40029 }), // code 失效 → BAD_CODE 401
      async () => {
        await post('loginByWecomCode', '', { code: 'c' }, '20.0.0.2')
      }
    )
    const doc = failDoc('20.0.0.2')
    expect(doc && doc.fails).toBeGreaterThanOrEqual(1)
  })

  it('大白话：503 → GLOBAL_BRUTE 告警不被调（503 不是爆破证据·不计不告警）', async () => {
    seedSuper()
    // 先把全局打到锁定（供 globalWait>0 的前提），再发 503——验它即便全局锁定也不告警
    for (let i = 0; i < 20; i++) await post('login', 'wrong-long-key', {}, `21.0.0.${i}`)
    const alerts = await captureAlerts(async () => {
      await post('loginByWecomCode', '', { code: 'c' }, '21.9.9.99') // 无 token → 503
    })
    expect(alerts.filter((s) => s.includes('code=GLOBAL_BRUTE')).length).toBe(0)
  })

  it('大白话：200 成功 → throttleReset（该 IP 此前失败被清零、不再累计）', async () => {
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
      { _id: 'agent-1', keyHash: sha('outsourced-key-1'), role: 'outsourced', wecomUserId: 'w1' },
    ])
    seedToken()
    // 先在同 IP 记一次失败（fresh code 换不到→401），再成功登录看是否清零
    await withFetch(
      () => ({ errcode: 40029 }),
      async () => {
        await post('loginByWecomCode', '', { code: 'bad' }, '20.0.0.9')
      }
    )
    await withFetch(
      (url) => (url.includes('auth/getuserinfo') ? { errcode: 0, userid: 'w1' } : { errcode: 0 }),
      async () => {
        const r = await post('loginByWecomCode', '', { code: 'good' }, '20.0.0.9')
        expect(r.status).toBe(200)
      }
    )
    const doc = control.dump('rateLimit').find((r: any) => r._id === 'rl_adminlogin:20.0.0.9')
    expect(!doc || (doc.fails || 0) === 0).toBe(true) // 成功 reset 清零
  })
})

// —— C3 审计 ok 判定纳入 HTTP200+{ok:false} —— //
describe('C3 审计 ok 判定：HTTP200 且 body.ok!==false 才算成功', () => {
  it('大白话：action 返 200+{ok:false}（业务失败）→ recordAudit 收到 ok:false，不再被记成成功', async () => {
    seedSuper()
    const { registries } = await import('../src/functions/adminApi/index')
    registries.ACTIONS.testFalseOk = async () => ({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: false, error: 'BIZ_FAIL' }) })
    try {
      const r = await post('testFalseOk', SUPER)
      expect(r.status).toBe(200)
      const log = control.dump('auditLog').find((l: any) => l.action === 'testFalseOk')
      expect(log).toBeTruthy()
      expect(log.ok).toBe(false)
    } finally {
      delete registries.ACTIONS.testFalseOk
    }
  })

  it('大白话：action 返 200+{ok:true} 仍记成功（不误伤正常路径）', async () => {
    seedSuper()
    const { registries } = await import('../src/functions/adminApi/index')
    registries.ACTIONS.testTrueOk = async () => ({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) })
    try {
      await post('testTrueOk', SUPER)
      const log = control.dump('auditLog').find((l: any) => l.action === 'testTrueOk')
      expect(log.ok).toBe(true)
    } finally {
      delete registries.ACTIONS.testTrueOk
    }
  })
})

// —— C4 refund:manage 最小只读面 —— //
describe('C4 refund:manage 独立可调最小只读面（admin:write 行为不变）', () => {
  const READ_ACTIONS = ['listRefunds', 'refundCounts', 'getRefundDetail', 'listOrders']
  // refund:manage 只需「越规退款的这一单」——退款专员对退款/售后记录（listRefunds/refundCounts/getRefundDetail）
  // 天然限域，但 listOrders 无过滤时是全店订单浏览、逐单回全文含全部客户 PII，故 refund:manage-only 调
  // listOrders 须携精确单号 q；下面 refmgr 循环给 listOrders 带 q 以过闸，无 q 场景单独在 P2 用例里验 403。
  const dataFor = (a: string) => (a === 'listOrders' ? { q: 'o-x' } : { id: 'x' })
  it('大白话：持 refund:manage 的中间角色可调四个只读面（过闸·非 403）', async () => {
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }, // checkKey 需 auth doc 存在才走多账号扫描
      { _id: 'refmgr', keyHash: sha('refund-mgr-key-1'), caps: ['refund:manage'], name: '退款专员' },
    ])
    for (const a of READ_ACTIONS) {
      const r = await post(a, 'refund-mgr-key-1', dataFor(a))
      expect(r.status).not.toBe(403) // 过能力闸（业务层可能 400/200·但绝非越权拒）
    }
    expect((await post('listOrders', 'refund-mgr-key-1', { q: 'o-x' })).status).toBe(200)
  })

  // P2 最小权限（评审发现·refund:manage 越权面收窄）：refund:manage-only 调 listOrders 无过滤 q 时须被拒——
  // 否则退款专员可翻遍全店订单+全部客户 PII，超出「核对越规退款这一单」的最小面；admin:write/'*' 行为不变。
  it('大白话：仅 refund:manage 调 listOrders 不带单号 q → 403（禁全店无过滤翻页）', async () => {
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
      { _id: 'refmgr', keyHash: sha('refund-mgr-key-1'), caps: ['refund:manage'], name: '退款专员' },
    ])
    expect((await post('listOrders', 'refund-mgr-key-1')).status).toBe(403) // 无 q
    expect((await post('listOrders', 'refund-mgr-key-1', { status: 'paid' })).status).toBe(403) // 状态过滤仍是多客户浏览、非精确单号
    expect((await post('listOrders', 'refund-mgr-key-1', { q: 'o-x' })).status).toBe(200) // 精确单号放行
  })

  it('大白话：admin:write（超管 * 通配）行为完全不变——四个只读面照旧可调，listOrders 无 q 仍可全店翻页', async () => {
    seedSuper()
    for (const a of READ_ACTIONS) {
      const r = await post(a, SUPER, { id: 'x' })
      expect(r.status).not.toBe(403)
    }
    expect((await post('listOrders', SUPER)).status).toBe(200) // 超管无过滤全店浏览不变
  })

  it('大白话：仅 agent:handle 的外包坐席对退款只读面仍 403（未误放）', async () => {
    control.seed('adminConfig', [
      { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
      { _id: 'agent-1', keyHash: sha('outsourced-key-1'), role: 'outsourced' },
    ])
    for (const a of READ_ACTIONS) {
      expect((await post(a, 'outsourced-key-1', { id: 'x' })).status).toBe(403)
    }
  })
})

// —— C5 listOrders refundHold 对齐 shipOne 三态 —— //
describe('C5 listOrders refundHold 判据含 applied（对齐 shipOne 拦截三态）', () => {
  it('大白话：applied（申请中·shipOne 会拦）的售后单 → listOrders 也标 refundHold（入口即提示勿发）', async () => {
    seedSuper()
    control.seed('orders', [
      { _id: 'o1', id: 'o1', _openid: 'oX', status: 'paid', amount: 100, createdAt: 2, items: [{ productId: 'p1', qty: 1 }] },
      { _id: 'o2', id: 'o2', _openid: 'oX', status: 'paid', amount: 100, createdAt: 1, items: [{ productId: 'p1', qty: 1 }] },
    ])
    control.seed('afterSales', [{ _id: 'as1', orderId: 'o1', lineId: 'p1__红', productId: 'p1', status: 'applied', appliedAt: 1 }])
    const r = await post('listOrders', SUPER)
    const o1 = r.list.find((x: any) => x._id === 'o1')
    const o2 = r.list.find((x: any) => x._id === 'o2')
    expect(o1.refundHold).toBe(true) // applied 单也标
    expect(o2.refundHold).toBe(false)
  })
})
