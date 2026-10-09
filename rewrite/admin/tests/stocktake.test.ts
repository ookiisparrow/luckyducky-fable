// 批量盘点（批 B3）：ScmMaterials「批量盘点」模式的纯逻辑——实盘合法性/差异/待提交行过滤/单号+adjustId 生成。
// 页面接线（提交/重试/锁输入）在 u-admin-scm-materials.test.ts 挂载测试。
import { describe, it, expect } from 'vitest'
import { stocktakeDiff, filterSubmittable, genStocktakeNo, stocktakeAdjustId } from '../src/lib/stocktake'

describe('实盘合法性 + 差异（非负整数才算已盘）', () => {
  it('大白话：0/正整数合法；负数/小数/空/非数一律不合法——不合法时差异算 null（模板显示「—」灰）', () => {
    // 合法性走外层 stocktakeDiff（isValidActual 已不对外 export）：合法有数字差，非法回 null
    expect(stocktakeDiff(10, 5)).toBe(-5)
    expect(stocktakeDiff(10, 0)).toBe(-10) // 0 合法
    expect(stocktakeDiff(10, 7)).toBe(-3)
    expect(stocktakeDiff(10, 13)).toBe(3)
    expect(stocktakeDiff(10, 10)).toBe(0)
    expect(stocktakeDiff(10, '')).toBeNull()
    expect(stocktakeDiff(10, -1)).toBeNull()
    expect(stocktakeDiff(10, 1.5)).toBeNull()
    expect(stocktakeDiff(10, undefined)).toBeNull()
    expect(stocktakeDiff(10, null)).toBeNull()
    expect(stocktakeDiff(10, '7')).toBeNull() // 字符串不算（模板走 v-model.number 转数字·防脏字符串溜进提交）
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
