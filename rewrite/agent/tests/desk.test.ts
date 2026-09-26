// @vitest-environment happy-dom
// 坐席台轮询合并（黄金 cs-agent「会话流轮询增量合并」永恒语义）：
// 游标边界重复不重气泡/升序/同刻不同方向不同文是不同条/无时间戳不进流/游标只进不退空批不倒退。
// 后半挂载 Desk.vue：会话敏感的异步动作（切会话/发送/收会话/认领/拉列表）回包晚到时，只落到发起时那个会话。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import {
  mergeThread,
  keyOf,
  advanceCursor,
  normalizeMsgs,
  mapQueue,
  waitLabel,
  deskErrorText,
  filterQuickReplies,
  diffNewSessions,
  diffNewInbound,
  titleWithBadge,
  createStatusController,
  type Msg,
} from '../src/lib/desk'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('../src/api/client', () => ({ post: postMock, logout: vi.fn(), listKb: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))
import Desk from '../src/Desk.vue'

const m = (at: number, direction: 'in' | 'out', text: string): Msg => ({ at, direction, text })
const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1] // rewrite/agent tsconfig lib=ES2020，无 Array.prototype.at（ES2022）

type StatusRes = { ok: boolean; error?: string }
type Status = 'online' | 'busy' | 'offline'

// 手控 resolve 顺序的 post 桩：每次调用发一个可外部 resolve 的 promise，调用方按测试场景指定的顺序 settle。
function deferredPost() {
  const resolvers: Array<(v: StatusRes) => void> = []
  const post = (_action: string, _payload?: Record<string, unknown>) =>
    new Promise<StatusRes>((resolve) => {
      resolvers.push(resolve)
    })
  return { post, resolvers }
}

describe('会话流增量合并（黄金：不重气泡·升序）', () => {
  it('大白话：游标边界把同一条消息又发回来——不产生重复气泡；新消息并入后按时间排好', () => {
    const base = [m(1000, 'in', '在吗'), m(2000, 'out', '在的')]
    const merged = mergeThread(base, [
      { at: 2000, direction: 'out', text: '在的' }, // 边界重复
      { at: 1500, direction: 'in', text: '想退货' }, // 乱序增量
      { at: 3000, direction: 'in', text: '谢谢' },
    ])
    expect(merged.map((x) => x.text)).toEqual(['在吗', '想退货', '在的', '谢谢']) // 去重 + 升序
  })

  it('大白话：同一时刻，方向不同或内容不同都算不同条（不误杀）；无时间戳的脏消息不进流', () => {
    const merged = mergeThread([m(1000, 'in', '好')], [
      { at: 1000, direction: 'out', text: '好' }, // 同刻不同方向·保留
      { at: 1000, direction: 'in', text: '好的' }, // 同刻不同文·保留
      { direction: 'in', text: '没时间戳' }, // 脏·不进
      { at: 0, direction: 'in', text: '零时间戳' }, // 脏·不进
    ])
    expect(merged).toHaveLength(3)
    expect(normalizeMsgs('garbage')).toEqual([])
  })

  it('大白话：游标只进不退——空批/回了更小的游标都不倒退', () => {
    expect(advanceCursor(2000, 3000)).toBe(3000)
    expect(advanceCursor(2000, 1500)).toBe(2000) // 不倒退
    expect(advanceCursor(2000, undefined)).toBe(2000) // 空批不动
    expect(advanceCursor(0, 100)).toBe(100)
  })

  it('大白话：同秒两条非文本消息（图片，text 恒为占位）靠 msgid 分清，不再被旧键误杀（bug sweep II L1）', () => {
    const merged = mergeThread([], [
      { at: 5000, direction: 'in', msgtype: 'image', text: '[image]', msgid: 'wx-a' },
      { at: 5000, direction: 'in', msgtype: 'image', text: '[image]', msgid: 'wx-b' }, // 同 at/方向/占位文，不同 msgid——都留
    ])
    expect(merged).toHaveLength(2)
    // 同 msgid 重投递（轮询边界重复拉到同一条）仍按 msgid 去重，不重气泡
    const redelivered = mergeThread(merged, [{ at: 5000, direction: 'in', msgtype: 'image', text: '[image]', msgid: 'wx-a' }])
    expect(redelivered).toHaveLength(2)
    // 无 msgid（出站/历史档）回退旧键行为不变：同秒同方向同类同文视为同条
    const noId = mergeThread([m(6000, 'out', '收到')], [{ at: 6000, direction: 'out', text: '收到' }])
    expect(noId).toHaveLength(1)
  })
})

describe('快捷回复过滤 + 页内提醒聚合（B4·纯函数）', () => {
  it('大白话：剔除禁用/空 question 或 answer 的条目，保留 listKb 现行返回序（不额外排序）', () => {
    const list = filterQuickReplies([
      { key: 'a', question: '发货多久', answer: '48 小时内发出', category: 'logistics', enabled: true, order: 0 },
      { key: 'b', question: '', answer: '答案', category: 'other', enabled: true, order: 1 }, // 空 question·剔除
      { key: 'c', question: '问题', answer: '', category: 'other', enabled: true, order: 2 }, // 空 answer·剔除
      { key: 'd', question: '已下架条目', answer: '答案', category: 'other', enabled: false, order: 3 }, // 禁用·剔除（与 bot 侧 dispatch.ts 语义对齐）
      { key: 'e', question: '第二条', answer: '答案2', category: 'other', enabled: true, order: 4 },
    ])
    expect(list.map((e) => e.key)).toEqual(['a', 'e']) // 顺序照原样，不重排
  })

  it('大白话：脏形状/非数组不炸——空数组兜底', () => {
    expect(filterQuickReplies('garbage')).toEqual([])
    expect(filterQuickReplies([null, { question: 'q' }])).toEqual([]) // 无 answer 字段也剔除
  })

  it('大白话：队列新增会话数——首拉（prevIds 为 null）不算新增；之后只数没见过的 id；只减不增时为 0', () => {
    expect(diffNewSessions(null, ['s1', 's2'])).toBe(0) // 首拉
    expect(diffNewSessions(['s1'], ['s1', 's2', 's3'])).toBe(2) // 新增 s2/s3
    expect(diffNewSessions(['s1', 's2'], ['s1'])).toBe(0) // 只减不增
  })

  it('大白话：失焦期间当前会话新入站消息数——首拉不算；出站消息不计入；已见过的不重复计', () => {
    expect(diffNewInbound(null, [m(1000, 'in', '在吗')])).toBe(0) // 首拉
    const prev = [m(1000, 'in', '在吗')]
    const next = [m(1000, 'in', '在吗'), m(2000, 'in', '还在吗'), m(2100, 'out', '在的')]
    expect(diffNewInbound(prev, next)).toBe(1) // 只数新入站 1 条，出站不计、已见过的不重计
  })

  it('大白话：标题角标——n>0 加前缀，n=0 原样返回不叠前缀（恒幂等）', () => {
    expect(titleWithBadge('小棉鸭 · 坐席台', 3)).toBe('(3) 小棉鸭 · 坐席台')
    expect(titleWithBadge('小棉鸭 · 坐席台', 0)).toBe('小棉鸭 · 坐席台')
    expect(titleWithBadge(titleWithBadge('小棉鸭 · 坐席台', 0), 0)).toBe('小棉鸭 · 坐席台') // 反复套 n=0 不叠加
  })
})

describe('气泡 :key 与去重键 keyOf 同源（深审20260712 P2·防再漂移）', () => {
  it('大白话：同秒同向两张图（msgid 不同、text 恒为占位）keyOf 不同——去重能留两条、Vue key 也不撞；无 msgid 回退键含 msgtype 且稳定', () => {
    const a: Msg = { at: 5000, direction: 'in', text: '[image]', msgtype: 'image', msgid: 'wx-a' }
    const b: Msg = { ...a, msgid: 'wx-b' }
    expect(keyOf(a)).toBe('id:wx-a')
    expect(keyOf(a)).not.toBe(keyOf(b))
    expect(keyOf({ at: 1000, direction: 'out', text: '好', msgtype: 'text' })).toBe('1000|out|text|好')
    expect(keyOf({ at: 1000, direction: 'out', text: '好' })).toBe('1000|out||好') // msgtype 缺省稳定
  })
})

describe('队列与错误人话', () => {
  it('大白话：队列行带等待时长人话；脏行剔除；错误码给人话原文兜底', () => {
    const now = 1_000_000
    const q = mapQueue([
      { sessionId: 's1', externalUserId: 'eu1', status: 'pending', createdAt: now - 90_000 },
      { nosid: true },
    ], now)
    expect(q).toHaveLength(1)
    expect(q[0].waitLabel).toBe('1 分钟')
    expect(waitLabel(now - 30_000, now)).toBe('30 秒')
    expect(waitLabel(now - 3_700_000, now)).toBe('1 小时 1 分')
    expect(deskErrorText('AT_CAPACITY')).toContain('满了')
    expect(deskErrorText('NO_CONSENT')).toContain('同意')
    expect(deskErrorText('X_ODD')).toContain('X_ODD') // 原文兜底
  })
})

describe('坐席状态并发收敛（setStatus·Round3 item3 三场景，钉住 lib/desk 真代码）', () => {
  it('大白话：fresh 请求失败 + stale 请求后到成功——静止后 UI 收到最新代际的成功目标，不被过期失败卡住', async () => {
    const { post, resolvers } = deferredPost()
    const ctl = createStatusController(post, 'online')
    const applied: Status[] = []
    const messages: string[] = []
    const apply = { setStatus: (v: Status) => applied.push(v), setMessage: (v: string) => messages.push(v) }

    const p1 = ctl.setStatus('busy', apply, deskErrorText) // my=1，先发
    const p2 = ctl.setStatus('offline', apply, deskErrorText) // my=2，后发（fresh）
    resolvers[1]({ ok: false, error: 'BAD' }) // fresh(my=2) 先回包且失败
    await Promise.resolve() // 放行该回包的微任务链
    await Promise.resolve()
    resolvers[0]({ ok: true }) // stale(my=1) 后回包且成功
    await p1
    await p2

    expect(last(applied)).toBe('busy') // 静止收敛：锚被 my=1 的成功推到 busy（my=2 失败不倒退锚），UI 最终=busy=服务端真值
    expect(messages).toEqual(['操作没成功（BAD）']) // 既有语义：报错只对「回包时仍是最新一次调用」的那次弹（my=2 回包时确是当时最新，deskErrorText 未知码兜底原文）
  })

  it('大白话：两次都成功但先发的后到——后一次用户意图（更大代际）赢，不被旧的成功回填', async () => {
    const { post, resolvers } = deferredPost()
    const ctl = createStatusController(post, 'online')
    const applied: Status[] = []
    const apply = { setStatus: (v: Status) => applied.push(v), setMessage: () => {} }

    const p1 = ctl.setStatus('busy', apply, deskErrorText) // my=1，先发
    const p2 = ctl.setStatus('offline', apply, deskErrorText) // my=2，后发
    resolvers[1]({ ok: true }) // my=2 先回包成功——锚推到 offline
    await Promise.resolve()
    await Promise.resolve()
    resolvers[0]({ ok: true }) // my=1 后回包成功——代际更旧，不得倒退锚
    await p1
    await p2

    expect(last(applied)).toBe('offline') // 锚保持在最后用户意图 offline，未被 my=1 的迟到成功覆盖回 busy
  })

  it('大白话：单请求成功/失败——与现状等价（成功收敛到目标；失败回滚到锚并报错）', async () => {
    {
      const { post, resolvers } = deferredPost()
      const ctl = createStatusController(post, 'online')
      const applied: Status[] = []
      const p = ctl.setStatus('busy', { setStatus: (v) => applied.push(v), setMessage: () => {} }, deskErrorText)
      resolvers[0]({ ok: true })
      await p
      expect(last(applied)).toBe('busy')
    }
    {
      const { post, resolvers } = deferredPost()
      const ctl = createStatusController(post, 'online')
      const applied: Status[] = []
      const messages: string[] = []
      const p = ctl.setStatus('busy', { setStatus: (v) => applied.push(v), setMessage: (v) => messages.push(v) }, deskErrorText)
      resolvers[0]({ ok: false, error: 'NOPE' })
      await p
      expect(last(applied)).toBe('online') // 回滚到锚（初始 online，从未被确认过更新目标）
      expect(messages).toEqual(['操作没成功（NOPE）'])
    }
  })
})

describe('hasMedia 透传（B5·顾客发图坐席可见·纯函数半边）', () => {
  it('大白话：normalizeMsgs 把服务端 hasMedia 标记原样带过来（缺省视 false，脏值转布尔）；mergeThread 合并后保留', () => {
    const withMedia = normalizeMsgs([{ at: 1000, direction: 'in', text: '[image]', msgtype: 'image', msgid: 'img-1', hasMedia: true }])
    expect(withMedia[0].hasMedia).toBe(true)
    const noMedia = normalizeMsgs([{ at: 1000, direction: 'in', text: '在吗', msgtype: 'text', msgid: 'txt-1' }])
    expect(noMedia[0].hasMedia).toBe(false) // 缺省当 false（不渲染图片气泡·回退纯文本）
    const merged = mergeThread([], [{ at: 2000, direction: 'in', text: '[image]', msgtype: 'image', msgid: 'img-2', hasMedia: true }])
    expect(merged[0].hasMedia).toBe(true) // 合并进流后仍保留标记
  })
})

// —— Desk.vue 挂载 ——
type Handler = (data: any) => unknown
const gate = () => {
  let release: (v: unknown) => void = () => {}
  const p = new Promise((r) => (release = r))
  return { p, release: (v: unknown) => release(v) }
}
const Q1 = { sessionId: 'q1', externalUserId: 'wm-q00001', status: 'pending', createdAt: Date.now() }
function serve(over: Record<string, Handler> = {}) {
  postMock.mockReset().mockImplementation(async (action: string, data: any) => {
    if (over[action]) return over[action](data)
    if (action === 'listMyActive') return { ok: true, sessions: [{ sessionId: 's1', externalUserId: 'wm-000001' }, { sessionId: 's2', externalUserId: 'wm-000002' }] }
    if (action === 'listQueue') return { ok: true, items: [] }
    if (action === 'getThread') return { ok: true, messages: [], nextCursor: 0 }
    if (action === 'getSessionCustomer360') return { ok: true, panels: [{ key: 'profile', label: '画像', data: { 会话: data.sessionId } }] }
    return { ok: true }
  })
}
const mounted: VueWrapper[] = []
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})
async function mountDesk() {
  const w = mount(Desk)
  mounted.push(w)
  await flushPromises()
  return w
}
const mineItems = (w: VueWrapper) => w.findAll('aside .qitem').filter((q) => !q.find('.qinfo').exists())
async function openMine(w: VueWrapper, i: number) {
  await mineItems(w)[i].trigger('click')
  await flushPromises()
}
const btn = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text() === text)!
const draft = (w: VueWrapper) => (w.find('textarea').element as HTMLTextAreaElement).value
const calls = (action: string) => postMock.mock.calls.filter((c) => c[0] === action)

describe('Desk.vue 坐席状态', () => {
  it('大白话：切状态被拒——下拉回到上次确认的状态并报错，不停在没生效的选项上', async () => {
    serve({ setAgentStatus: () => ({ ok: false, error: 'NOPE' }) })
    const w = await mountDesk()
    await w.find('select').setValue('busy')
    await flushPromises()
    expect(calls('setAgentStatus').map((c) => c[1])).toEqual([{ status: 'busy' }])
    expect((w.find('select').element as HTMLSelectElement).value).toBe('online')
    expect(w.find('.status').text()).toBe('操作没成功（NOPE）')
  })

  it('大白话：先切忙碌再切离线，离线先成功、忙碌后到失败——下拉停在离线（服务端真值），不回退、不报错', async () => {
    const busy = gate()
    const off = gate()
    serve({ setAgentStatus: (d) => (d.status === 'busy' ? busy.p : off.p) })
    const w = await mountDesk()
    await w.find('select').setValue('busy')
    await w.find('select').setValue('offline')
    off.release({ ok: true })
    await flushPromises()
    busy.release({ ok: false, error: 'NOPE' })
    await flushPromises()
    expect((w.find('select').element as HTMLSelectElement).value).toBe('offline')
    expect(w.find('.status').exists()).toBe(false)
  })
})

describe('Desk.vue 切会话与发送', () => {
  it('大白话：切到别的会话清掉没发出的草稿（防跨会话误发）；点回当前会话不清', async () => {
    serve()
    const w = await mountDesk()
    await openMine(w, 0)
    await w.find('textarea').setValue('给一号的话')
    await openMine(w, 0)
    expect(draft(w)).toBe('给一号的话')
    await openMine(w, 1)
    expect(draft(w)).toBe('')
  })

  it('大白话：一号发送在途不拦二号发送；一号晚到的失败不清二号正在打的字、不把报错标到二号上；回到一号还能发', async () => {
    const a = gate()
    serve({ sendAgentMessage: (d) => (d.sessionId === 's1' ? a.p : { ok: true }) })
    const w = await mountDesk()
    await openMine(w, 0)
    await w.find('textarea').setValue('给一号')
    await btn(w, '发送').trigger('click')
    expect(btn(w, '发送').attributes('disabled')).toBeDefined()

    await openMine(w, 1)
    expect(btn(w, '发送').attributes('disabled')).toBeUndefined()
    await w.find('textarea').setValue('给二号')
    await btn(w, '发送').trigger('click')
    await flushPromises()
    expect(calls('sendAgentMessage').map((c) => c[1])).toEqual([
      { sessionId: 's1', text: '给一号' },
      { sessionId: 's2', text: '给二号' },
    ])
    expect(draft(w)).toBe('') // 二号发成功才清框

    await w.find('textarea').setValue('二号草稿')
    a.release({ ok: false, error: 'SEND_FAIL' })
    await flushPromises()
    expect(draft(w)).toBe('二号草稿')
    expect(w.find('.status').exists()).toBe(false)
    await openMine(w, 0)
    expect(btn(w, '发送').attributes('disabled')).toBeUndefined()
  })

  it('大白话：输入框最多 2000 字；快到上限（≥1900）才显示已打字数', async () => {
    serve()
    const w = await mountDesk()
    await openMine(w, 0)
    expect(w.find('textarea').attributes('maxlength')).toBe('2000')
    await w.find('textarea').setValue('字'.repeat(1899))
    expect(w.find('.charcount').exists()).toBe(false)
    await w.find('textarea').setValue('字'.repeat(1900))
    expect(w.find('.charcount').text()).toBe('1900/2000')
  })
})

describe('Desk.vue 收会话（放回/结束/升级）', () => {
  it.each([
    ['放回队列', 'releaseConversation'],
    ['结束会话', 'closeConversation'],
    ['升级给商户', 'escalateToMerchant'],
  ])('大白话：%s成功——会话窗和右栏顾客资料一起清掉（别的坐席接手时不残留上一客户资料），列表刷新', async (label, action) => {
    serve()
    const w = await mountDesk()
    await openMine(w, 0)
    expect(w.find('aside.right .panel').text()).toContain('s1')
    const lists = calls('listQueue').length
    await btn(w, label).trigger('click')
    await flushPromises()
    expect(calls(action).map((c) => c[1])).toEqual([{ sessionId: 's1' }])
    expect(w.find('textarea').exists()).toBe(false)
    expect(w.find('aside.right .panel').exists()).toBe(false)
    expect(calls('listQueue').length).toBe(lists + 1)
  })

  it('大白话：结束一号在途时切到二号——一号的回包不清二号的会话窗与资料、不报错，列表照刷', async () => {
    const a = gate()
    serve({ closeConversation: () => a.p })
    const w = await mountDesk()
    await openMine(w, 0)
    await btn(w, '结束会话').trigger('click')
    await openMine(w, 1)
    const lists = calls('listQueue').length
    a.release({ ok: true })
    await flushPromises()
    expect(mineItems(w)[1].classes()).toContain('on')
    expect(w.find('textarea').exists()).toBe(true)
    expect(w.find('aside.right .panel').text()).toContain('s2')
    expect(w.find('.status').exists()).toBe(false)
    expect(calls('listQueue').length).toBe(lists + 1)
  })
})

describe('Desk.vue 认领', () => {
  it('大白话：没切走时认领成功——直接打开认领的会话', async () => {
    serve({ listQueue: () => ({ ok: true, items: [Q1] }) })
    const w = await mountDesk()
    await btn(w, '接').trigger('click')
    await flushPromises()
    expect(calls('getThread').map((c) => c[1].sessionId)).toEqual(['q1'])
  })

  it('大白话：认领在途时切去二号打字——认领回包不把视图拽回、不清二号的字；列表照刷', async () => {
    const c = gate()
    serve({ listQueue: () => ({ ok: true, items: [Q1] }), claimConversation: () => c.p })
    const w = await mountDesk()
    await btn(w, '接').trigger('click')
    await openMine(w, 1)
    await w.find('textarea').setValue('二号草稿')
    const lists = calls('listQueue').length
    c.release({ ok: true })
    await flushPromises()
    expect(mineItems(w)[1].classes()).toContain('on')
    expect(draft(w)).toBe('二号草稿')
    expect(calls('getThread').some((x) => x[1].sessionId === 'q1')).toBe(false)
    expect(calls('listQueue').length).toBe(lists + 1)
  })
})

describe('Desk.vue 拉取失败出声（失败≠空态）', () => {
  it('大白话：首屏拉队列失败——写明原因，不装成「队列空 ✓」；真空才显队列空', async () => {
    serve()
    expect((await mountDesk()).text()).toContain('队列空 ✓')
    serve({ listQueue: () => ({ ok: false, error: 'NETWORK:boom' }) })
    const w = await mountDesk()
    expect(w.findAll('aside')[0].find('.note').text()).toBe(deskErrorText('NETWORK:boom'))
    expect(w.text()).not.toContain('队列空 ✓')
  })

  it('大白话：待接超过一页（云端回了 nextCursor）——写明列表没显示全部，不让坐席以为只有这几个人在等', async () => {
    serve({ listQueue: () => ({ ok: true, items: [Q1], nextCursor: { v: 1, id: 'q1' } }) })
    const w = await mountDesk()
    expect(w.findAll('aside')[0].text()).toContain('待接不止 1 条，列表未显示全部')
    serve({ listQueue: () => ({ ok: true, items: [Q1] }) })
    const w2 = await mountDesk()
    expect(w2.text()).not.toContain('列表未显示全部')
  })

  it('大白话：已拉到排队后再刷新失败——排队不清、写明原因', async () => {
    let q: unknown = { ok: true, items: [Q1] }
    serve({ listQueue: () => q })
    const w = await mountDesk()
    q = { ok: false, error: 'NETWORK:boom' }
    await openMine(w, 0)
    await btn(w, '放回队列').trigger('click')
    await flushPromises()
    expect(w.findAll('aside .qinfo')).toHaveLength(1)
    expect(w.findAll('aside')[0].find('.note').text()).toBe(deskErrorText('NETWORK:boom'))
  })

  it('大白话：打开会话拉消息/顾客资料失败都写明原因；后台 3 秒轮询失败不出声，拉到了就把提示收掉', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let t: unknown = { ok: true, messages: [], nextCursor: 0 }
    serve({ getThread: () => t, getSessionCustomer360: () => ({ ok: false, error: 'NO_CONSENT' }) })
    const w = await mountDesk()
    await openMine(w, 0)
    expect(w.find('main .note').exists()).toBe(false)
    expect(w.find('aside.right .note').text()).toBe(deskErrorText('NO_CONSENT'))

    t = { ok: false, error: 'NETWORK:boom' }
    vi.advanceTimersByTime(3_000)
    await flushPromises()
    expect(w.find('main .note').exists()).toBe(false) // 后台轮询静默

    await openMine(w, 1)
    expect(w.find('main .note').text()).toBe(deskErrorText('NETWORK:boom'))
    t = { ok: true, messages: [], nextCursor: 0 }
    vi.advanceTimersByTime(3_000)
    await flushPromises()
    expect(w.find('main .note').exists()).toBe(false)
  })
})

describe('Desk.vue 卸载', () => {
  it('大白话：失焦时来了新排队，标题带角标；卸载时标题还原、定时轮询停掉', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    document.title = '小棉鸭 · 坐席台'
    let items: unknown[] = []
    serve({ listQueue: () => ({ ok: true, items }) })
    const w = mount(Desk)
    await flushPromises()
    window.dispatchEvent(new Event('blur'))
    items = [Q1]
    vi.advanceTimersByTime(10_000)
    await flushPromises()
    expect(document.title).toBe('(1) 小棉鸭 · 坐席台')

    await openMine(w, 0) // 开着会话才有 3 秒拉消息的轮询可停
    w.unmount()
    expect(document.title).toBe('小棉鸭 · 坐席台')
    const threads = calls('getThread').length
    const lists = calls('listQueue').length
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(calls('getThread').length).toBe(threads)
    expect(calls('listQueue').length).toBe(lists)
  })
})
