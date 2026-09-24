// 0%/100% 夹取规则与病史见 rewrite/shared/src/learning.ts `progressPercent` 头注；本文件只锁行为。
import { describe, it, expect } from 'vitest'
import { progressPercent } from '../src/learning'

describe('学习进度百分比（0%/100% 不撒谎·守卫 rw-progress-percent-single-source）', () => {
  it('大白话：一段都没学才是 0%', () => {
    expect(progressPercent(0, 80)).toBe(0)
    expect(progressPercent(0, 1)).toBe(0)
  })
  it('大白话：全部学完才是 100%', () => {
    expect(progressPercent(80, 80)).toBe(100)
    expect(progressPercent(1, 1)).toBe(100)
  })
  it('大白话：学了哪怕一小段，也绝不显示 0%（原 bug：1/250 显示 0%）', () => {
    expect(progressPercent(1, 250)).toBe(1)
    expect(progressPercent(1, 300)).toBe(1)
    expect(progressPercent(1, 10000)).toBe(1)
  })
  it('大白话：只要还差一段没学完，就绝不显示 100%（原 bug：199/200 显示 100%）', () => {
    expect(progressPercent(199, 200)).toBe(99)
    expect(progressPercent(299, 300)).toBe(99)
    expect(progressPercent(9999, 10000)).toBe(99)
  })
  it('大白话：中间的正常值照常四舍五入', () => {
    expect(progressPercent(1, 80)).toBe(1) // 1.25%
    expect(progressPercent(6, 15)).toBe(40)
    expect(progressPercent(1, 2)).toBe(50)
    expect(progressPercent(2, 3)).toBe(67) // 66.67%
  })
  it('大白话：脏数据不崩也不冒充——没有总数一律 0%，学过头夹到 100%', () => {
    expect(progressPercent(5, 0)).toBe(0)
    expect(progressPercent(0, 0)).toBe(0)
    expect(progressPercent(-1, 80)).toBe(0)
    expect(progressPercent(999, 80)).toBe(100) // stale done 键顶爆分母（上游已取交集，此处再兜一层）
    expect(progressPercent(NaN as unknown as number, 80)).toBe(0)
    expect(progressPercent(1, NaN as unknown as number)).toBe(0)
  })
})
