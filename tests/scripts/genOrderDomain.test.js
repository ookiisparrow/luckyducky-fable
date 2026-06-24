// 订单+learning 域声明→生成（P3「安全处生成」spike·扩 learning）行为锁。
// 单源 order.spec.ts（orders/afterSales）+ learning.spec.ts（qrcodes）→ 生成 order.ts/learning.ts（类型/常量/流转表）
// + order-domain.generated.json（全域并表）。本测试锁：① 生成器幂等（committed 态 --check 无漂移）；
// ② JSON 流转表自洽（每条 from/to ∈ 声明状态集·泛覆盖全集合含 qrcodes）；③ 派生 TS 与 JSON 同源（状态集一致）。
// 反向自检：改 *.spec.ts 不重生成 → ① 红；篡改生成物 → ① 红。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GEN = resolve(ROOT, 'scripts/gen-order-domain.mjs')
const JSON_OUT = resolve(ROOT, 'scripts/order-domain.generated.json')
const ORDER_TS = resolve(ROOT, 'packages/shared/src/order.ts')
const LEARNING_TS = resolve(ROOT, 'packages/shared/src/learning.ts')

describe('gen-order-domain（订单域声明→派生物·P3 安全处生成）', () => {
  it('生成器 --check 在 committed 态无漂移（改声明须重生成·防忘）', () => {
    // 退出码 0 = 同步；非 0（抛）= 漂移，须跑 `node scripts/gen-order-domain.mjs`
    expect(() => execFileSync('node', [GEN, '--check'], { cwd: ROOT, stdio: 'pipe' })).not.toThrow()
  })

  it('生成物文件齐全', () => {
    expect(existsSync(JSON_OUT), 'order-domain.generated.json 缺失').toBe(true)
    expect(existsSync(ORDER_TS), 'order.ts 缺失').toBe(true)
  })

  const spec = JSON.parse(readFileSync(JSON_OUT, 'utf8'))

  it('每个集合：流转表 from/to 都 ∈ 声明状态集（流转不引用未声明状态）', () => {
    for (const coll of Object.keys(spec)) {
      const states = new Set(spec[coll].states)
      for (const t of spec[coll].transitions) {
        for (const f of t.from) expect(states.has(f), `${coll} 流转 from「${f}」不在状态集`).toBe(true)
        expect(states.has(t.to), `${coll} 流转 to「${t.to}」不在状态集`).toBe(true)
      }
      // initial/terminal 也须 ∈ 状态集
      for (const s of [...spec[coll].initial, ...spec[coll].terminal])
        expect(states.has(s), `${coll} init/terminal「${s}」不在状态集`).toBe(true)
    }
  })

  it('生成的 TS 与 JSON 同源（状态联合 = JSON 状态集·order + learning）', () => {
    const tsByFile = { order: readFileSync(ORDER_TS, 'utf8'), learning: readFileSync(LEARNING_TS, 'utf8') }
    // 集合 → { 类型名, 所属 TS 文件 }
    const meta = {
      orders: { tn: 'OrderStatus', file: 'order' },
      afterSales: { tn: 'AfterSaleStatus', file: 'order' },
      qrcodes: { tn: 'QrcodeStatus', file: 'learning' },
    }
    for (const coll of Object.keys(spec)) {
      const mt = meta[coll]
      if (!mt) continue
      const ts = tsByFile[mt.file]
      const m = ts.match(new RegExp(`export type ${mt.tn} = ([^\\n]+)`))
      expect(m, `${mt.tn} 未在 ${mt.file}.ts 生成`).toBeTruthy()
      const tsStates = new Set([...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]))
      expect([...tsStates].sort(), `${mt.tn} 状态联合 ≠ JSON 状态集`).toEqual([...spec[coll].states].sort())
    }
  })

  it('orders/afterSales/qrcodes 状态机声明非空（order + learning 三机存在）', () => {
    for (const coll of ['orders', 'afterSales', 'qrcodes']) {
      expect(spec[coll], `${coll} 状态机缺失`).toBeTruthy()
      expect(spec[coll].transitions.length, `${coll} 无流转`).toBeGreaterThan(0)
    }
    // learning 扩证：qrcodes = unused → activated
    expect(spec.qrcodes.states.sort()).toEqual(['activated', 'unused'])
    expect(spec.qrcodes.transitions).toContainEqual(
      expect.objectContaining({ from: ['unused'], to: 'activated' }),
    )
  })
})
