import { describe, it, expect } from 'vitest'
import { threadKey, mergeThread, advanceCursor } from '../../packages/agent/src/logic/thread.js'

// 承面 C 车道 B·会话轮询增量合并纯逻辑（getThread cursor 增量→前端合并·off-by-one/重复/乱序高发区）
describe('agent thread merge（轮询增量合并）', () => {
  const m = (at, direction = 'in', text = 't' + at) => ({ direction, msgtype: 'text', text, at })

  it('threadKey 按 (at,direction,text) 唯一', () => {
    expect(threadKey(m(1))).toBe('1|in|t1')
    expect(threadKey(m(1, 'out', 'x'))).toBe('1|out|x')
  })

  it('合并新增批次并按 at 升序', () => {
    const prev = [m(1), m(2)]
    const merged = mergeThread(prev, [m(3), m(4)])
    expect(merged.map((x) => x.at)).toEqual([1, 2, 3, 4])
  })

  it('去重重叠（cursor 边界重复回同一条不产生重复气泡）', () => {
    const prev = [m(1), m(2), m(3)]
    const merged = mergeThread(prev, [m(3), m(4)]) // at=3 重叠
    expect(merged.map((x) => x.at)).toEqual([1, 2, 3, 4])
    expect(merged.filter((x) => x.at === 3)).toHaveLength(1)
  })

  it('乱序批次也按 at 排序（并发落库时序抖动）', () => {
    const merged = mergeThread([m(5)], [m(2), m(9), m(1)])
    expect(merged.map((x) => x.at)).toEqual([1, 2, 5, 9])
  })

  it('同毫秒不同向/不同文视为不同条（坐席出站 vs 客户入站可同刻）', () => {
    const merged = mergeThread([], [m(7, 'in', '你好'), m(7, 'out', '在的')])
    expect(merged).toHaveLength(2)
  })

  it('忽略脏项（无 at 的非法消息不进流）', () => {
    const merged = mergeThread([m(1)], [{ direction: 'in', text: 'x' }, null, m(2)])
    expect(merged.map((x) => x.at)).toEqual([1, 2])
  })

  it('advanceCursor 取最大 at·空批次不倒退', () => {
    expect(advanceCursor([m(1), m(5), m(3)], '0')).toBe('5')
    expect(advanceCursor([], '5')).toBe('5') // 无新消息保持旧游标
    expect(advanceCursor([m(2)], '9')).toBe('9') // 不倒退（防旧消息回拉致游标后退）
  })
})
