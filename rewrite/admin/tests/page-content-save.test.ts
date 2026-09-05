// @vitest-environment happy-dom
// roots: #5, #8 — 实际挂载两条内容保存入口，锁住单次提交、慢网串行和离签补存。
// reverseTest: 恢复 save() 的第二次直写或去掉定时器清空，单次提交/离签用例必须红。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import HomeContentForm from '../src/components/pagecontent/HomeContentForm.vue'
import WelcomeTab from '../src/components/pagecontent/WelcomeTab.vue'
import { SAVE_OK_MESSAGE } from '../src/lib/mapPageContent'

const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('../src/api/content', () => ({
  getHomeContent: read,
  getPageContent: read,
  saveHomeContent: write,
  savePageContent: write,
}))
vi.mock('../src/api/products', () => ({ uploadImage: vi.fn() }))

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  read.mockReset().mockResolvedValue({
    ok: true,
    home: { hero: { title: '小棉鸭钩织材料包' }, faq: [{ title: '新手可以学吗', body: '跟着分段教程一步步完成。' }] },
    content: { w1: { title: '开始你的钩织之旅' }, w2: { items: [{ title: '准备材料', desc: '检查材料包里的毛线和工具。' }] } },
  })
  write.mockReset().mockResolvedValue({ ok: true })
})
afterEach(async () => {
  wrapper?.unmount()
  wrapper = undefined
  await flushPromises()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe.each([
  { name: '首页内容', component: HomeContentForm },
  { name: '页面内容共用保存链', component: WelcomeTab },
])('$name', ({ component }) => {
  async function open() {
    wrapper = mount(component)
    await flushPromises()
    return wrapper
  }

  it('点一次保存只提交一次，并显示真实保存结果', async () => {
    const view = await open()
    await view.find('input').setValue('本周新款材料包')
    await view.find('.pc-toolbar button').trigger('click')
    await flushPromises()
    expect(write).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(write.mock.calls[0])).toContain('本周新款材料包')
    expect(view.text()).toContain(SAVE_OK_MESSAGE)
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('自动保存已完成，离签不再重复提交', async () => {
    const view = await open()
    await view.find('input').setValue('已经保存的内容')
    await vi.advanceTimersByTimeAsync(900)
    await flushPromises()
    expect(write).toHaveBeenCalledTimes(1)
    view.unmount()
    wrapper = undefined
    await flushPromises()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('防抖尚未到点就离签，仍补存最后一次编辑', async () => {
    const view = await open()
    await view.find('input').setValue('离开前的最后编辑')
    expect(write).not.toHaveBeenCalled()
    view.unmount()
    wrapper = undefined
    await flushPromises()
    expect(write).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(write.mock.calls[0])).toContain('离开前的最后编辑')
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('慢网自动保存期间再编辑并手动保存，串行补存最新内容一次', async () => {
    let release!: (result: { ok: boolean }) => void
    write.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const view = await open()
    await view.find('input').setValue('旧内容')
    await vi.advanceTimersByTimeAsync(900)
    try {
      await view.find('input').setValue('最新内容')
      await view.find('.pc-toolbar button').trigger('click')
      expect(write).toHaveBeenCalledTimes(1)
    } finally {
      release({ ok: true })
      await flushPromises()
    }
    expect(write).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(write.mock.calls[1])).toContain('最新内容')
    expect(view.text()).toContain(SAVE_OK_MESSAGE)
  })

  it('保存失败只报失败，点击重试才重新提交', async () => {
    write.mockResolvedValueOnce({ ok: false, error: 'NETWORK_FAIL' })
    const view = await open()
    await view.find('.pc-toolbar button').trigger('click')
    await flushPromises()
    expect(write).toHaveBeenCalledTimes(1)
    expect(view.text()).toContain('保存失败：NETWORK_FAIL')
    expect(view.text()).not.toContain(SAVE_OK_MESSAGE)
    await view.find('.pc-toolbar button').trigger('click')
    await flushPromises()
    expect(write).toHaveBeenCalledTimes(2)
    expect(view.text()).toContain(SAVE_OK_MESSAGE)
  })

  it('初次读取失败时，编辑、手动保存和离签都不能用空档覆盖原内容', async () => {
    read.mockResolvedValueOnce({ ok: false, error: 'NETWORK_FAIL' })
    const view = await open()
    await view.find('input').setValue('尚未成功载入')
    await view.find('.pc-toolbar button').trigger('click')
    await vi.advanceTimersByTimeAsync(1000)
    view.unmount()
    wrapper = undefined
    await flushPromises()
    expect(write).not.toHaveBeenCalled()
  })
})
