// 新错误码的人话：超时、怪回包、认证库故障不能落成「操作失败（CODE）」或「口令不对」；
// REFUND_HOLD 只剩「退款在途 / 每行都退完」两种情形，文案要说清处理完才能发。
import { describe, it, expect } from 'vitest'
import { orderErrorText } from '../src/lib/mapMoney'
import { launchErrorText, stockErrorText } from '../src/lib/mapSystem'

describe('钱组与上新页的新错误码', () => {
  it('大白话：超时不说成失败——提醒可能已生效、先刷新再决定', () => {
    for (const t of [orderErrorText('CALL_TIMEOUT'), launchErrorText('CALL_TIMEOUT')]) {
      expect(t).toMatch(/没回|超时/)
      expect(t).toMatch(/刷新/)
      expect(t).not.toMatch(/CALL_TIMEOUT/)
    }
  })

  it('大白话：同一句超时文案也会出现在「加载失败」里，所以「可能已生效」只能对提交操作说，不能无条件说', () => {
    for (const t of [orderErrorText('CALL_TIMEOUT'), launchErrorText('CALL_TIMEOUT'), stockErrorText('CALL_TIMEOUT')]) {
      expect(t).toMatch(/如果刚才是提交/)
    }
  })

  it('大白话：拉微信账单时凭证/商户号读失败或没配，要说人话，不落成「操作失败（CODE）」', () => {
    for (const c of ['CREDS_READ_FAIL', 'CONFIG_READ_FAIL', 'NO_WXPAY_CREDS', 'NO_MCHID']) {
      expect(orderErrorText(c)).not.toMatch(/操作失败|[A-Z]{4,}/)
    }
    expect(orderErrorText('CREDS_READ_FAIL')).toMatch(/稍后/)
    expect(orderErrorText('CONFIG_READ_FAIL')).toMatch(/稍后/)
    expect(orderErrorText('NO_WXPAY_CREDS')).toMatch(/配置/)
    expect(orderErrorText('NO_MCHID')).toMatch(/商户号/)
  })

  it('大白话：认证库故障提示稍后再试，不让人以为自己口令或权限有问题', () => {
    for (const t of [orderErrorText('AUTH_UNAVAILABLE'), launchErrorText('AUTH_UNAVAILABLE')]) {
      expect(t).toMatch(/稍后/)
      expect(t).not.toMatch(/AUTH_UNAVAILABLE|口令不对/)
    }
  })

  it('大白话：库存保存超时不说成「保存没成功」——可能已经存上了', () => {
    expect(stockErrorText('CALL_TIMEOUT')).toMatch(/刷新/)
    expect(stockErrorText('CALL_TIMEOUT')).not.toMatch(/没成功|CALL_TIMEOUT/)
    expect(stockErrorText('AUTH_UNAVAILABLE')).toMatch(/稍后/)
  })

  it('大白话：怪回包两边都有人话', () => {
    expect(orderErrorText('BAD_JSON_RESPONSE')).not.toMatch(/BAD_JSON_RESPONSE/)
    expect(launchErrorText('BAD_JSON_RESPONSE')).not.toMatch(/BAD_JSON_RESPONSE/)
  })

  it('大白话：REFUND_HOLD 说清是「有退款正在处理，处理完才能发」', () => {
    expect(orderErrorText('REFUND_HOLD')).toMatch(/退款正在处理/)
    expect(orderErrorText('REFUND_HOLD')).toMatch(/处理完/)
  })
})
