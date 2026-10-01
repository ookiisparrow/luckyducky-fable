// 首页内容（getContent：首页文案 + 各页背景图）会话缓存（#444·2026-10-02 开发者工具实测：首页、目录页、欢迎页各拉一遍）：
// 首页 reload 强刷并回填；目录页 / 欢迎页命中复用零重拉；冷进（扫码直进欢迎页）照常拉、并发共用一次；失败不缓存不覆盖。
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { getContentMock } = vi.hoisted(() => ({ getContentMock: vi.fn() }))
vi.mock('../api/catalog', () => ({ getContent: getContentMock, getPageContent: vi.fn() }))

import { getHomeContent, __resetForTest } from '../lib/pageContent'

const A = { ok: true, home: { v: 'A' } }
const B = { ok: true, home: { v: 'B' } }

beforeEach(() => {
  __resetForTest()
  getContentMock.mockReset()
})

describe('首页内容会话缓存（#444）', () => {
  it('大白话：首页拉过以后，目录页、欢迎页再取不发请求', async () => {
    getContentMock.mockResolvedValue(A)
    expect(await getHomeContent({ force: true })).toEqual(A)
    expect(await getHomeContent()).toEqual(A)
    expect(await getHomeContent()).toEqual(A)
    expect(getContentMock).toHaveBeenCalledTimes(1)
  })

  it('大白话：首页下拉刷新（强刷）总拉最新，并刷新缓存给后面的页用', async () => {
    getContentMock.mockResolvedValueOnce(A).mockResolvedValueOnce(B)
    await getHomeContent()
    expect(await getHomeContent({ force: true })).toEqual(B)
    expect(await getHomeContent()).toEqual(B)
    expect(getContentMock).toHaveBeenCalledTimes(2)
  })

  it('大白话：拉失败不缓存、不抹掉已有的——失败照实告诉调用方，下次不强刷仍拿旧的；没缓存时下次重试', async () => {
    getContentMock.mockResolvedValueOnce({ ok: false, error: 'NETWORK' }).mockResolvedValueOnce(A).mockResolvedValueOnce({ ok: false, error: 'NETWORK' })
    expect((await getHomeContent()).ok).toBe(false)
    expect(await getHomeContent()).toEqual(A)
    expect((await getHomeContent({ force: true })).ok).toBe(false)
    expect(await getHomeContent()).toEqual(A)
    expect(getContentMock).toHaveBeenCalledTimes(3)
  })

  it('大白话：冷进时两页同时要（欢迎页 + 目录页撞车）只真拉一次', async () => {
    getContentMock.mockResolvedValue(A)
    const [x, y] = await Promise.all([getHomeContent(), getHomeContent()])
    expect(x).toEqual(A)
    expect(y).toEqual(A)
    expect(getContentMock).toHaveBeenCalledTimes(1)
  })
})
