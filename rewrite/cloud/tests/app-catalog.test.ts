// 黄金 admin-misc §二（公开目录读）+ productListed（只下发在售）+ learning-content §九（守卫 rw-user-catalog-golden）。
// 批1·列表瘦身（getProducts 只下发 cover·images[] 收窄进 getProductDetail·守卫 rw-catalog-list-cover-only）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { __resetTempUrlCacheForTest } from '../src/kit/storage'

const call = (action: string, data?: any) => app({ action, data })
const fid = (it: any) => (typeof it === 'string' ? it : it.fileID) // 桩 fileList 项：string | {fileID,maxAge}

beforeEach(() => {
  control.reset()
  __resetTempUrlCacheForTest() // 批1·清容器级签发缓存·隔离跨 case 复用相同 fileID 的污染（getProducts 走 maxAge 会写缓存）
})
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

// ── 批1·列表瘦身 + 签发缓存：cover cloud:// 换 https 短时址（带 maxAge·imageProc 默认关），images[] 不下发（列表用不到·图册收窄进详情页）。
describe('getProducts（列表只签 cover·images 不下发·批1 瘦身）', () => {
  it('大白话：cover 的 cloud:// 换 https 短时址；images[] 一律不下发（列表瘦身·图册收窄进 getProductDetail）', async () => {
    control.seed('products', [
      { _id: 'p1', name: 'A', sort: 1, cover: 'cloud://p1-cover.jpg', images: ['cloud://p1-img1.jpg', 'cloud://p1-img2.jpg'] },
    ])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    const p1 = r.list.find((p: any) => p._id === 'p1')
    expect(p1.cover).toBe('https://tmp/cloud://p1-cover.jpg')
    expect('images' in p1).toBe(false) // 列表瘦身：images 不下发（守卫 rw-catalog-list-cover-only）
  })

  it('大白话：cover 已是 https / 缺 cover 字段原样透传·images 一律不下发', async () => {
    control.seed('products', [
      { _id: 'p2', name: 'B', sort: 2, cover: 'https://cdn.example.com/p2.jpg' }, // 已是 https
      { _id: 'p3', name: 'C', sort: 3, images: ['', 'cloud://p3-img.jpg'] }, // 无 cover 字段·有 images
    ])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true)
    const p2 = r.list.find((p: any) => p._id === 'p2')
    expect(p2.cover).toBe('https://cdn.example.com/p2.jpg') // 已是 https → 原样
    const p3 = r.list.find((p: any) => p._id === 'p3')
    expect('images' in p3).toBe(false) // images 不下发
  })

  it('大白话：cover 换址失败（storage 桩缺项）回退原 fileID·不吞整条商品/整个响应（fail-soft）', async () => {
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList
        .map(fid)
        .filter((id: string) => id !== 'cloud://bad.jpg')
        .map((id: string) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })),
    }))
    control.seed('products', [{ _id: 'p1', name: 'A', sort: 1, cover: 'cloud://bad.jpg' }])
    const r: any = await call('getProducts')
    expect(r.ok).toBe(true) // 整个响应不因单项换址失败而炸
    const p1 = r.list.find((p: any) => p._id === 'p1')
    expect(p1).toBeTruthy() // 商品本身不被吞
    expect(p1.cover).toBe('cloud://bad.jpg') // 换不到 → 回退原 fileID（前端仍能兜底）
  })
})

describe('getProductDetail（公开只读·列表瘦身配套·批1）', () => {
  it('大白话：按 id 拉本档·cover + images[] 换 https 短时址·图册补齐', async () => {
    control.seed('products', [
      { _id: 'p1', name: 'A', sort: 1, cover: 'cloud://p1-cover.jpg', images: ['cloud://p1-img1.jpg', 'cloud://p1-img2.jpg'] },
    ])
    const r: any = await call('getProductDetail', { id: 'p1' })
    expect(r.ok).toBe(true)
    expect(r.product.cover).toBe('https://tmp/cloud://p1-cover.jpg')
    expect(r.product.images).toEqual(['https://tmp/cloud://p1-img1.jpg', 'https://tmp/cloud://p1-img2.jpg'])
  })

  it('大白话：未知 id → { product:null }（fail-soft·前端保持列表项降级不裂）', async () => {
    const r: any = await call('getProductDetail', { id: 'ghost' })
    expect(r.ok).toBe(true)
    expect(r.product).toBe(null)
  })

  it('大白话：停售（listed:false）→ { product:null }（同 getProducts 停售口径·不下发给顾客）', async () => {
    control.seed('products', [{ _id: 'p9', name: 'Z', sort: 9, listed: false, cover: 'cloud://p9.jpg' }])
    const r: any = await call('getProductDetail', { id: 'p9' })
    expect(r.ok).toBe(true)
    expect(r.product).toBe(null)
  })

  it('大白话：空 id → err（不信前端·根因#3）', async () => {
    const r: any = await call('getProductDetail', { id: '' })
    expect(r.ok).toBe(false)
  })

  it('大白话：cover/images 中换不到的项回退原 fileID（fail-soft·不吞整档）', async () => {
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList
        .map(fid)
        .filter((id: string) => id !== 'cloud://bad.jpg')
        .map((id: string) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })),
    }))
    control.seed('products', [
      { _id: 'p1', name: 'A', sort: 1, cover: 'cloud://ok.jpg', images: ['cloud://bad.jpg', 'cloud://good.jpg'] },
    ])
    const r: any = await call('getProductDetail', { id: 'p1' })
    expect(r.ok).toBe(true)
    expect(r.product.cover).toBe('https://tmp/cloud://ok.jpg')
    expect(r.product.images[0]).toBe('cloud://bad.jpg') // 换不到 → 回退原 fileID
    expect(r.product.images[1]).toBe('https://tmp/cloud://good.jpg')
  })
})

describe('getContent（home 内容图字段批量换临时地址·批B 图片提速）', () => {
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
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList
        .map(fid)
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
