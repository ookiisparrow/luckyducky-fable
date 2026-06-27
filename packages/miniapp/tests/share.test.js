import { describe, it, expect } from 'vitest'
import { buildProductShare } from '@/utils/share.js'

// 分享卡构造纯逻辑（R29/占位⑩）：title/path/imageUrl 三字段。
// 真机转发行为靠人验（根因#8），此处只锁可机器验的卡片构造。
describe('buildProductShare · 分享卡构造', () => {
  it('完整商品：标题=名、path 带 id、http 图透传', () => {
    const s = buildProductShare({ id: 'prod-9', name: '小鸭礼盒', image: 'https://cdn/x.png' })
    expect(s.title).toBe('小鸭礼盒')
    expect(s.path).toBe('/pages/detail/index?id=prod-9')
    expect(s.imageUrl).toBe('https://cdn/x.png')
  })

  it('云存储 fileID 封面：imageUrl 留空（用页面截图兜底，避免传无效地址）', () => {
    const s = buildProductShare({ id: 'p1', name: '围巾包', image: 'cloud://env/abc.png' })
    expect(s.imageUrl).toBe('')
  })

  it('缺名：回退默认标题', () => {
    expect(buildProductShare({ id: 'p1' }).title).toBe('小棉鸭 · 钩织材料包')
    expect(buildProductShare({ id: 'p1', name: '   ' }).title).toBe('小棉鸭 · 钩织材料包')
  })

  it('id 编码进 path（含特殊字符不破坏链接）', () => {
    expect(buildProductShare({ id: 'a b&c' }).path).toBe('/pages/detail/index?id=a%20b%26c')
  })

  it('空入参：不抛错，给安全兜底', () => {
    const s = buildProductShare()
    expect(s.title).toBe('小棉鸭 · 钩织材料包')
    expect(s.path).toBe('/pages/detail/index?id=')
    expect(s.imageUrl).toBe('')
  })
})
