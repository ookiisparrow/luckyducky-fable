import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAddressStore } from '@/store/address.js'

beforeEach(() => setActivePinia(createPinia()))

describe('address store', () => {
  it('初始为空簿（不内置样例地址·外审 P1.6·根因#6）', () => {
    const a = useAddressStore()
    expect(a.list.length).toBe(0) // 生产初始零内置收货地址，防误发货
  })

  it('save 新增：id = max+1，不与现有撞号', () => {
    const a = useAddressStore()
    a.save({ name: '李四', phone: '13900000000', region: '江苏·南京', detail: 'yy 路 2 号' })
    a.save({ name: '张三', phone: '13800000000', region: '浙江·杭州', detail: 'xx 路 1 号' })
    const ids = a.list.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length) // 无重复
    expect(a.list.length).toBe(2)
  })

  it('setDefault / save isDefault：默认地址唯一', () => {
    const a = useAddressStore()
    a.save({ name: 'B', phone: '1', region: 'x', detail: 'y', isDefault: true })
    expect(a.list.filter((x) => x.isDefault).length).toBe(1)
  })
})
