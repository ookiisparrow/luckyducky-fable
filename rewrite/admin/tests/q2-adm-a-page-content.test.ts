// @vitest-environment happy-dom
// PageContent.vue 挂载测试：默认进首页签；切签真卸载旧签（旧签离签补存靠它）、挂新签（进签拉取靠它）；
// 切回来是全新实例（重新拉取，不沿用旧表单）。各签自己的读写另有测试，这里只换成记录生命周期的桩。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

// 桩签：挂载/卸载时记一笔，渲染带 data-tab 标记
const { log, tabStub } = vi.hoisted(() => {
  const log: string[] = []
  const tabStub = async (name: string) => {
    const { defineComponent, h, onMounted, onUnmounted } = await import('vue')
    const comp = defineComponent({
      setup() {
        onMounted(() => log.push('mount:' + name))
        onUnmounted(() => log.push('unmount:' + name))
        return () => h('div', { 'data-tab': name })
      },
    })
    return { default: comp }
  }
  return { log, tabStub }
})
vi.mock('../src/components/pagecontent/HomeContentForm.vue', () => tabStub('home'))
vi.mock('../src/components/pagecontent/WelcomeTab.vue', () => tabStub('welcome'))
vi.mock('../src/components/pagecontent/CatalogPlayerTab.vue', () => tabStub('catalogPlayer'))
vi.mock('../src/components/pagecontent/MeAboutTab.vue', () => tabStub('meAbout'))
vi.mock('../src/components/pagecontent/AgreementTab.vue', () => tabStub('agreement'))

import PageContent from '../src/pages/PageContent.vue'

beforeEach(() => {
  log.length = 0
})
const tab = (w: ReturnType<typeof mount>, label: string) => w.findAll('.pc-tab').find((b) => b.text() === label)!

describe('PageContent.vue 页签切换', () => {
  it('大白话：默认进「首页」签，只挂首页表单', () => {
    const w = mount(PageContent)
    expect(w.find('[data-tab]').attributes('data-tab')).toBe('home')
    expect(tab(w, '首页').classes()).toContain('on')
    expect(log).toEqual(['mount:home'])
  })

  it('大白话：切到「协议文案」——先卸首页签（触发离签补存）再挂协议签，高亮跟着走', async () => {
    const w = mount(PageContent)
    await tab(w, '协议文案').trigger('click')
    expect(w.findAll('[data-tab]').map((n) => n.attributes('data-tab'))).toEqual(['agreement'])
    expect(tab(w, '协议文案').classes()).toContain('on')
    expect(tab(w, '首页').classes()).not.toContain('on')
    expect(log).toEqual(['mount:home', 'unmount:home', 'mount:agreement'])
  })

  it('大白话：切走再切回首页，是重新挂一个首页签（会重新拉取），不是沿用旧的', async () => {
    const w = mount(PageContent)
    await tab(w, '欢迎与激活').trigger('click')
    await tab(w, '首页').trigger('click')
    expect(log).toEqual(['mount:home', 'unmount:home', 'mount:welcome', 'unmount:welcome', 'mount:home'])
  })
})
