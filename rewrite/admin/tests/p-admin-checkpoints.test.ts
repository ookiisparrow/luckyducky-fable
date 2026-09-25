// @vitest-environment happy-dom
// Checkpoints.vue 挂载测试：载入与乱序、保存带版本号（乐观并发）、撞版本停手不自动重载不丢编辑。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

const api = vi.hoisted(() => ({ listCheckpoints: vi.fn(), saveCheckpoints: vi.fn() }))
vi.mock('../src/api/cs', () => api)

import Checkpoints from '../src/pages/Checkpoints.vue'

// 形状照云端 listCheckpoints / saveCheckpoints
const node = (nodeId: string, title: string, order: number) => ({ nodeId, title, remedy: '慢慢收', order })
const LIST = { ok: true, list: [node('n1', '起针', 0), node('n2', '收口', 1)], rev: 3 }
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listCheckpoints.mockResolvedValue(LIST)
  api.saveCheckpoints.mockResolvedValue({ ok: true, count: 2, rev: 4 })
})
const mountPage = async () => {
  const w = mount(Checkpoints)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const status = (w: W) => w.findAll('.ld-status').map((p) => p.text()).join(' | ')
const titles = (w: W) => w.findAll('input.ntitle').map((i) => (i.element as HTMLInputElement).value)
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)
const save = async (w: W) => {
  await btn(w, '保存整课')!.trigger('click')
  await flushPromises()
}

describe('Checkpoints.vue 载入', () => {
  it('大白话：默认载入旗舰课，按顺序渲染节点', async () => {
    const w = await mountPage()
    expect(api.listCheckpoints).toHaveBeenCalledWith('course-duck')
    expect(titles(w)).toEqual(['起针', '收口'])
    expect(status(w)).toBe('')
  })

  it('大白话：载入失败显人话原因，不显「还没配节点」，也没有保存按钮', async () => {
    api.listCheckpoints.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = await mountPage()
    expect(status(w)).toBe('加载失败：' + transportErrorText('CALL_TIMEOUT'))
    expect(w.text()).not.toContain('还没配节点')
    expect(btn(w, '保存整课')).toBeUndefined()
  })

  it('大白话：先发的载入后回包，不把节点换回旧课；保存落在后载入的课', async () => {
    let releaseOld: (v: unknown) => void = () => {}
    api.listCheckpoints.mockReturnValueOnce(new Promise((r) => (releaseOld = r))).mockResolvedValueOnce({ ok: true, list: [node('b1', 'B课节点', 0)], rev: 7 })
    const w = mount(Checkpoints)
    await w.find('input[placeholder="course-xxx"]').setValue('course-b')
    await btn(w, '载入')!.trigger('click')
    await flushPromises()
    releaseOld(LIST)
    await flushPromises()
    expect(titles(w)).toEqual(['B课节点'])
    await save(w)
    expect(api.saveCheckpoints).toHaveBeenCalledWith('course-b', [{ nodeId: 'b1', title: 'B课节点', remedy: '慢慢收', order: 0 }], 7)
  })
})

describe('Checkpoints.vue 保存整课', () => {
  it('大白话：带载入时的版本号保存；成功后下一次保存带新版本号', async () => {
    const w = await mountPage()
    await save(w)
    expect(api.saveCheckpoints).toHaveBeenLastCalledWith('course-duck', LIST.list, 3)
    expect(status(w)).toBe('已保存 2 个节点到 course-duck（整课覆盖·学员提交不受影响）')
    await save(w)
    expect(api.saveCheckpoints).toHaveBeenLastCalledWith('course-duck', LIST.list, 4)
  })

  it('大白话：课号框改了没点载入——提示漂移，保存仍写已载入的课，不覆盖到框里那门', async () => {
    const w = await mountPage()
    await w.find('input[placeholder="course-xxx"]').setValue('course-other')
    expect(w.find('.ld-status.drift').exists()).toBe(true)
    await save(w)
    expect(api.saveCheckpoints).toHaveBeenCalledWith('course-duck', LIST.list, 3)
    expect(api.listCheckpoints).toHaveBeenCalledTimes(1)
    expect(status(w)).toContain('已保存 2 个节点到 course-duck')
  })

  it('大白话：保存失败显原因', async () => {
    api.saveCheckpoints.mockResolvedValue({ ok: false, status: 400, error: 'BAD_ARGS' })
    const w = await mountPage()
    await save(w)
    expect(status(w)).toBe('保存失败（BAD_ARGS）')
  })

  it('大白话：旧节点没删净也算写成了——提示重存，并按新版本号继续', async () => {
    api.saveCheckpoints.mockResolvedValueOnce({ ok: false, error: 'GC_REMOVE_FAIL', failedIds: ['n9'], rev: 5 })
    const w = await mountPage()
    await save(w)
    expect(status(w)).toBe('已保存新节点，但有旧节点未删净（重存一次即可收敛）')
    await save(w)
    expect(api.saveCheckpoints).toHaveBeenLastCalledWith('course-duck', LIST.list, 5)
  })

  it('大白话：撞版本——提示重载，不自动重载、不丢手上的编辑，再点保存也不发；点载入后恢复', async () => {
    api.saveCheckpoints.mockResolvedValueOnce({ ok: false, error: 'DRAFT_CONFLICT', rev: 9 })
    const w = await mountPage()
    await w.findAll('input.ntitle')[0].setValue('起针（改）')
    await save(w)
    expect(status(w)).toBe('内容已被别处修改，请重新载入后再保存')
    expect(api.listCheckpoints).toHaveBeenCalledTimes(1)
    expect(titles(w)).toEqual(['起针（改）', '收口'])
    await save(w)
    expect(api.saveCheckpoints).toHaveBeenCalledTimes(1)

    api.listCheckpoints.mockResolvedValue({ ...LIST, rev: 9 })
    await btn(w, '载入')!.trigger('click')
    await flushPromises()
    await save(w)
    expect(api.saveCheckpoints).toHaveBeenCalledTimes(2)
    expect(api.saveCheckpoints).toHaveBeenLastCalledWith('course-duck', LIST.list, 9)
  })
})
