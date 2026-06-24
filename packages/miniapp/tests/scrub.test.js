import { describe, it, expect } from 'vitest'
import { scrubTimeAt } from '@/pkg-video/player/scrub.js'

// 进度条拖拽/点按：把触点 clientX + 进度条几何(rect) + 时长 → 目标时间（钳位 0~duration）。
// 纯函数单测边界（条左/条右越界钳位、无 rect/无时长返回 null）——拖拽手势本身只能真机验（根因#8）。
const rect = { left: 20, width: 200 } // 进度条:屏幕 x 20~220

describe('scrubTimeAt 触点→时间（钳位）', () => {
  it('条中点 → 时长一半', () => {
    expect(scrubTimeAt(120, rect, 100)).toBeCloseTo(50)
  })
  it('条起点 → 0', () => {
    expect(scrubTimeAt(20, rect, 100)).toBeCloseTo(0)
  })
  it('条终点 → 时长', () => {
    expect(scrubTimeAt(220, rect, 100)).toBeCloseTo(100)
  })
  it('越过左边界 → 钳到 0', () => {
    expect(scrubTimeAt(-50, rect, 100)).toBe(0)
  })
  it('越过右边界 → 钳到时长', () => {
    expect(scrubTimeAt(999, rect, 100)).toBe(100)
  })
  it('无 rect / 时长<=0 / x 非数 → null（不乱 seek）', () => {
    expect(scrubTimeAt(120, null, 100)).toBeNull()
    expect(scrubTimeAt(120, rect, 0)).toBeNull()
    expect(scrubTimeAt(undefined, rect, 100)).toBeNull()
    expect(scrubTimeAt(120, { left: 20, width: 0 }, 100)).toBeNull()
  })
})
