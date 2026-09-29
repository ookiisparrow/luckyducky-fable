// 地址表单输入上限 ≤ 云端 createOrder 快照截断上限：表单比云端宽，多打的字会在下单时被悄悄截掉，
// 收件信息残缺却无人知道（表单更窄无妨：手机号按拍板 6 限 11 位）。两边数字各从源码取，改一边这里就红。
import { describe, it, expect } from 'vitest'
import wxml from '../pages/address-edit/address-edit.wxml?raw'
import orders from '../../cloud/src/functions/app/actions/orders.ts?raw'

function cloudCut(field: string): number {
  const m = orders.match(new RegExp(`${field}: cut\\(a\\.${field}, (\\d+)\\)`))
  if (!m) throw new Error('云端 createOrder 找不到 ' + field + ' 的截断上限')
  return Number(m[1])
}

function formMaxlength(field: string): number {
  const tag = wxml.match(new RegExp(`<(?:input|textarea)[^>]*data-field="${field}"[^>]*>`))
  const m = tag && tag[0].match(/maxlength="(\d+)"/)
  return m ? Number(m[1]) : 140 // 小程序 input 缺省 maxlength 是 140
}

describe('地址表单上限不超过云端截断', () => {
  it.each(['name', 'phone', 'detail'])('大白话：%s 表单最多能打的字数不超过云端下单保留的字数', (field) => {
    expect(formMaxlength(field)).toBeLessThanOrEqual(cloudCut(field))
  })
})
