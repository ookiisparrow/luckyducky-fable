// 坐席台轮询合并（守卫 rw-agent-ui-golden·黄金 cs-agent「会话流轮询增量合并」永恒语义）：
// 游标边界重复不重气泡/升序/同刻不同方向不同文是不同条/无时间戳不进流/游标只进不退空批不倒退。
import { describe, it, expect } from 'vitest'
import { mergeThread, advanceCursor, normalizeMsgs, mapQueue, waitLabel, deskErrorText, type Msg } from '../src/lib/desk'
import { parse } from '@vue/compiler-sfc'
import { transform } from 'esbuild'
// Desk.vue 原文按 Vite 内建 ?raw 取纯文本（vite/client.d.ts 声明了 `*?raw` 环境模块类型，rewrite/agent/tsconfig.json
// 的 "types":["vite/client"] 已覆盖·免装 @vue/test-utils/jsdom，也免碰本仓白名单外的 node 类型/tsconfig）。
import deskSrc from '../src/Desk.vue?raw'

const m = (at: number, direction: 'in' | 'out', text: string): Msg => ({ at, direction, text })
const last = <T>(arr: T[]): T | undefined => arr[arr.length - 1] // rewrite/agent tsconfig lib=ES2020，无 Array.prototype.at（ES2022）

// Desk.vue setStatus 并发收敛（Round3 item3·findings 复审新增回归测）：仓库没装 @vue/test-utils/jsdom，不便
// mount 整个 .vue 组件；Desk.vue 顶部专门放了一个与 Vue 无关的非 setup <script> 块导出 createStatusController
// （纯函数，UI 落地经 apply 回调交回调用方）。这里用 @vue/compiler-sfc 的 parse() 把那块源码原样抽出、esbuild
// 剥 TS 类型后拼成 data: URL 动态 import——测的是 Desk.vue 里那份真代码，不是另抄一份影子实现；改了这段逻辑
// 这里会真的红。不落临时文件（不碰 node:fs/os/path，规避白名单外 tsconfig 缺 "node" 类型的连锁改动）。
type StatusRes = { ok: boolean; error?: string }
type Status = 'online' | 'busy' | 'offline'
async function loadStatusController(): Promise<{
  createStatusController: (
    post: (action: string, payload?: Record<string, unknown>) => Promise<StatusRes>,
    initial?: Status,
  ) => { setStatus: (s: Status, apply: { setStatus: (v: Status) => void; setMessage: (v: string) => void }, errorText: (c: string | undefined) => string) => Promise<void> }
}> {
  const { descriptor } = parse(deskSrc)
  if (!descriptor.script?.content) throw new Error('Desk.vue 缺少非 setup 的 <script> 块（createStatusController 应放这里）——测试抽不到真代码')
  const { code } = await transform(descriptor.script.content, { loader: 'ts', format: 'esm' })
  // data: URL 直接塞 URI 编码文本（不用 base64/Buffer——Buffer 全局类型来自 @types/node，本 tsconfig 未装，
  // encodeURIComponent 是标准全局、任意 tsconfig 下都认得，且原文含中文注释，天然免走 Latin1-only 的 btoa）。
  const dataUrl = 'data:text/javascript,' + encodeURIComponent(code)
  return import(/* @vite-ignore */ dataUrl)
}

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

describe('坐席状态并发收敛（setStatus·Round3 item3 三场景，钉住 Desk.vue 真代码）', () => {
  it('大白话：fresh 请求失败 + stale 请求后到成功——静止后 UI 收到最新代际的成功目标，不被过期失败卡住', async () => {
    const { createStatusController } = await loadStatusController()
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
    const { createStatusController } = await loadStatusController()
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
    const { createStatusController } = await loadStatusController()
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
