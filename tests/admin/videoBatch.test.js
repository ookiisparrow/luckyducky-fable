import { describe, it, expect } from 'vitest'
import { stripExt, planLessonBatch } from '../../packages/admin/src/utils/videoBatch.js'

// 课时级批量传视频：纯逻辑「文件 → 小段」映射（顺序填现有段、超出自动新建）。
// 上传本身走网络（uploadVideo·不在此测），这里只钉映射规则，防顺序/新建判断飘。

describe('stripExt', () => {
  it('去掉扩展名', () => {
    expect(stripExt('起针手法.mp4')).toBe('起针手法')
    expect(stripExt('clip.MOV')).toBe('clip')
  })
  it('多个点只去最后一段扩展', () => {
    expect(stripExt('a.b.mp4')).toBe('a.b')
  })
  it('无扩展名原样返回', () => {
    expect(stripExt('noext')).toBe('noext')
  })
})

describe('planLessonBatch', () => {
  it('空课时：每个文件都新建段，段名取文件名', () => {
    const plan = planLessonBatch([{ name: 'a.mp4' }, { name: 'b.mp4' }], 0)
    expect(plan.map((p) => p.segIndex)).toEqual([0, 1])
    expect(plan.every((p) => p.isNew)).toBe(true)
    expect(plan.map((p) => p.segName)).toEqual(['a', 'b'])
  })

  it('部分复用部分新建：现有 2 段 + 4 文件 → 前两段复用、后两段新建', () => {
    const files = [{ name: '1.mp4' }, { name: '2.mp4' }, { name: '3.mp4' }, { name: '4.mp4' }]
    const plan = planLessonBatch(files, 2)
    expect(plan.map((p) => p.segIndex)).toEqual([0, 1, 2, 3])
    expect(plan.map((p) => p.isNew)).toEqual([false, false, true, true])
  })

  it('文件少于现有段：只填不建', () => {
    const plan = planLessonBatch([{ name: 'x.mp4' }, { name: 'y.mp4' }], 5)
    expect(plan).toHaveLength(2)
    expect(plan.every((p) => !p.isNew)).toBe(true)
    expect(plan.map((p) => p.segIndex)).toEqual([0, 1])
  })

  it('按文件名 numeric 排序（2 在 10 前）', () => {
    const files = [{ name: '10.mp4' }, { name: '2.mp4' }, { name: '1.mp4' }]
    const plan = planLessonBatch(files, 0)
    expect(plan.map((p) => p.file.name)).toEqual(['1.mp4', '2.mp4', '10.mp4'])
  })

  it('携带原始 file 引用（供上传时拿回 File 对象）', () => {
    const f = { name: 'seg.mp4', size: 123 }
    const plan = planLessonBatch([f], 0)
    expect(plan[0].file).toBe(f)
  })

  it('空文件列表返回空计划', () => {
    expect(planLessonBatch([], 3)).toEqual([])
  })
})
