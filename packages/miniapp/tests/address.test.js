import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAddressStore } from '@/store/address.js'

beforeEach(() => setActivePinia(createPinia()))

describe('address store', () => {
  it('初始有一条样例地址', () => {
    const a = useAddressStore()
    expect(a.list.length).toBe(1)
  })

  it('save 新增：id = max+1，不与现有撞号', () => {
    const a = useAddressStore()
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
