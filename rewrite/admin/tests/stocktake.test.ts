// 批量盘点（批 B3）：ScmMaterials「批量盘点」模式的纯逻辑——实盘合法性/差异/待提交行过滤/单号+adjustId 生成。
// UI 交互（进入盘点/提交/重试/退出确认）留在 ScmMaterials.vue，本文件只钉纯函数（可注入 now/rand 稳定断言）+
// 源码扫描钉关键接线（同 scm-ui.test.ts/scm-overview.test.ts `?raw` 范式）。
import { describe, it, expect } from 'vitest'
import { isValidActual, stocktakeDiff, filterSubmittable, genStocktakeNo, stocktakeAdjustId } from '../src/lib/stocktake'
import scmMaterialsSrc from '../src/pages/ScmMaterials.vue?raw'

describe('实盘合法性 + 差异（非负整数才算已盘）', () => {
  it('大白话：0/正整数合法；负数/小数/空/非数一律不合法——不合法时差异算 null（模板显示「—」灰）', () => {
    expect(isValidActual(5)).toBe(true)
    expect(isValidActual(0)).toBe(true)
    expect(isValidActual(-1)).toBe(false)
    expect(isValidActual(1.5)).toBe(false)
    expect(isValidActual('')).toBe(false)
    expect(isValidActual(undefined)).toBe(false)
    expect(isValidActual(null)).toBe(false)
    expect(isValidActual('7')).toBe(false) // 字符串不算（模板走 v-model.number 转数字·防脏字符串溜进提交）

    expect(stocktakeDiff(10, 7)).toBe(-3)
    expect(stocktakeDiff(10, 13)).toBe(3)
    expect(stocktakeDiff(10, 10)).toBe(0)
    expect(stocktakeDiff(10, '')).toBeNull()
    expect(stocktakeDiff(10, -1)).toBeNull()
    expect(stocktakeDiff(10, 1.5)).toBeNull()
  })
})

describe('待提交行过滤（只留已填且差异≠0 的合法行）', () => {
  it('大白话：0 差异/未填/非法输入一律剔除；只留实盘−账面≠0 的合法行，delta=实盘−账面', () => {
    const rows = [
      { materialId: 'a', stock: 10, actual: 7 }, // -3 提交
      { materialId: 'b', stock: 10, actual: 10 }, // 0 差异 剔除
      { materialId: 'c', stock: 10, actual: '' }, // 未填 剔除
      { materialId: 'd', stock: 10, actual: -1 }, // 非法（负） 剔除
      { materialId: 'e', stock: 10, actual: 1.5 }, // 非法（非整数） 剔除
      { materialId: 'f', stock: 5, actual: 8 }, // +3 提交
    ]
    expect(filterSubmittable(rows)).toEqual([
      { materialId: 'a', delta: -3 },
      { materialId: 'f', delta: 3 },
    ])
  })

  it('大白话：全部未填/全部零差异 → 空数组（不提交空调整）', () => {
    expect(filterSubmittable([{ materialId: 'a', stock: 10, actual: '' }])).toEqual([])
    expect(filterSubmittable([{ materialId: 'a', stock: 10, actual: 10 }])).toEqual([])
    expect(filterSubmittable([])).toEqual([])
  })
})

describe('盘点单号 + adjustId 生成（可注入 now/rand 稳定断言）', () => {
  it('大白话：单号格式 ST-yyyymmdd-4位随机', () => {
    const no = genStocktakeNo(new Date(2026, 6, 12).getTime(), () => 0.1234)
    expect(no).toBe('ST-20260712-1234')
    const no2 = genStocktakeNo(new Date(2026, 0, 5).getTime(), () => 0.0009)
    expect(no2).toBe('ST-20260105-0009') // 补零：月/日/随机后缀都补足位数
  })

  it('大白话：adjustId=单号-料号；同单号同料恒同键（重试不换键）；不同料号不同键', () => {
    const id1 = stocktakeAdjustId('ST-20260712-1234', 'yarn:pink:L:raw')
    const id2 = stocktakeAdjustId('ST-20260712-1234', 'yarn:pink:L:raw')
    expect(id1).toBe(id2)
    expect(id1).toBe('ST-20260712-1234-yarn:pink:L:raw')
    expect(stocktakeAdjustId('ST-20260712-1234', 'yarn:blue:L:raw')).not.toBe(id1)
  })
})

// 源码扫描（同 scm-ui.test.ts tier-watch 范式）：真实交互（点击进入/提交/重试/退出确认）不在单测覆盖面，
// 只钉「批量盘点模式该有的接线确实在源码里」防回归被换皮/重构悄悄丢掉。
describe('ScmMaterials「批量盘点」模式接线（源码扫描防回归）', () => {
  it('大白话：进入盘点全量拉 listMaterials·生成单号·提交时用 filterSubmittable 过滤·adjustId 走 stocktakeAdjustId（重试同函数=同键）', () => {
    expect(scmMaterialsSrc).toMatch(/genStocktakeNo\s*\(/)
    expect(scmMaterialsSrc).toMatch(/filterSubmittable\s*\(/)
    expect(scmMaterialsSrc).toMatch(/stocktakeAdjustId\s*\(/)
    expect(scmMaterialsSrc).toMatch(/stocktakeBusy/) // 提交中禁改输入/禁二次提交的闸
  })

  // 评审 P2（找回：已成功/在途行不该重进「待提交」范围）：filterSubmittable 只看 stock/actual、不看
  // 行状态——待提交计数 / 批量提交 / 单行重试须共用同一个「先排除 success/submitting」的口径，否则
  // 已锁定行会被算进按钮计数、批量提交时对其重发一次 adjustStock（服务端幂等挡下不致双记账，但计数
  // 误导+冗余请求）。
  it('大白话：待提交计数与批量提交都先经 pendingStocktakeRows() 排除 success/submitting 行，口径统一不重复写', () => {
    expect(scmMaterialsSrc).toMatch(/function pendingStocktakeRows/)
    const uses = scmMaterialsSrc.match(/pendingStocktakeRows\(\)/g) || []
    expect(uses.length).toBeGreaterThanOrEqual(2) // stocktakeSubmittableCount + submitStocktake 至少各一处
    const fnBody = scmMaterialsSrc.match(/function pendingStocktakeRows[\s\S]*?\n}/)
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(/status\s*!==\s*'success'/)
    expect(fnBody![0]).toMatch(/status\s*!==\s*'submitting'/)
  })

  // 评审 P2（找回：单行重试也应占用全局提交闸）：不然「提交盘点」按钮在单行重试进行中仍可点。
  it('大白话：retryStocktakeRow 也置 stocktakeBusy（防与批量提交并发碰同一行）', () => {
    const fnBody = scmMaterialsSrc.match(/async function retryStocktakeRow[\s\S]*?\n}/)
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(/stocktakeBusy\.value\s*=\s*true/)
  })

  // 评审 P1（找回：actual 编辑窗口必须随首次提交尝试一起锁死，覆盖 failed 态，不只锁 submitting/success）：
  // 否则「网络报错但服务端其实已成功」时，管理员改了 actual 再重试，同一 adjustId 撞服务端幂等键静默
  // no-op（r.ok=true, applied=0），前端却据 r.ok 判成功——账实悄悄不符。锁死后重试恒复用同一 delta，
  // 幂等跳过＝已生效的同一结果，杜绝这层错配。
  it('大白话：实盘输入框一提交尝试即锁死（status !== idle），failed 态不可再编辑、只能靠「重试」复用原 delta', () => {
    // 定位到 stocktake-actual 输入本身的 :disabled 属性值再断言（不是随便在源码全文找字符串）——
    // 防将来在附近写一句提到同一写法的注释就把这条测试撑成假绿（同 E1「注释假绿」病根）。
    const inputTag = scmMaterialsSrc.match(/<input[^>]*class="stocktake-actual"[^>]*>/)
    expect(inputTag).toBeTruthy()
    const disabledAttr = inputTag![0].match(/:disabled="([^"]+)"/)
    expect(disabledAttr).toBeTruthy()
    expect(disabledAttr![1]).toMatch(/row\.status\s*!==\s*'idle'/)
  })

  // 评审 P2（找回：拉物料主档失败要可观测，不能与「确实没有物料」撞成同一假空态·病根14）
  it('大白话：enterStocktake() 物料主档拉取失败要写错误提示（load(m.ok,…)），不静默置空', () => {
    const fnBody = scmMaterialsSrc.match(/async function enterStocktake[\s\S]*?\n}/)
    expect(fnBody).toBeTruthy()
    expect(fnBody![0]).toMatch(/load\(m\.ok/)
  })
})
