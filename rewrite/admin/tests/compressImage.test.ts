// 后台 canvas 压缩单源（治病根#5 样板复制即漂移）：四份几乎同形的阶梯压图收成 lib/compressImage.ts。
// 源码扫描钉调用点走共用函数、本地不再留 canvas 阶梯；行为测钉默认 900 档与商品 720 覆盖。
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMPRESS_DEFAULT_MAX_WIDTH,
  COMPRESS_DEFAULT_QUALITIES,
  compressImage,
} from '../src/lib/compressImage'
import helperSrc from '../src/lib/compressImage.ts?raw'
import usePageContentSrc from '../src/lib/usePageContent.ts?raw'
import cardsSrc from '../src/pages/Cards.vue?raw'
import productsSrc from '../src/pages/Products.vue?raw'
import homeContentFormSrc from '../src/components/pagecontent/HomeContentForm.vue?raw'
import catalogPlayerTabSrc from '../src/components/pagecontent/CatalogPlayerTab.vue?raw'

const CALL_SITES: { name: string; src: string; override: boolean }[] = [
  { name: 'Cards.vue', src: cardsSrc, override: false },
  { name: 'Products.vue', src: productsSrc, override: true },
  { name: 'HomeContentForm.vue', src: homeContentFormSrc, override: false },
  { name: 'CatalogPlayerTab.vue', src: catalogPlayerTabSrc, override: false },
]

function stubBrowser(img: { width: number; height: number }, payloads: string[]) {
  const qualitiesTried: number[] = []
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: vi.fn(),
    }),
    toDataURL: (_type: string, q: number) => {
      qualitiesTried.push(q)
      const payload = payloads[qualitiesTried.length - 1] ?? payloads[payloads.length - 1] ?? 'x'
      return `data:image/jpeg;base64,${payload}`
    },
  }
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null
      onerror: ((err?: unknown) => void) | null = null
      width = img.width
      height = img.height
      set src(_u: string) {
        queueMicrotask(() => this.onload?.())
      }
    },
  )
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error('unexpected element ' + tag)
      return canvas
    },
  })
  const create = vi.fn(() => 'blob:mock')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  return { canvas, qualitiesTried, create, revoke }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('compressImage 调用点单源（四份不再各自抄阶梯）', () => {
  it('大白话：四个上传口都调共用函数，本地不再留 canvas 质量阶梯', () => {
    for (const site of CALL_SITES) {
      expect(site.src, site.name).toMatch(/from ['"](?:\.\.\/){1,2}lib\/compressImage['"]/)
      expect(site.src, site.name).not.toContain("toDataURL('image/jpeg'")
      expect(site.src, site.name).not.toContain("createElement('canvas')")
      expect(site.src, site.name).not.toMatch(/async function compress\(/)
    }
    expect(usePageContentSrc).not.toMatch(/compressImage|toDataURL\('image\/jpeg'/)
    expect(helperSrc).toContain(`COMPRESS_DEFAULT_MAX_WIDTH = ${COMPRESS_DEFAULT_MAX_WIDTH}`)
    expect(helperSrc).toMatch(/0\.8,\s*0\.6,\s*0\.45,\s*0\.3/)
  })

  it('大白话：默认跟卡片/首页/目录 hero 走 900；商品封面/相册显式覆盖 720（M3 起就写明，不是抄偏）', () => {
    expect(COMPRESS_DEFAULT_MAX_WIDTH).toBe(900)
    expect([...COMPRESS_DEFAULT_QUALITIES]).toEqual([0.8, 0.6, 0.45, 0.3])
    expect(productsSrc).toMatch(/maxWidth:\s*720/)
    expect(productsSrc).toMatch(/0\.8,\s*0\.65,\s*0\.5,\s*0\.35/)
    expect(productsSrc).toMatch(/compressImage\(file,\s*\w+\)/)
    for (const site of CALL_SITES.filter((s) => !s.override)) {
      expect(site.src, site.name).toMatch(/compressImage\(file\)/)
      expect(site.src, site.name).not.toMatch(/maxWidth:\s*720/)
    }
  })
})

describe('compressImage 行为', () => {
  it('大白话：图比上限宽就按上限缩；质量阶梯从高到低压，压进 80K 就停', async () => {
    const { canvas, qualitiesTried, revoke } = stubBrowser({ width: 1800, height: 900 }, [
      'x'.repeat(80_001),
      'ok',
    ])
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file)).resolves.toBe('ok')
    expect(canvas.width).toBe(900)
    expect(canvas.height).toBe(450)
    expect(qualitiesTried).toEqual([0.8, 0.6])
    expect(revoke).toHaveBeenCalledWith('blob:mock')
  })

  it('大白话：商品 720 覆盖按自己的宽和阶梯走，不改默认', async () => {
    const { canvas, qualitiesTried } = stubBrowser({ width: 1800, height: 900 }, ['ok'])
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file, { maxWidth: 720, qualities: [0.8, 0.65, 0.5, 0.35] })).resolves.toBe('ok')
    expect(canvas.width).toBe(720)
    expect(canvas.height).toBe(360)
    expect(qualitiesTried).toEqual([0.8])
    const again = stubBrowser({ width: 500, height: 400 }, ['tiny'])
    await expect(compressImage(file)).resolves.toBe('tiny')
    expect(again.canvas.width).toBe(500)
    expect(again.qualitiesTried).toEqual([0.8])
  })

  it('大白话：四档都压不进 80K 就交空串，调用方提示换小图', async () => {
    stubBrowser({ width: 200, height: 200 }, ['x'.repeat(80_001)])
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file)).resolves.toBe('')
  })
})
