import { describe, it, expect } from 'vitest'
import { stepSegment } from '@/pkg-video/player/segNav.js'

// 播放器「上一段/下一段」= 小段切换、连续跨课时（用户拍板·规格 R8「下一段」升级）。
// stepSegment 是纯函数:本课时内切段;到边界自动接相邻课时;全课首/末段返回 null（无处可去→按钮灰）。
// 两门课样本:课时1(4 段)→课时2(2 段)→课时3(3 段)。
const lessons = [
  { id: 'lA', segments: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }] },
  { id: 'lB', segments: [{ id: 'b1' }, { id: 'b2' }] },
  { id: 'lC', segments: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
]

describe('stepSegment 分段导航（连续跨课时）', () => {
  it('本课时内向后切段', () => {
    expect(stepSegment(lessons, 0, 0, 1)).toEqual({ lessonIdx: 0, segIdx: 1 })
    expect(stepSegment(lessons, 0, 2, 1)).toEqual({ lessonIdx: 0, segIdx: 3 })
  })

  it('本课时内向前切段', () => {
    expect(stepSegment(lessons, 2, 2, -1)).toEqual({ lessonIdx: 2, segIdx: 1 })
    expect(stepSegment(lessons, 0, 1, -1)).toEqual({ lessonIdx: 0, segIdx: 0 })
  })

  it('到本课时最后一段，下一段 → 下一课时第一段（跨课时）', () => {
    expect(stepSegment(lessons, 0, 3, 1)).toEqual({ lessonIdx: 1, segIdx: 0 })
    expect(stepSegment(lessons, 1, 1, 1)).toEqual({ lessonIdx: 2, segIdx: 0 })
  })

  it('到本课时第一段，上一段 → 上一课时最后一段（跨课时）', () => {
    expect(stepSegment(lessons, 1, 0, -1)).toEqual({ lessonIdx: 0, segIdx: 3 })
    expect(stepSegment(lessons, 2, 0, -1)).toEqual({ lessonIdx: 1, segIdx: 1 })
  })

  it('全课最后一段，下一段 → null（按钮灰）', () => {
    expect(stepSegment(lessons, 2, 2, 1)).toBeNull()
  })

  it('全课第一段，上一段 → null（按钮灰）', () => {
    expect(stepSegment(lessons, 0, 0, -1)).toBeNull()
  })

  it('空/异常输入 → null（不崩）', () => {
    expect(stepSegment([], 0, 0, 1)).toBeNull()
    expect(stepSegment(null, 0, 0, 1)).toBeNull()
    expect(stepSegment(lessons, 0, 0, 0)).toBeNull()
  })

  it('跳过无段课时（防中间空课时把导航卡死）', () => {
    const withEmpty = [
      { id: 'lA', segments: [{ id: 'a1' }] },
      { id: 'lEmpty', segments: [] },
      { id: 'lC', segments: [{ id: 'c1' }] },
    ]
    expect(stepSegment(withEmpty, 0, 0, 1)).toEqual({ lessonIdx: 2, segIdx: 0 })
    expect(stepSegment(withEmpty, 2, 0, -1)).toEqual({ lessonIdx: 0, segIdx: 0 })
  })
})
