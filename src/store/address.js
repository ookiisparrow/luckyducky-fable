/**
 * 收货地址簿（Pinia）。供「我的页·地址管理」与「结算页·收货地址」共用。
 * 以后接后端：把 save/remove/setDefault 换成 api/user.js 的地址接口，字段一致即可。
 *
 * 初始播一条样例地址（陈圆圆），保证结算开箱即可下单；可编辑/删除/新增。
 * 条目结构：{ id, name, phone, region, detail, isDefault }
 */
import { defineStore } from 'pinia'
import { SAMPLE_ADDRESS } from '@/data/checkout.js'
import { keepValid } from '@/utils/validate.js'

// 下一个 id：取现有最大 + 1。不用模块计数器 —— 否则持久化回灌后计数器从头开始，
// 新地址会和已存地址的 id 撞。基于现有列表算就天然防撞、且冷启动安全。
const nextId = (list) => list.reduce((m, a) => Math.max(m, a.id || 0), 0) + 1

export const useAddressStore = defineStore('address', {
  state: () => ({
    list: [{ ...SAMPLE_ADDRESS, id: 1 }],
  }),
  // 回灌按契约清洗：丢弃残缺地址（缺 id/姓名/电话/地区/详址），
  // 防脏地址撑乱地址簿、或污染结算页默认地址。
  persist: {
    paths: ['list'],
    sanitize: (s) => ({
      list: keepValid(
        s.list,
        (a) => a && a.id != null && !!a.name && !!a.phone && !!a.region && !!a.detail,
        'address',
      ),
    }),
  },
  getters: {
    // 当前默认地址（没有默认就取第一条，空簿则 null）
    defaultAddress: (s) => s.list.find((a) => a.isDefault) || s.list[0] || null,
  },
  actions: {
    // 新增（无 id）或编辑（有 id）。设为默认时其余取消默认；若全无默认则补一个。
    save(addr) {
      let targetId = addr.id
      if (targetId != null) {
        const i = this.list.findIndex((a) => a.id === targetId)
        if (i >= 0) this.list[i] = { ...this.list[i], ...addr }
      } else {
        targetId = nextId(this.list)
        this.list.push({ ...addr, id: targetId })
      }
      if (addr.isDefault) {
        this.list.forEach((a) => (a.isDefault = a.id === targetId))
      } else if (this.list.length && !this.list.some((a) => a.isDefault)) {
        this.list[0].isDefault = true
      }
    },
    remove(id) {
      this.list = this.list.filter((a) => a.id !== id)
      if (this.list.length && !this.list.some((a) => a.isDefault)) {
        this.list[0].isDefault = true
      }
    },
    setDefault(id) {
      this.list.forEach((a) => (a.isDefault = a.id === id))
    },
    get(id) {
      return this.list.find((a) => a.id === id) || null
    },
  },
})
