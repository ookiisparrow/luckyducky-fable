// 震感配方单源守卫（迁自 tests/flip-lever.test.ts·2026-07-11 批A：从 flip-demo 专属位置迁到共享单源
// lib/haptics，防复制漂移·病根#5·播放页 seek 条即将复用）。
import { describe, it, expect } from 'vitest'
import { shouldTick, VIBE_GAP_MS, DRAG_TICK_GAP_MS } from '../lib/haptics'

describe('shouldTick（拖动持续阻尼震感：翻帧即嗒·最小间隔钳制）', () => {
  it('大白话：翻过一帧且距上次震动 ≥ 最小间隔才嗒；帧没变不嗒；间隔不足不嗒（快扫跳齿防糊嗡）', () => {
    expect(shouldTick(17, 18, 40, 40)).toBe(true) // 翻帧 + 间隔够 → 嗒
    expect(shouldTick(17, 17, 200, 40)).toBe(false) // 帧没变 → 不嗒
    expect(shouldTick(17, 18, 39, 40)).toBe(false) // 间隔不足 → 跳齿
    expect(shouldTick(20, 15, 40, 40)).toBe(true) // 反向翻帧同样嗒
  })
})

describe('震感数值定版（用户真机拍板·2026-07-11，改动需重新拍板）', () => {
  it('大白话：事件震节流地板 80ms、拖动阻尼「嗒」最小间隔 40ms——钉死定版数值不被顺手改', () => {
    expect(VIBE_GAP_MS).toBe(80)
    expect(DRAG_TICK_GAP_MS).toBe(40)
  })
})
