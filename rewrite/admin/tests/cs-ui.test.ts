// 客服组映射（守卫 rw-admin-cs-ui-golden）：时长人话/报表 approx 诚实透传/360 单面板失败隔离/
// 命中依据中文/kb 行归一/满意度分布。
import { describe, it, expect } from 'vitest'
import { msHuman, mapReport, mapPanels, matchLabel, normalizeKb, mapCsat, mapCsatEntries, mapMessages, nextNodeId, duplicateNodeIds } from '../src/lib/mapCs'
import customer360Src from '../src/pages/Customer360.vue?raw'

describe('时长人话与报表', () => {
  it('大白话：秒/分/小时逐级人话；非法回 —；报表 approx 时明标「估算」，否则标「全量精确」', () => {
    expect(msHuman(32_000)).toBe('32 秒')
    expect(msHuman(250_000)).toBe('4 分 10 秒')
    expect(msHuman(7_500_000)).toBe('2 小时 5 分')
    expect(msHuman('abc')).toBe('—')
    const exact = mapReport({ ok: true, sampleSize: 300, approx: false, volume: { messages: 300, inbound: 2, outbound: 1, customers: 2 }, response: {}, sla: {} })!
    expect(exact.sampleNote).toContain('全量精确')
    const approx = mapReport({ ok: true, sampleSize: 1000, approx: true, volume: {}, response: {}, sla: {} })!
    expect(approx.sampleNote).toContain('估算') // 诚实标注
    expect(mapReport({ ok: false })).toBeNull()
  })
})

describe('360 面板（单面板失败隔离 + 嵌套数组逐行明细真复原）', () => {
  it('大白话：一个面板挂了只标那个面板、其余照渲染；profile 字段有人话标签；真实后端形状（对象含嵌套数组）逐行逐字段成明细分组、不塌成「N 条」', () => {
    // 真实 provider 形状：非 profile 面板 = 对象含一个嵌套数组（orders/activations/positions/photos）
    const panels = mapPanels({
      ok: true,
      panels: [
        { key: 'profile', label: '画像', order: 5, data: { orderCount: 3, totalSpent: 150.3 } },
        { key: 'orders', label: '订单', order: 10, data: null, error: 'PANEL_FETCH_FAIL' },
        {
          key: 'activation',
          label: '激活/课程',
          order: 20,
          data: {
            count: 2,
            capped: false,
            activations: [
              { courseId: 'course-a', code: 'AAA', activated: true, entered: false, enteredAt: null },
              { courseId: 'course-b', code: 'BBB', activated: true, entered: true, enteredAt: 1783046400000 },
            ],
          },
        },
      ],
    })
    expect(panels).toHaveLength(3)
    expect(panels[0].failed).toBe(false)
    expect(panels[0].rows.find((r) => r.k === '订单数')!.v).toBe('3') // 人话标签
    expect(panels[0].groups).toEqual([]) // 纯标量面板无明细分组
    expect(panels[1].failed).toBe(true) // 只标挂的
    expect(panels[2].failed).toBe(false)
    // 换皮误把嵌套数组塌成「N 条」（废掉 360 取证核心价值·根因#8 假绿：旧测试喂的顶层数组生产环境不存在）。
    // 真复原：标量字段（count）成 rows；嵌套数组（activations）逐行逐字段成 groups 明细。
    expect(panels[2].rows).toEqual([{ k: '数量', v: '2' }]) // capped:false 略（标量层不渲假值）
    expect(panels[2].groups).toHaveLength(1)
    expect(panels[2].groups[0].name).toBe('激活/课程')
    expect(panels[2].groups[0].count).toBe(2)
    expect(panels[2].groups[0].items[0]).toEqual([
      { k: '课程', v: 'course-a' },
      { k: '激活码', v: 'AAA' },
      { k: '已激活', v: '是' },
      { k: '已进课', v: '否' }, // 明细层保留 false 布尔（未进课＝有取证价值·非噪声）
    ])
    const it2 = panels[2].groups[0].items[1]
    expect(it2.find((f) => f.k === '已进课')!.v).toBe('是')
    expect(it2.find((f) => f.k === '进课时间')!.v).not.toBe('—') // *At 数字→时间人话
    expect(mapPanels(null)).toEqual([])
  })

  it('大白话：命中依据转中文（openid→账号/orderId→订单号）', () => {
    expect(matchLabel(['openid', 'orderId'])).toBe('账号/订单号')
    expect(matchLabel(['phone'])).toBe('手机号')
    expect(matchLabel(undefined)).toBe('')
  })
})

describe('kb/满意度/消息归一', () => {
  it('大白话：kb 行缺字段归默认（enabled 默认真·分类默认 other）；满意度五档倒序；消息方向中文·非文本给类型占位', () => {
    const kb = normalizeKb([{ key: 'f1', question: 'q', answer: 'a' }, null])
    expect(kb).toEqual([{ key: 'f1', question: 'q', answer: 'a', category: 'other', enabled: true, order: 0 }])
    const csat = mapCsat({ ok: true, total: 3, avg: 4.67, dist: { 5: 2, 4: 1 }, withNote: 1, approx: false })!
    expect(csat.dist[0]).toEqual({ star: '5 星', n: 2 })
    expect(csat.dist[4]).toEqual({ star: '1 星', n: 0 })
    expect(csat.approxNote).toBe('')
    expect(mapCsat({ ok: false })).toBeNull()
    const msgs = mapMessages([
      { id: 'm1', direction: 'in', text: '在吗', at: 1783046400000 },
      { id: 'm2', direction: 'out', msgtype: 'image', text: '' },
      { id: 'm3', direction: 'in', msgtype: 'voice', text: '语音转写：你好' },
    ])
    expect(msgs[0].who).toBe('客户')
    expect(msgs[0].kind).toBe('') // 文本无类型 chip
    expect(msgs[1].who).toBe('客服')
    expect(msgs[1].kind).toBe('image') // 非文本类型独立 chip（换皮把类型吞进正文·丢了并存标识）
    expect(msgs[1].text).toBe('')
    expect(msgs[2].kind).toBe('voice') // 非文本 + 文字说明并存（chip 与文本都在）
    expect(msgs[2].text).toBe('语音转写：你好')
  })
})

describe('满意度明细行（批 B6·mapCsatEntries）', () => {
  it('大白话：无备注显 —；bad=差评 ≤3 星（供「查会话」按钮/行高亮判据）；非数组回空', () => {
    const rows = mapCsatEntries([
      { id: 'csat:euA:1783046400000', at: 1783046400000, score: 5, note: '很棒', sessionKey: 'euA' },
      { id: 'csat:euB:1783046400000', at: 1783046400000, score: 3, note: '', sessionKey: 'euB' },
      { at: 1783046400000, score: 1, sessionKey: '' },
    ])
    expect(rows[0].id).toBe('csat:euA:1783046400000') // 行级唯一键透传（供翻页去重）
    expect(rows[0].note).toBe('很棒')
    expect(rows[0].bad).toBe(false)
    expect(rows[1].note).toBe('—') // 无备注兜底
    expect(rows[1].bad).toBe(true) // 3 分算差评
    expect(rows[2].bad).toBe(true)
    expect(rows[2].sessionKey).toBe('')
    expect(rows[2].id).toBe('') // 无 id 兜底空串（不崩）
    expect(mapCsatEntries(null)).toEqual([])
  })
})

describe('质检报表异常指标标红（换皮把未答复/超时和正常指标一个颜色·质检扫不到异常）', () => {
  it('大白话：未答复 / 超时数 > 0 时打 bad 标（模板据此标红）；为 0 时 bad=false', () => {
    const rep = mapReport({
      ok: true,
      sampleSize: 10,
      approx: false,
      volume: { messages: 5 },
      response: { unanswered: 2, answeredRate: 80 },
      sla: { breaches: 3, slaMs: 60000 },
    })!
    expect(rep.response.find((r) => r.label === '未答复')!.bad).toBe(true)
    expect(rep.sla.find((r) => r.label === '超时数')!.bad).toBe(true)
    expect(rep.volume.find((r) => r.label === '总消息')!.bad).toBeFalsy() // 普通指标不标
    const ok = mapReport({ ok: true, sampleSize: 10, approx: false, volume: {}, response: { unanswered: 0 }, sla: { breaches: 0 } })!
    expect(ok.response.find((r) => r.label === '未答复')!.bad).toBe(false)
    expect(ok.sla.find((r) => r.label === '超时数')!.bad).toBe(false)
  })
})

describe('节点诊断 nodeId 唯一（防删中间节点后 length+1 撞号→后端 def:课:nodeId upsert 静默覆盖丢数据）', () => {
  it('大白话：默认 id 取不与现存冲突的最小 n_k；删 n2 后再加不再撞 n3', () => {
    // 空表 → n1；顺加得 n1/n2/n3
    expect(nextNodeId([])).toBe('n1')
    expect(nextNodeId(['n1'])).toBe('n2')
    expect(nextNodeId(['n1', 'n2'])).toBe('n3')
    // 病根复现场景：删中间 n2，剩 [n1,n3]——length+1 会得 n3 撞车；nextNodeId 取最小可用空号 n2（复用无碍）
    expect(nextNodeId(['n1', 'n3'])).toBe('n2')
    // 手改成非 n 前缀也不误撞·取最小可用 n_k
    expect(nextNodeId(['start', 'n1'])).toBe('n2')
  })
  it('大白话：duplicateNodeIds 揪出 trim 后重复的 id（save 前据此拦截）；无重复为空', () => {
    expect(duplicateNodeIds(['n1', 'n2', 'n3'])).toEqual([])
    expect(duplicateNodeIds(['n1', 'n3', 'n3'])).toEqual(['n3'])
    expect(duplicateNodeIds(['n1', ' n1 '])).toEqual(['n1']) // 尾随空格绕不过
    expect(duplicateNodeIds(['n1', '', ''])).toEqual([]) // 空 id 不计（save 前已过滤空标题行）
  })
})

// 无档客户不渲染幽灵身份头（D4·bug 清除批D·取真源法：open() 逻辑内联在组件里未抽 lib 函数，无法单元测试
// 行为，钉源码模式防回归——原 `(u.user || u)` falsy 兜底会把整个响应对象当数据源渲染全空「（无昵称）」卡）。
describe('客户 360 无档客户不渲染幽灵身份头', () => {
  it('大白话：getUser 判定改为「u.ok 且真拿到 user 字段」才组身份头，不再有 `|| u` 兜底残留', () => {
    expect(customer360Src).not.toMatch(/user\s*\|\|\s*u\)/) // 旧 falsy 兜底写法已删
    expect(customer360Src).toMatch(/u\.ok\s*&&\s*\(u as any\)\.user/) // 新判定：ok 且 user 真存在
  })
  it('大白话：身份头 v-if="user" 处有对应 v-else（-if），无档客户显式提示而非空白/幽灵卡', () => {
    expect(customer360Src).toMatch(/v-else-if="current[^"]*"[^>]*>\s*该客户暂无用户档案/)
  })
})

// getUser 取数失败 ≠ 真无档（P2·bug sweep II D 补·取真源法：与 getCustomer360 各自独立成败，
// 旧写法把 u.ok===false 也并入「该客户暂无用户档案」文案，网络抖动被误报成查无此档）
describe('客户 360 getUser 取数失败与真无档区分', () => {
  it('大白话：u.ok===false 才置 userLoadFailed，不与真无档共用同一句文案', () => {
    expect(customer360Src).toMatch(/else if\s*\(!u\.ok\)\s*\{\s*userLoadFailed\.value\s*=\s*true/)
    expect(customer360Src).toMatch(/v-else-if="userLoadFailed"[^>]*>\s*用户档案加载失败/)
  })
  it('大白话：open()/search()/返回结果 三处重置点都清 userLoadFailed，避免跨客户残留误报', () => {
    expect((customer360Src.match(/userLoadFailed\.value\s*=\s*false/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(customer360Src).toMatch(/userLoadFailed\s*=\s*false;\s*message\s*=\s*''/)
  })
})
