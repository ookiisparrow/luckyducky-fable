// 坐席台轮询合并（守卫 rw-agent-ui-golden·黄金 cs-agent「会话流轮询增量合并」永恒语义）：
// 游标边界重复不重气泡/升序/同刻不同方向不同文是不同条/无时间戳不进流/游标只进不退空批不倒退。
import { describe, it, expect } from 'vitest'
import {
  mergeThread,
  advanceCursor,
  normalizeMsgs,
  mapQueue,
  waitLabel,
  deskErrorText,
  filterQuickReplies,
  diffNewSessions,
  diffNewInbound,
  titleWithBadge,
  type Msg,
} from '../src/lib/desk'
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

// B2/B3 源码断言用：从 <script setup> 原文里抠出指定函数的完整函数体（花括号配平·跳过注释/字符串内的花括号，
// 避免 E1 同类坑——裸括号计数会被注释里的 { } 或字符串里的 { } 带偏）。只服务本文件的静态断言，不是 check-structure.mjs
// 的守卫 helper，不复用/不冒充 methodBody()+stripComments() 共享实现。
function extractFunctionBody(src: string, signature: string): string {
  const start = src.indexOf(signature)
  if (start === -1) throw new Error('函数签名未找到：' + signature)
  // signature 若自带结尾 '{'（调用方传参写法），起点就是它自身，不再往后找——否则会跳过函数体第一个 '{'
  // 命中函数体内更靠后的对象字面量花括号（B2/B3 现场踩过：`{ sessionId }` 解构把起点带偏）。
  const braceStart = signature.trimEnd().endsWith('{') ? start + signature.length - 1 : src.indexOf('{', start + signature.length)
  if (braceStart === -1) throw new Error('函数体起始 { 未找到：' + signature)
  let depth = 0
  let inLineComment = false
  let inBlockComment = false
  let inString: string | null = null
  // I2（防线·执行者错题本 E1 在测试层的翻版）：返回值须是剥去注释后的函数体，不是原始切片——原始切片里
  // 若「保护代码被注释掉」，注释文本本身仍会命中 toMatch/indexOf 正则，断言假绿。逐字符扫描时同步攒 out，
  // 跳过注释段（行注释/块注释不写入 out），字符串字面量内容原样保留（断言认代码 token，不认字符串内容）。
  let out = ''
  for (let j = braceStart; j < src.length; j++) {
    const c = src[j]
    const c2 = src[j + 1]
    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false
        out += c
      }
      continue
    }
    if (inBlockComment) {
      if (c === '*' && c2 === '/') {
        inBlockComment = false
        j++
      } else if (c === '\n') {
        out += c
      }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') {
        j++
        out += src[j] ?? ''
        continue
      }
      if (c === inString) inString = null
      continue
    }
    if (c === '/' && c2 === '/') {
      inLineComment = true
      j++
      continue
    }
    if (c === '/' && c2 === '*') {
      inBlockComment = true
      j++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c
      out += c
      continue
    }
    if (c === '{') {
      depth++
      out += c
    } else if (c === '}') {
      depth--
      out += c
      if (depth === 0) return out
    } else {
      out += c
    }
  }
  throw new Error('函数体未闭合：' + signature)
}

function scriptSetupSrc(): string {
  const { descriptor } = parse(deskSrc)
  if (!descriptor.scriptSetup?.content) throw new Error('Desk.vue 缺少 <script setup> 块——测试抽不到真代码')
  return descriptor.scriptSetup.content
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

describe('open() 切会话清未发草稿（B2·源码断言：钉住 Desk.vue 真代码，不是另抄影子实现）', () => {
  it('大白话：切到别的会话前必须先清 draft——防跨会话误发；且清草稿判断须在改 currentId 之前，不能顺序颠倒', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'async function open(sessionId: string) {')
    const draftClearRe = /if\s*\(\s*sessionId\s*!==\s*currentId\.value\s*\)\s*draft\.value\s*=\s*['"]{2}/
    expect(body).toMatch(draftClearRe)
    const draftClearIdx = body.search(draftClearRe)
    const assignCurrentIdx = body.indexOf('currentId.value = sessionId')
    expect(assignCurrentIdx).toBeGreaterThan(-1)
    // 顺序铁律：draft 清理必须读到「切换前」的 currentId.value，因此判断句必须出现在赋值之前
    expect(draftClearIdx).toBeLessThan(assignCurrentIdx)
  })
})

describe('send() 会话代际快照（F4·同 act()/open() 治法·源码断言）', () => {
  it('大白话：send() 必须先快照 sid 再用 sid 发消息，回包后清 draft/message/pollThread 须用 currentId===sid 复核落地——过期回包不得清掉用户正在新会话打的字', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'async function send() {')
    expect(body).toMatch(/const sid = currentId\.value/)
    // post 携带的是快照 sid，不是随时会变的 currentId.value
    expect(body).toMatch(/post\(\s*'sendAgentMessage'\s*,\s*\{\s*sessionId:\s*sid\s*,\s*text\s*\}\s*\)/)
    expect(body).not.toMatch(/sessionId:\s*currentId\.value\s*,\s*text/)
    const guardRe = /if\s*\(\s*currentId\.value === sid\s*\)\s*\{/
    expect(body).toMatch(guardRe)
    const guardIdx = body.search(guardRe)
    expect(guardIdx).toBeGreaterThan(-1)
    // 三处 UI 落地效果须落在复核 if 之内
    const draftClearIdx = body.indexOf("draft.value = ''")
    const pollIdx = body.indexOf('void pollThread()')
    const messageAssignIdx = body.indexOf('message.value = deskErrorText(r.error)')
    expect(draftClearIdx).toBeGreaterThan(guardIdx)
    expect(pollIdx).toBeGreaterThan(guardIdx)
    expect(messageAssignIdx).toBeGreaterThan(guardIdx)
    // busy 复位须无条件执行（不受 sid 复核约束）：否则切会话后发送按钮永久卡死不可用——须落在 guard 起点之前
    const busyResetIdx = body.indexOf('busy.value = false')
    expect(busyResetIdx).toBeGreaterThan(-1)
    expect(busyResetIdx).toBeLessThan(guardIdx)
  })
})

describe('act() 会话代际快照（B3·同 pollThread/open 治法·源码断言）', () => {
  it('大白话：act() 必须先快照 sid 再用 sid 请求，回包后的 UI 效果须用 currentId===sid 复核才落地——过期回包不得清掉/标错正在看的新会话', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'async function act(action: string) {')
    expect(body).toMatch(/const sid = currentId\.value/)
    // post 携带的是快照 sid，不是随时会变的 currentId.value
    expect(body).toMatch(/post\(\s*action\s*,\s*\{\s*sessionId:\s*sid\s*\}\s*\)/)
    expect(body).not.toMatch(/post\(\s*action\s*,\s*\{\s*sessionId:\s*currentId\.value\s*\}\s*\)/)
    // UI 落地效果（message 赋值 + 三 action 的清 currentId/msgs）须被 currentId.value === sid 复核包住
    const guardRe = /if\s*\(\s*currentId\.value === sid\s*\)\s*\{/
    expect(body).toMatch(guardRe)
    const guardIdx = body.search(guardRe)
    expect(guardIdx).toBeGreaterThan(-1)
    const messageAssignIdx = body.indexOf("message.value = r.ok ? '' : deskErrorText(r.error)")
    const clearCurrentIdx = body.indexOf("currentId.value = ''")
    expect(messageAssignIdx).toBeGreaterThan(guardIdx) // message 赋值须落在复核 if 之内（在 guard 起点之后）
    expect(clearCurrentIdx).toBeGreaterThan(guardIdx) // 清 currentId/msgs 也须落在复核 if 之内
    // refreshLists 必须无条件执行（不受 sid 复核约束）：出现在函数体末尾、且不早于两处 UI 效果
    const refreshIdx = body.indexOf('void refreshLists()')
    expect(refreshIdx).toBeGreaterThan(clearCurrentIdx)
  })

  it('大白话：三个收会话动作（放回队列/结束会话/升级商户）成功后须同批清 panels/panelNote——右栏顾客360无 currentId 门控，不清会残留上一客户资料给下一个接手的坐席看见（K1·PII 残留）', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'async function act(action: string) {')
    const clearCurrentIdx = body.indexOf("currentId.value = ''")
    const clearMsgsIdx = body.indexOf('msgs.value = []')
    const clearPanelsIdx = body.indexOf('panels.value = []')
    const clearPanelNoteIdx = body.indexOf("panelNote.value = ''")
    expect(clearPanelsIdx).toBeGreaterThan(-1)
    expect(clearPanelNoteIdx).toBeGreaterThan(-1)
    // 与 currentId/msgs 并列在同一成功分支内清空（都在三 action 判断的花括号内，晚于两者出现）
    expect(clearPanelsIdx).toBeGreaterThan(clearCurrentIdx)
    expect(clearPanelsIdx).toBeGreaterThan(clearMsgsIdx)
    expect(clearPanelNoteIdx).toBeGreaterThan(clearPanelsIdx)
    // 仍须落在 sid 复核 if 之内、refreshLists 之前
    const guardIdx = body.search(/if\s*\(\s*currentId\.value === sid\s*\)\s*\{/)
    const refreshIdx = body.indexOf('void refreshLists()')
    expect(clearPanelsIdx).toBeGreaterThan(guardIdx)
    expect(refreshIdx).toBeGreaterThan(clearPanelNoteIdx)
  })
})

describe('onBeforeUnmount 标题复位（B4 后审 P2·源码断言）', () => {
  it('大白话：组件卸载须还原 document.title——失焦掉线登出会带角标态卸载，不还原则标题永久残留，且下次重登 mount 会把污染态当新 baseTitle 捕获、跨循环复合叠加', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'onBeforeUnmount(() => {')
    expect(body).toMatch(/document\.title = baseTitle/)
    // 既有清理不得被顺手删掉（回归网）
    expect(body).toMatch(/clearInterval\(pollTimer\)/)
    expect(body).toMatch(/clearInterval\(listTimer\)/)
    expect(body).toMatch(/removeEventListener\('blur', onWindowBlur\)/)
    expect(body).toMatch(/removeEventListener\('focus', onWindowFocus\)/)
  })
})

describe('claim() 会话代际快照（bug sweep II R5·五个会话敏感异步动作的最后收口·源码断言）', () => {
  it('大白话：claim() 须快照点击时的 currentId，回包后 message/open 须复核未切走才落地——慢回包不得把视图拽回、不得经 open 清掉坐席在新会话打的字；refreshLists 无条件', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'async function claim(sessionId: string) {')
    expect(body).toMatch(/const before = currentId\.value/)
    const guardRe = /if\s*\(\s*currentId\.value === before\s*\)\s*\{/
    expect(body).toMatch(guardRe)
    const guardIdx = body.search(guardRe)
    const messageIdx = body.indexOf("message.value = r.ok ? '' : deskErrorText(r.error)")
    const openIdx = body.indexOf('void open(sessionId)')
    expect(messageIdx).toBeGreaterThan(guardIdx) // message 赋值落在复核内
    expect(openIdx).toBeGreaterThan(guardIdx) // open（会拽视图+清草稿）落在复核内
    const refreshIdx = body.indexOf('void refreshLists()')
    expect(refreshIdx).toBeGreaterThan(openIdx) // 列表刷新无条件、居末
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

describe('Desk.vue 图片气泡（B5·顾客发图坐席可见·源码断言：钉住真代码，不抄影子实现）', () => {
  it('大白话：loadMedia 须快照点击时的会话 sid（同 send/act/claim 治法），已加载/加载中直接跳过不重复触发下载，EXPIRED 与其余失败分两态（前者不可重试、后者可重试）', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'async function loadMedia(m: Msg) {')
    expect(body).toMatch(/const sid = currentId\.value/) // 归属会话快照，不用随时会变的 currentId.value 直接发请求
    expect(body).toMatch(/post\(\s*'getMediaUrl'\s*,\s*\{\s*sessionId:\s*sid\s*,\s*msgId:\s*key\s*\}\s*\)/)
    // 已加载/加载中提前 return，不重复触发下载（幂等点击）
    const guardIdx = body.search(/if\s*\(\s*existing\s*&&\s*\(\s*existing\.state === 'loaded' \|\| existing\.state === 'loading'\s*\)\s*\)\s*return/)
    expect(guardIdx).toBeGreaterThan(-1)
    // EXPIRED 与其余失败必须分两个不同分支落两个不同 state（不能把 EXPIRED 并进通用失败态）
    const expiredIdx = body.indexOf("mediaCache[key] = { state: 'expired' }")
    const errorIdx = body.indexOf("mediaCache[key] = { state: 'error' }")
    expect(expiredIdx).toBeGreaterThan(-1)
    expect(errorIdx).toBeGreaterThan(-1)
    expect(expiredIdx).not.toBe(errorIdx)
    expect(body).toMatch(/r\.error === 'EXPIRED'/) // EXPIRED 判定须读服务端语义码，不是猜的
  })

  it('大白话：占位卡点击只在 idle/失败态触发下载——加载中/已加载/已过期点击一律 no-op（已过期没有重试路径）', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'function onMediaClick(m: Msg) {')
    expect(body).toMatch(/if\s*\(\s*s === 'idle' \|\| s === 'error'\s*\)\s*void loadMedia\(m\)/)
    expect(body).not.toMatch(/s === 'expired'/) // 已过期不应出现在触发下载的条件里
  })

  it('大白话：查看大图只在已加载态才 window.open，防止对占位/加载中/失败态误开空 URL', () => {
    const body = extractFunctionBody(scriptSetupSrc(), 'function openMedia(m: Msg) {')
    expect(body).toMatch(/if\s*\(\s*c\.state === 'loaded' && c\.url\s*\)\s*window\.open\(c\.url, '_blank'\)/)
  })

  it('大白话：消息气泡模板须按 msgtype===image && hasMedia 分流到图片气泡，其余（含 image 但无 mediaId 的历史档）回退纯文本', () => {
    const { descriptor } = parse(deskSrc)
    const tpl = descriptor.template?.content || ''
    expect(tpl).toMatch(/v-if="m\.msgtype === 'image' && m\.hasMedia"/)
    expect(tpl).toMatch(/@click="onMediaClick\(m\)"/)
    expect(tpl).toMatch(/@click="openMedia\(m\)"/)
    expect(tpl).toMatch(/图片已过期（超 3 天）/)
    expect(tpl).toMatch(/加载失败，点击重试/)
  })
})
