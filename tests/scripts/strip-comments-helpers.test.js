// stripComments/methodBody 单源 helper 单测（批E·执行者错题本 E1）：
// 这两个 helper 是原三处/四处重复正则字面量收敛后的单一来源，被 scripts/check-structure.mjs
// 多条守卫（agent-channel-stays-assistant / rw-mp-player-stale-guarded /
// rw-mp-player-immersive-casting / rw-mp-customer-service-wired / rw-mp-home-quick-add-real）
// 复用——本测试直接钉 helper 自身行为，不依赖任何具体守卫。
import { describe, it, expect } from 'vitest'
import { stripComments, methodBody } from '../../scripts/check-structure.mjs'

describe('stripComments', () => {
  it('剥掉行注释里藏的调用', () => {
    const src = "foo() // openCustomerService('x')\nbar()"
    expect(stripComments(src)).not.toMatch(/openCustomerService/)
    expect(stripComments(src)).toMatch(/foo\(\)/)
    expect(stripComments(src)).toMatch(/bar\(\)/)
  })

  it('剥掉块注释里藏的调用', () => {
    const src = 'foo()\n/* openCustomerService() 描述 */\nbar()'
    expect(stripComments(src)).not.toMatch(/openCustomerService/)
    expect(stripComments(src)).toMatch(/bar\(\)/)
  })

  it('不剥真实代码', () => {
    const src = "openCustomerService('real')"
    expect(stripComments(src)).toMatch(/openCustomerService\(/)
  })
})

describe('methodBody', () => {
  it('截取带参数的方法体（含 async 前缀）', () => {
    const src = [
      '  async playSegment(seg, scene) {',
      '    await fetchUrl()',
      '    if (x !== this.playToken) return',
      '  },',
      '  otherMethod() {},',
    ].join('\n')
    const body = methodBody(src, 'playSegment')
    expect(body).toMatch(/await fetchUrl/)
    expect(body).toMatch(/playToken/)
    expect(body).not.toMatch(/otherMethod/)
  })

  it('截取空参数方法体（无 async）', () => {
    const src = ['  onCast() {', "    const ok = typeof x.startCasting === 'function'", '  },'].join('\n')
    const body = methodBody(src, 'onCast')
    expect(body).toMatch(/startCasting/)
  })

  it('缺方法名返回空串', () => {
    const src = '  onOther() {\n    doThing()\n  },'
    expect(methodBody(src, 'onMissing')).toBe('')
  })

  it('边界正确截断——不越界吃到下一个方法', () => {
    const src = [
      '  onAddProduct(e) {',
      '    decideQuickAdd()',
      '  },',
      '  onNext() {',
      '    cart.add()',
      '  },',
    ].join('\n')
    const body = methodBody(src, 'onAddProduct')
    expect(body).toMatch(/decideQuickAdd/)
    expect(body).not.toMatch(/cart\.add/)
  })
})
