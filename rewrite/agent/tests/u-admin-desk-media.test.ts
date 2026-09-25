// @vitest-environment happy-dom
// Desk.vue 图片占位卡点击：只有 idle/失败态才去下载；加载中/已加载/已过期点击不重复发请求。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('../src/api/client', () => ({ post: postMock, logout: vi.fn(), listKb: vi.fn().mockResolvedValue({ ok: true, list: [] }) }))

import Desk from '../src/Desk.vue'

const IMG = (msgid: string) => ({ at: 1000, direction: 'in', text: '[image]', msgtype: 'image', msgid, hasMedia: true })

async function mountWith(media: (msgId: string) => Promise<Record<string, unknown>>) {
  postMock.mockReset().mockImplementation(async (action: string, data: any) => {
    if (action === 'listMyActive') return { ok: true, sessions: [{ sessionId: 's1', externalUserId: 'wm-000001' }] }
    if (action === 'listQueue') return { ok: true, items: [] }
    if (action === 'getThread') return { ok: true, messages: [IMG('ok'), IMG('old'), IMG('bad')], nextCursor: 0 }
    if (action === 'getMediaUrl') return media(data.msgId)
    return { ok: true, panels: [] }
  })
  const w = mount(Desk)
  await flushPromises()
  await w.find('aside .qitem').trigger('click')
  await flushPromises()
  return w
}
const mediaCalls = () => postMock.mock.calls.filter((c) => c[0] === 'getMediaUrl').map((c) => c[1].msgId)

describe('Desk.vue 图片加载点击闸', () => {
  it('加载中再点不重复请求；已加载/已过期点击 no-op；失败态可重试', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let badTries = 0
    const w = await mountWith(async (id) => {
      if (id === 'ok') {
        await gate
        return { ok: true, url: 'https://x/ok.jpg' }
      }
      if (id === 'old') return { ok: false, error: 'EXPIRED' }
      return ++badTries === 1 ? { ok: false, error: 'DOWNLOAD_FAILED' } : { ok: true, url: 'https://x/bad.jpg' }
    })
    const cards = () => w.findAll('.media')
    expect(cards()).toHaveLength(3)

    await cards()[0].trigger('click')
    await cards()[0].trigger('click') // 加载中
    expect(cards()[0].text()).toBe('加载中…')
    release()
    await flushPromises()
    expect(cards()[0].find('img').exists()).toBe(true)
    await cards()[0].trigger('click') // 已加载
    await flushPromises()

    await cards()[1].trigger('click')
    await flushPromises()
    expect(cards()[1].text()).toBe('图片已过期（超 3 天）')
    await cards()[1].trigger('click') // 已过期
    await flushPromises()

    await cards()[2].trigger('click')
    await flushPromises()
    expect(cards()[2].text()).toBe('加载失败，点击重试')
    await cards()[2].trigger('click') // 失败可重试
    await flushPromises()
    expect(cards()[2].find('img').exists()).toBe(true)

    expect(mediaCalls()).toEqual(['ok', 'old', 'bad', 'bad'])
    w.unmount()
  })
})
