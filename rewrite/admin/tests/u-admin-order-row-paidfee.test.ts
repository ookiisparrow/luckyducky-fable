// 订单行「显示实付」与「补录实付」必须用同一判据互补：只有支付异常单才看 paidFee，整数分且 >0 才算有效。
import { describe, it, expect } from 'vitest'
import { mapOrderRows } from '../src/lib/mapMoney'

const row = (status: string, paidFee: unknown) => mapOrderRows([{ id: 'o', status, amount: 2, paidFee, items: [] }])[0]

describe('mapOrderRows 实付判据', () => {
  it('支付异常单：有效 paidFee 显示实付且不需补录；脏/缺/非正回退标价并要求补录', () => {
    expect(row('payment_exception', 17700)).toMatchObject({ amountLabel: '¥177.00', paymentException: true, paidFeeMissing: false })
    expect(row('payment_exception', '500')).toMatchObject({ amountLabel: '¥5.00', paidFeeMissing: false })
    for (const bad of [undefined, null, 0, -100, 12.5, 'abc', '']) {
      expect(row('payment_exception', bad)).toMatchObject({ amountLabel: '¥2.00', paymentException: true, paidFeeMissing: true })
    }
  })

  it('非异常单：一律显示标价、不标异常、不要求补录（即便带了 paidFee）', () => {
    for (const status of ['paid', 'shipped', 'refund_required']) {
      for (const fee of [17700, undefined, 'abc']) {
        expect(row(status, fee)).toMatchObject({ amountLabel: '¥2.00', paymentException: false, paidFeeMissing: false })
      }
    }
  })
})
