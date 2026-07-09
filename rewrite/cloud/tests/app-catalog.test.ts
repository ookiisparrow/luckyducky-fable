// 黄金 admin-misc §二（公开目录读）+ productListed（只下发在售）+ learning-content §九（守卫 rw-user-catalog-golden）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string) => app({ action })

beforeEach(() => control.reset())
afterEach(() => vi.restoreAllMocks())

describe('getProducts（公开只读·停售过滤）', () => {
  it('大白话：按排序升序下发；停售（listed:false）不下发；旧无 listed 字段的商品仍下发（向后兼容免回灌）', async () => {
    control.seed('products', [
      { _id: 'p2', name: 'B', sort: 2 }, // 旧数据无 listed → 可售
      { _id: 'p1', name: 'A', sort: 1, listed: true },
      { _id: 'p3', name: 'C', sort: 3, listed: false }, // 停售 → 不下发
    ])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    expect(r.list.map((p: { _id: string }) => p._id)).toEqual(['p1', 'p2'])
  })

  it('大白话：空库返回空列表不报错', async () => {
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    expect(r.list).toEqual([])
  })
})

describe('getContent（公开只读·空兜底）', () => {
  it('大白话：无首页记录返回空（前端回退默认文案）；有记录返回该文档', async () => {
    const r1: any = await call('getContent')
    expect(r1.ok).toBe(true)
    expect(r1.home).toBe(null)

    control.seed('content', [{ _id: 'home', heroTitle: '幸运鸭' }])
    const r2: any = await call('getContent')
    expect(r2.home.heroTitle).toBe('幸运鸭')
  })
})

// ── 批B·图片链加载提速：cloud:// 裸 fileID 服务端批量换 https 短时址（同 reviews.ts 先例），
// 客户端 <image> 免付一次 fileID→临时址解析（~100-300ms/文件）。以下为先立的红测试（现状未转换·预期先红）。
describe('getProducts（cloud:// 封面/图册批量换临时地址·批B 图片提速·预期先红）', () => {
  it('大白话：cover 与 images[] 里的 cloud:// 值换成 https 短时址（同 reviews.ts:122 换址口径）', async () => {
    control.seed('products', [
      { _id: 'p1', name: 'A', sort: 1, cover: 'cloud://p1-cover.jpg', images: ['cloud://p1-img1.jpg', 'cloud://p1-img2.jpg'] },
    ])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    const p1 = r.list.find((p: any) => p._id === 'p1')
    expect(p1.cover).toBe('https://tmp/cloud://p1-cover.jpg')
    expect(p1.images).toEqual(['https://tmp/cloud://p1-img1.jpg', 'https://tmp/cloud://p1-img2.jpg'])
  })

  it('大白话：已是 https 的值 / 空串 / 缺字段原样透传，不炸也不误加前缀', async () => {
    control.seed('products', [
      { _id: 'p2', name: 'B', sort: 2, cover: 'https://cdn.example.com/p2.jpg' }, // 已是 https、无 images 字段
      { _id: 'p3', name: 'C', sort: 3, images: ['', 'cloud://p3-img.jpg'] }, // 无 cover 字段、images 含空串
    ])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    const p2 = r.list.find((p: any) => p._id === 'p2')
    expect(p2.cover).toBe('https://cdn.example.com/p2.jpg') // 已是 https → 原样，不叠加 tmp 前缀
    const p3 = r.list.find((p: any) => p._id === 'p3')
    expect(p3.images[0]).toBe('') // 空串原样透传，不炸
    expect(p3.images[1]).toBe('https://tmp/cloud://p3-img.jpg')
  })

  it('大白话：换址失败（storage 桩返回缺项）时该图回退原 fileID，不吞整条商品/整个响应（fail-soft 读路径）', async () => {
    // 模拟「cloud://bad.jpg」这一项换不到临时地址（存储桩缺项返回）：其余请求正常换到。
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList
        .filter((id: string) => id !== 'cloud://bad.jpg')
        .map((id: string) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })),
    }))
    control.seed('products', [
      { _id: 'p1', name: 'A', sort: 1, cover: 'cloud://ok.jpg', images: ['cloud://bad.jpg', 'cloud://good2.jpg'] },
    ])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true) // 整个响应不因单项换址失败而炸
    const p1 = r.list.find((p: any) => p._id === 'p1')
    expect(p1).toBeTruthy() // 商品本身不被吞
    expect(p1.cover).toBe('https://tmp/cloud://ok.jpg') // 正常换到的项
    expect(p1.images[0]).toBe('cloud://bad.jpg') // 换不到 → 回退原 fileID（不是 null/空串，前端仍能兜底走原 cloud:// 或占位）
    expect(p1.images[1]).toBe('https://tmp/cloud://good2.jpg')
  })
})

describe('getContent（home 内容图字段批量换临时地址·批B 图片提速·预期先红）', () => {
  // 图字段真实消费面见 rewrite/mp/lib/mapHome.ts：hero.img / feature.img / reassure.items[].img /
  // reviews.items[].img / closing.img（trust/faq/footer 无图字段·不在此列）。
  const seedHome = (overrides: Record<string, unknown> = {}) =>
    control.seed('content', [
      {
        _id: 'home',
        hero: { title: 'X', tagline: 'Y', search: 'Z', img: 'cloud://hero.jpg' },
        feature: { title: 'F', body: 'B', img: 'cloud://feature.jpg' },
        reassure: {
          heading: 'H',
          lead: 'L',
          items: [
            { icon: 'heart', title: 'T1', body: 'B1', img: 'cloud://reassure1.jpg' },
            { icon: 'shield', title: 'T2', body: 'B2', img: '' },
          ],
        },
        reviews: {
          heading: 'RH',
          items: [
            { quote: 'Q1', user: 'U1', img: 'cloud://review1.jpg' },
            { quote: 'Q2', user: 'U2', img: 'https://cdn.example.com/review2.jpg' },
          ],
        },
        closing: { title: 'CT', cta: 'CTA', img: 'cloud://closing.jpg' },
        ...overrides,
      },
    ])

  it('大白话：hero/特写/放心区/买家秀/收尾的 cloud:// img 全部换 https 短时址；已是 https/空串原样透传', async () => {
    seedHome()
    const r: any = await call('getContent')
    expect(r.ok).toBe(true)
    const h = r.home
    expect(h.hero.img).toBe('https://tmp/cloud://hero.jpg')
    expect(h.feature.img).toBe('https://tmp/cloud://feature.jpg')
    expect(h.reassure.items[0].img).toBe('https://tmp/cloud://reassure1.jpg')
    expect(h.reassure.items[1].img).toBe('') // 空串不炸、不误加前缀
    expect(h.reviews.items[0].img).toBe('https://tmp/cloud://review1.jpg')
    expect(h.reviews.items[1].img).toBe('https://cdn.example.com/review2.jpg') // 已是 https 原样透传
    expect(h.closing.img).toBe('https://tmp/cloud://closing.jpg')
  })

  it('大白话：缺整块（无 hero/feature/reassure/reviews/closing）不炸，其余字段原样透传', async () => {
    control.seed('content', [{ _id: 'home', heroTitle: '旧字段' }])
    const r: any = await call('getContent')
    expect(r.ok).toBe(true)
    expect(r.home.heroTitle).toBe('旧字段')
  })

  it('大白话：换址失败（storage 桩返回缺项）时该图字段回退原 fileID，不吞整个 home 响应（fail-soft 读路径）', async () => {
    // 模拟「cloud://feature.jpg」这一项换不到临时地址：其余正常换到。
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList
        .filter((id: string) => id !== 'cloud://feature.jpg')
        .map((id: string) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })),
    }))
    seedHome()
    const r: any = await call('getContent')
    expect(r.ok).toBe(true) // 单项换址失败不吞整个响应
    expect(r.home.hero.img).toBe('https://tmp/cloud://hero.jpg') // 正常换到的项不受影响
    expect(r.home.feature.img).toBe('cloud://feature.jpg') // 换不到 → 回退原 fileID
  })
})
