// 首页定格动画模块（三档拨杆·状态切换器）纯逻辑守卫（flip-demo 真机验证批·2026-07-11 用户拍板：
// 先在隔离 demo 页真机看效果，效果好再入首页）。语义特征化自设计稿 主版本/Sections.jsx FlipFrame：
// 拨杆三稳态（左 -17 / 中 00 / 右 +18），松手「顺拖动方向入档」——微动回起始档，成势则按方向进档，
// 大幅拖拽可跨区直达；帧号由手柄位移比例绝对映射。
import { describe, it, expect } from 'vitest'
import { leverTarget, frameForRatio, zoneOf, flipFrames, FLIP_N, FLIP_ZERO } from '../lib/flipLever'

const MAX = 100 // 半行程 px（测试用整数便于口算）

describe('leverTarget（松手入档决策）', () => {
  it('大白话：微动（<6px）不成势，回起始档——中档微抖仍中，左档微抖仍左', () => {
    expect(leverTarget(0, 3, MAX)).toBe(0)
    expect(leverTarget(-MAX, -MAX + 5, MAX)).toBe(-1)
    expect(leverTarget(MAX, MAX - 5, MAX)).toBe(1)
  })

  it('大白话：从中档右拖成势即进右档——哪怕松手点还没过中区边界（顺方向入档，不看松手落点）', () => {
    expect(leverTarget(0, 30, MAX)).toBe(1)
    expect(leverTarget(0, 90, MAX)).toBe(1)
  })

  it('大白话：从中档左拖成势即进左档（镜像）', () => {
    expect(leverTarget(0, -30, MAX)).toBe(-1)
  })

  it('大白话：从左档右拖一步进中档；一口气拖进右区则直达右档（跨两档）', () => {
    expect(leverTarget(-MAX, -20, MAX)).toBe(0) // 松手点在中区 → 下一档（中）
    expect(leverTarget(-MAX, 80, MAX)).toBe(1) // 松手点已在右区 → 直达右档
  })

  it('大白话：从右档左拖镜像——一步回中，大幅直达左档', () => {
    expect(leverTarget(MAX, 20, MAX)).toBe(0)
    expect(leverTarget(MAX, -80, MAX)).toBe(-1)
  })

  it('大白话：已在右档继续右拖不越界（顶格 +1）；左档继续左拖同理（顶格 -1）', () => {
    expect(leverTarget(MAX, MAX + 40, MAX)).toBe(1)
    expect(leverTarget(-MAX, -MAX - 40, MAX)).toBe(-1)
  })
})

describe('frameForRatio（位移比例 → 帧号绝对映射）', () => {
  it('大白话：居中是 00 帧（索引 17），右满行程 +18（索引 35），左满行程 -17（索引 0）', () => {
    expect(frameForRatio(0)).toBe(FLIP_ZERO)
    expect(frameForRatio(1)).toBe(FLIP_N - 1)
    expect(frameForRatio(-1)).toBe(0)
  })

  it('大白话：中间比例按方向各自线性（右半程 ×18、左半程 ×17），越界比例被钳住不出界', () => {
    expect(frameForRatio(0.5)).toBe(FLIP_ZERO + 9)
    expect(frameForRatio(-0.5)).toBe(FLIP_ZERO - 8) // JS Math.round(-8.5)=-8（向正无穷取整·与设计稿源码同语义）
    expect(frameForRatio(2)).toBe(FLIP_N - 1)
    expect(frameForRatio(-2)).toBe(0)
  })
})

describe('zoneOf（当前位移所在档区·震动跨区提示用）', () => {
  it('大白话：过半行程一半才算进左/右区，中间都算中区', () => {
    expect(zoneOf(0, MAX)).toBe(0)
    expect(zoneOf(49, MAX)).toBe(0)
    expect(zoneOf(51, MAX)).toBe(1)
    expect(zoneOf(-51, MAX)).toBe(-1)
  })
})

describe('flipFrames（36 张占位帧数据）', () => {
  it('大白话：36 帧、编号 -17…00…+18、渐变色对为预计算 hex（不用 oklch·部分安卓内核不认）、小球坐标在画面内', () => {
    const frames = flipFrames()
    expect(frames).toHaveLength(FLIP_N)
    expect(frames[0].label).toBe('-17')
    expect(frames[FLIP_ZERO].label).toBe('00')
    expect(frames[FLIP_N - 1].label).toBe('+18')
    expect(frames[18].label).toBe('+01')
    for (const f of frames) {
      expect(f.bg).toMatch(/^linear-gradient\(155deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
      expect(f.x).toBeGreaterThanOrEqual(0)
      expect(f.x).toBeLessThanOrEqual(100)
      expect(f.y).toBeGreaterThanOrEqual(0)
      expect(f.y).toBeLessThanOrEqual(100)
    }
  })
})
