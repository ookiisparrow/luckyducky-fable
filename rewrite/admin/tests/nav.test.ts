// 上下文侧栏导航模型（守卫 rw-admin-nav-contextual·根因#8「构建过≠真机能用」）：向导路由识别 /
// 步单源 ?step 夹取 / 6 步文案·顺序·图标对齐设计 console.pen Component/Sidebar（kz2uD）——换皮把上新
// 向导「按步直达」聚焦侧栏删光、退成全局 nav（决策§27②收敛为上下文侧栏·此表焊死设计单源）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWizardPath, wizardStepFromQuery, WIZARD_STEPS, currentNavGroup, SHOP_PRIMARY_NAV } from '../src/lib/nav'

describe('向导路由识别（上下文侧栏切换靶·isWizardPath）', () => {
  it('大白话：只有 /products/:id/wizard 进聚焦模式；列表/其它页不进', () => {
    expect(isWizardPath('/products/p-2048/wizard')).toBe(true)
    expect(isWizardPath('/products/abc123/wizard')).toBe(true)
    expect(isWizardPath('/launch')).toBe(true) // 上新入口＝向导第 1 步（尚未有商品编号）
    expect(isWizardPath('/products')).toBe(false)
    expect(isWizardPath('/')).toBe(false)
    expect(isWizardPath('/orders')).toBe(false)
    expect(isWizardPath('/products/p1/wizard/extra')).toBe(false) // 多段不算
  })
})

describe('步单源 ?step 夹取（wizardStepFromQuery·URL 为步真值·侧栏与横向 rail 同步）', () => {
  it('大白话：1..6 内原样；越界夹回；缺省/非法回 1', () => {
    expect(wizardStepFromQuery('3')).toBe(3)
    expect(wizardStepFromQuery('1')).toBe(1)
    expect(wizardStepFromQuery('6')).toBe(6)
    expect(wizardStepFromQuery('9')).toBe(6) // 上越界夹到 6
    expect(wizardStepFromQuery('0')).toBe(1) // 下越界夹到 1
    expect(wizardStepFromQuery(undefined)).toBe(1)
    expect(wizardStepFromQuery('x')).toBe(1) // 非数字回 1
  })
})

describe('当前路由所在组定位（currentNavGroup·治组头死点击 + 反转 localStorage 展开集·根因#8）', () => {
  const NAV = [
    { group: '数据看板', solo: true, items: [{ path: '/' }] },
    { group: '订单履约', items: [{ path: '/orders' }, { path: '/fulfill' }, { path: '/refunds' }] },
    { group: '商品上新', items: [{ path: '/products' }, { path: '/courses' }] },
  ]
  it('大白话：命中哪个可展开组就回该组名；solo 项与未命中回空（空=没有需 pin 的当前组）', () => {
    expect(currentNavGroup(NAV, '/fulfill')).toBe('订单履约')
    expect(currentNavGroup(NAV, '/courses')).toBe('商品上新')
    expect(currentNavGroup(NAV, '/')).toBe('') // solo 项不算可折叠组
    expect(currentNavGroup(NAV, '/settings')).toBe('') // 未在任何组
  })
})

describe('6 步文案/顺序（老板拍板主路径·覆盖旧设计帧 kz2uD 文案）', () => {
  it('大白话：新建商品→图片与名字→详情信息→课程视频→卡片设计→二维码管理，步号 1..6', () => {
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual([
      '新建商品',
      '图片与名字',
      '详情信息',
      '课程视频',
      '卡片设计',
      '二维码管理',
    ])
    expect(WIZARD_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(WIZARD_STEPS.map((s) => s.icon)).toEqual([
      'plus',
      'image',
      'file-text',
      'clapperboard',
      'credit-card',
      'qr-code',
    ])
  })
})

describe('商品与上新组只留两大入口（防再把上新藏进子页/更多操作）', () => {
  it('大白话：侧栏这组只有「产品管理」和「上新」，路径对得上', () => {
    expect(SHOP_PRIMARY_NAV.map((x) => x.label)).toEqual(['产品管理', '上新'])
    expect(SHOP_PRIMARY_NAV.map((x) => x.path)).toEqual(['/products', '/launch'])
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '../src/shell/Shell.vue'), 'utf8')
    const block = src.match(/group:\s*'商品与上新'[\s\S]*?items:\s*\[([\s\S]*?)\]/)
    expect(block).toBeTruthy()
    const paths = [...block![1].matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
    expect(paths).toEqual(['/products', '/launch'])
    expect(src).toContain("label: '产品管理'")
    expect(src).toContain("label: '上新'")
    expect(block![1]).not.toMatch(/课程管理|卡片设计|小程序橱窗|评价挑选/)
  })
})

describe('向导 1–3 步不再嵌同一张大表（假进度 P0）', () => {
  it('大白话：向导不再用 step<=3 整表嵌入；第 2/3 步各切一块字段', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const wiz = readFileSync(join(here, '../src/pages/Wizard.vue'), 'utf8')
    const prod = readFileSync(join(here, '../src/pages/Products.vue'), 'utf8')
    expect(wiz).not.toMatch(/Products v-if="step <= 3"/)
    expect(wiz).toMatch(/wizard-slice/)
    expect(prod).toMatch(/wizardSlice/)
    expect(prod).toMatch(/showLook/)
    expect(prod).toMatch(/showDetail/)
  })
})
