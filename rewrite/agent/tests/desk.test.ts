// 坐席台轮询合并（守卫 rw-agent-ui-golden·黄金 cs-agent「会话流轮询增量合并」永恒语义）：
// 游标边界重复不重气泡/升序/同刻不同方向不同文是不同条/无时间戳不进流/游标只进不退空批不倒退。
import { describe, it, expect } from 'vitest'
import { mergeThread, advanceCursor, normalizeMsgs, mapQueue, waitLabel, deskErrorText, type Msg } from '../src/lib/desk'

const m = (at: number, direction: 'in' | 'out', text: string): Msg => ({ at, direction, text })

describe('会话流增量合并（黄金：不重气泡·升序）', () => {
  it('大白话：游标边界把同一条消息又发回来——不产生重复气泡；新消息并入后按时间排好', () => {
    const base = [m(1000, 'in', '在吗'), m(2000, 'out', '在的')]
    const merged = mergeThread(base, [
      { at: 2000, direction: 'out', text: '在的' }, // 边界重复
      { at: 1500, direction: 'in', text: '想退货' }, // 乱序增量
      { at: 3000, direction: 'in', text: '谢谢' },
    ])
    expect(merged.map((x) => x.text)).toEqual(['在吗', '想退货', '在的', '谢谢']) // 去重 + 升序
  })

  it('大白话：同一时刻，方向不同或内容不同都算不同条（不误杀）；无时间戳的脏消息不进流', () => {
    const merged = mergeThread([m(1000, 'in', '好')], [
      { at: 1000, direction: 'out', text: '好' }, // 同刻不同方向·保留
      { at: 1000, direction: 'in', text: '好的' }, // 同刻不同文·保留
      { direction: 'in', text: '没时间戳' }, // 脏·不进
      { at: 0, direction: 'in', text: '零时间戳' }, // 脏·不进
    ])
    expect(merged).toHaveLength(3)
    expect(normalizeMsgs('garbage')).toEqual([])
  })

  it('大白话：游标只进不退——空批/回了更小的游标都不倒退', () => {
    expect(advanceCursor(2000, 3000)).toBe(3000)
    expect(advanceCursor(2000, 1500)).toBe(2000) // 不倒退
    expect(advanceCursor(2000, undefined)).toBe(2000) // 空批不动
    expect(advanceCursor(0, 100)).toBe(100)
  })
})

describe('队列与错误人话', () => {
  it('大白话：队列行带等待时长人话；脏行剔除；错误码给人话原文兜底', () => {
    const now = 1_000_000
    const q = mapQueue([
      { sessionId: 's1', externalUserId: 'eu1', status: 'pending', createdAt: now - 90_000 },
      { nosid: true },
    ], now)
    expect(q).toHaveLength(1)
    expect(q[0].waitLabel).toBe('1 分钟')
    expect(waitLabel(now - 30_000, now)).toBe('30 秒')
    expect(waitLabel(now - 3_700_000, now)).toBe('1 小时 1 分')
    expect(deskErrorText('AT_CAPACITY')).toContain('满了')
    expect(deskErrorText('NO_CONSENT')).toContain('同意')
    expect(deskErrorText('X_ODD')).toContain('X_ODD') // 原文兜底
  })
})
