// kit/storage 签发缓存 + maxAge 透传 + imageProc 拼接（批1·根因#15/#7/#12）。
// 桩 getTempFileURL 记录每批大小（control.tempUrlCalls），接受 string|{fileID,maxAge} 双形。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { getTempUrls, getTempUrl, __resetTempUrlCacheForTest, IMAGE_URL_MAX_AGE } from '../src/kit/storage'

beforeEach(() => {
  control.reset() // 清 tempUrlCalls 计数
  __resetTempUrlCacheForTest() // 清容器级签发缓存·隔离跨 case 污染
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('IMAGE_URL_MAX_AGE 常量', () => {
  it('大白话：默认图片有效期 7200 秒（2h·保守起步）', () => {
    expect(IMAGE_URL_MAX_AGE).toBe(7200)
  })
})

describe('maxAge 透传', () => {
  it('大白话：传了 maxAge → sdk 收到 { fileID, maxAge } 形状的 fileList 项（真 sdk 换长效址靠此）', async () => {
    const seen: any[] = []
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => {
      seen.push(...fileList)
      return { fileList: fileList.map((it: any) => ({ fileID: it.fileID, tempFileURL: 'https://tmp/' + it.fileID })) }
    })
    const map = await getTempUrls(['cloud://a', 'cloud://b'], { maxAge: 7200 })
    expect(seen).toEqual([
      { fileID: 'cloud://a', maxAge: 7200 },
      { fileID: 'cloud://b', maxAge: 7200 },
    ])
    expect(map['cloud://a']).toBe('https://tmp/cloud://a')
    expect(map['cloud://b']).toBe('https://tmp/cloud://b')
  })

  it('大白话：未传 maxAge → fileList 传裸 string（现状字节级全等·learning 视频路径零变化）', async () => {
    const seen: any[] = []
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => {
      seen.push(...fileList)
      return { fileList: fileList.map((id: string) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })) }
    })
    await getTempUrls(['cloud://a'])
    expect(seen).toEqual(['cloud://a']) // 裸 string·非 {fileID,maxAge}
  })
})

describe('签发缓存（只有传 maxAge 才缓存）', () => {
  it('大白话：同 maxAge 同 fileID 二次调用命中缓存·不再进 sdk（tempUrlCalls 长度不增）', async () => {
    await getTempUrls(['cloud://a'], { maxAge: 7200 })
    const after1 = control.tempUrlCalls().length
    const map2 = await getTempUrls(['cloud://a'], { maxAge: 7200 })
    expect(control.tempUrlCalls().length).toBe(after1) // 第二次零 sdk 调用
    expect(map2['cloud://a']).toBe('https://tmp/cloud://a') // 仍拿到址（读自缓存）
  })

  it('大白话：未传 maxAge 不缓存·两次都进 sdk（现状全等回归）', async () => {
    await getTempUrls(['cloud://a'])
    const after1 = control.tempUrlCalls().length
    await getTempUrls(['cloud://a'])
    expect(control.tempUrlCalls().length).toBe(after1 + 1) // 无缓存·第二次仍进 sdk
  })

  it('大白话：不同 maxAge 各自独立 key·不串（换 maxAge 须重签）', async () => {
    await getTempUrls(['cloud://a'], { maxAge: 7200 })
    const before = control.tempUrlCalls().length
    await getTempUrls(['cloud://a'], { maxAge: 3600 }) // key 不同·不命中
    expect(control.tempUrlCalls().length).toBe(before + 1)
  })

  it('大白话：换不到（sdk 缺项返回 null）不写缓存·下次仍进 sdk（fail-soft·null 不缓存）', async () => {
    // 自带 sdk 调用计数（mock 替换了默认桩·不再 push control.tempUrlCalls·故本地数）
    let sdkCalls = 0
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => {
      sdkCalls++
      return {
        fileList: fileList
          .map((it: any) => (typeof it === 'string' ? it : it.fileID))
          .filter((id: string) => id !== 'cloud://bad')
          .map((id: string) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })),
      }
    })
    const m1 = await getTempUrls(['cloud://bad'], { maxAge: 7200 })
    expect(m1['cloud://bad']).toBe(null)
    expect(sdkCalls).toBe(1)
    const m2 = await getTempUrls(['cloud://bad'], { maxAge: 7200 })
    expect(m2['cloud://bad']).toBe(null)
    expect(sdkCalls).toBe(2) // null 未缓存·第二次仍进 sdk
  })

  it('大白话：时间推进过 TTL（maxAge*1000-5min）后缓存失效·重签进 sdk', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    await getTempUrls(['cloud://a'], { maxAge: 7200 })
    const after1 = control.tempUrlCalls().length
    vi.setSystemTime(6000 * 1000) // 仍在 TTL（6900s）内 → 命中不重签
    await getTempUrls(['cloud://a'], { maxAge: 7200 })
    expect(control.tempUrlCalls().length).toBe(after1)
    vi.setSystemTime(7000 * 1000) // 过 TTL（7200-300=6900s）→ 过期重签
    await getTempUrls(['cloud://a'], { maxAge: 7200 })
    expect(control.tempUrlCalls().length).toBe(after1 + 1)
    vi.useRealTimers()
  })
})

describe('imageProc 拼接（数据万象接缝·默认关）', () => {
  it('大白话：LD_IMAGE_PROC 非空时拼参数——无 ? 用 ?，已含 ? 用 &', async () => {
    vi.stubEnv('LD_IMAGE_PROC', 'imageMogr2/thumbnail/750x')
    vi.spyOn(cloud, 'getTempFileURL').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList.map((it: any) => {
        const id = typeof it === 'string' ? it : it.fileID
        return { fileID: id, tempFileURL: id === 'cloud://q' ? 'https://tmp/x?sign=1' : 'https://tmp/' + id }
      }),
    }))
    const m = await getTempUrls(['cloud://a', 'cloud://q'], { maxAge: 7200, imageProc: true })
    expect(m['cloud://a']).toBe('https://tmp/cloud://a?imageMogr2/thumbnail/750x') // 无 ? → ?
    expect(m['cloud://q']).toBe('https://tmp/x?sign=1&imageMogr2/thumbnail/750x') // 已含 ? → &
  })

  it('大白话：LD_IMAGE_PROC 空（默认关·控制台未开通）时原样不拼', async () => {
    vi.stubEnv('LD_IMAGE_PROC', '')
    const m = await getTempUrls(['cloud://a'], { maxAge: 7200, imageProc: true })
    expect(m['cloud://a']).toBe('https://tmp/cloud://a')
  })

  it('大白话：缓存存原始址·读出时才拼——先无 proc 缓存、后带 proc 命中读出即拼（开关翻转不吐旧态）', async () => {
    vi.stubEnv('LD_IMAGE_PROC', 'imageMogr2/x')
    await getTempUrls(['cloud://a'], { maxAge: 7200 }) // 无 imageProc·写缓存（原始址）
    const before = control.tempUrlCalls().length
    const m = await getTempUrls(['cloud://a'], { maxAge: 7200, imageProc: true }) // 命中缓存·读出拼
    expect(control.tempUrlCalls().length).toBe(before) // 命中·零 sdk
    expect(m['cloud://a']).toBe('https://tmp/cloud://a?imageMogr2/x')
  })
})

describe('≤50 分批（真 sdk 单次上限）', () => {
  it('大白话：>50 个 id 分批 ≤50/批（带 maxAge 也分批·映射不丢）', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => 'cloud://' + i)
    const map = await getTempUrls(ids, { maxAge: 7200 })
    const calls = control.tempUrlCalls()
    expect(calls).toEqual([50, 50, 20]) // 三批
    expect(Math.max(...calls)).toBeLessThanOrEqual(50)
    expect(map['cloud://0']).toBe('https://tmp/cloud://0')
    expect(map['cloud://119']).toBe('https://tmp/cloud://119')
  })
})

describe('getTempUrl 单 id 包装（getTempUrls 单实现·不传 opts 现状全等）', () => {
  it('大白话：空 id → null·不发请求；有 id → 换到址', async () => {
    expect(await getTempUrl('')).toBe(null)
    expect(control.tempUrlCalls().length).toBe(0)
    expect(await getTempUrl('cloud://a')).toBe('https://tmp/cloud://a')
  })
})
