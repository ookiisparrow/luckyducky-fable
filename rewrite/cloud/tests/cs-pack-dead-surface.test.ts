
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assemblePackagingBubbles, atomicText } from '../src/functions/cs/kfCallback/csAtomic'
import { composeLine, emptyFlow } from '../src/functions/cs/kfCallback/scriptReply'

const PHOTO1 = atomicText('business/packaging/ask_photo_01')

describe('包装对客死面已卸', () => {
  it('大白话：对客包装句只来自 atomic，不再从 Pack 文本抽', () => {
    const expectAtomic = assemblePackagingBubbles({
      text: '包裹被摔坏了',
      hasRecentOrder: true,
      rand: () => 0,
    })
    const { line, pieces } = composeLine(
      emptyFlow(),
      {
        model: 'jev-1.13.0',
        urgency: 0.2,
        department: 'sales',
        needStatus: 'packaging',
        emotionStatus: 'upset',
        orderStatus: 'delivered',
        topic: 'packaging',
      },
      '包裹被摔坏了',
      () => 0
    )
    expect(pieces).toEqual(expectAtomic)
    expect(line).toBe(expectAtomic.join('\n'))
    expect(line).toContain(PHOTO1)
    expect(line).not.toMatch(/订单号/)
  })
})
