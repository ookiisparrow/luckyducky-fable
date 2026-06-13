/**
 * 商品种子单一来源（根因账本 #5：种子双份手工同步 → 一处 canonical）。
 * miniapp `data/catalog.js`（同步身份视图）与 cloud `seedProducts`（云端灌库）都从这里派生，
 * 改样例商品只改本文件一处。courseId = 配套课程（confirmEnter 退货权启发匹配反查），未上线为 null。
 */
export interface SeedProduct {
  id: string
  name: string
  tag: string
  price: number
  was: number
  featured: boolean
  sort: number
  courseId: string | null
}

export const SEED_PRODUCTS: SeedProduct[] = [
  { id: 'prod-1', name: '幸运小鸭礼盒', tag: '送礼首选', price: 198, was: 258, featured: true, sort: 0, courseId: 'course-duck' },
  { id: 'prod-2', name: '进阶套装 · 小伙伴们', tag: '4 只装', price: 399, was: 499, featured: true, sort: 1, courseId: null },
  { id: 'prod-3', name: '微笑小鸡 · 入门', tag: '零基础首选', price: 128, was: 168, featured: true, sort: 2, courseId: null },
  { id: 'prod-4', name: '幸运小鸭 · 单只', tag: '单只装', price: 98, was: 138, featured: false, sort: 3, courseId: 'course-duck' },
  { id: 'prod-5', name: '云朵小羊 · 入门', tag: '入门首选', price: 148, was: 198, featured: false, sort: 4, courseId: null },
]
