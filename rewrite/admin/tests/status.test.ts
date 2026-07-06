// 后台状态反馈收口 useLoadStatus（守卫 rw-admin-load-status-golden·治病根#14 admin 前端侧）：
// 各页「动作 note 设提示 → void reload 刷新」的竞态里，reload 成功会把刚设的成功/失败原文抹掉
//（伪成功/吞反馈＝病根#14）。收口不变量：load 只在「自身加载失败」时写 message，成功静默、不 touch。
import { describe, it, expect } from 'vitest'
import { useLoadStatus } from '../src/lib/status'

describe('useLoadStatus（动作反馈不被后台 reload 抹掉·病根#14）', () => {
  it('大白话：动作设了成功提示后，一次成功的后台 reload 绝不能把它清空', () => {
    const s = useLoadStatus()
    s.note(true, '已收货入库：应付 ¥12.00', '')
    expect(s.message.value).toBe('已收货入库：应付 ¥12.00')
    expect(s.ok.value).toBe(true)
    // 后台 reload 成功——静默，不抹掉刚才的动作反馈（否则＝伪成功·操作员漏看结果）
    s.load(true, '加载失败：X')
    expect(s.message.value).toBe('已收货入库：应付 ¥12.00')
    expect(s.ok.value).toBe(true)
    // 后台 reload 失败——才写加载错误
    s.load(false, '加载失败：NETWORK')
    expect(s.message.value).toBe('加载失败：NETWORK')
    expect(s.ok.value).toBe(false)
  })

  it('大白话：动作失败原文也不被随后的成功 reload 顶掉（错误留在眼前直到下次动作）', () => {
    const s = useLoadStatus()
    s.note(false, '', '这行库存刚被改过，刷新后再改')
    expect(s.ok.value).toBe(false)
    expect(s.message.value).toBe('这行库存刚被改过，刷新后再改')
    s.load(true, '') // reload 成功
    expect(s.message.value).toBe('这行库存刚被改过，刷新后再改') // 失败原文留住·未被吞
  })
})
