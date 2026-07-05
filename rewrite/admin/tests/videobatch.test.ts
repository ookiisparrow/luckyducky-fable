// 课时级批量传视频计划黄金基准（守卫 rw-admin-videobatch-golden·1:1 承接旧 tests/admin/videoBatch）：
// 去扩展名 / 文件名 numeric 排序（防字典序 1,10,2）/ 超现有段数标 isNew。换皮回归还原·视频批量传专项。
import { describe, it, expect } from 'vitest'
import { stripExt, planLessonBatch } from '../src/lib/videoBatch'

describe('课时级批量传视频计划', () => {
  it('大白话：去扩展名；多文件按文件名 numeric 排序映射到小段、超出现有数的标新建', () => {
    expect(stripExt('起针.mp4')).toBe('起针')
    expect(stripExt('无扩展')).toBe('无扩展')
    expect(stripExt('a.b.mov')).toBe('a.b')
    const plan = planLessonBatch([{ name: '2.mp4' }, { name: '10.mp4' }, { name: '1.mp4' }], 1)
    expect(plan.map((p) => p.segName)).toEqual(['1', '2', '10']) // numeric 排序·非字典序(1,10,2)
    expect(plan.map((p) => p.isNew)).toEqual([false, true, true]) // 现有 1 段·后 2 个新建
    expect(plan.map((p) => p.segIndex)).toEqual([0, 1, 2])
    expect(planLessonBatch([], 3)).toEqual([]) // 空
  })
})
