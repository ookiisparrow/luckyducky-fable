// 上下文侧栏导航模型（守卫 rw-admin-nav-contextual·根因#8「构建过≠真机能用」）：向导路由识别 /
// 步单源 ?step 夹取 / 5 步文案·顺序·图标（老板预览后改口径：封面并进第 1 步、卡片上传并进第 5 步）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWizardPath, wizardStepFromQuery, WIZARD_STEPS, WIZARD_STEP_MAX, currentNavGroup, SHOP_PRIMARY_NAV } from '../src/lib/nav'

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
  it('大白话：1..5 内原样；旧 step=6 落到第 5 步；越界夹回；缺省/非法回 1', () => {
    expect(WIZARD_STEP_MAX).toBe(5)
    expect(wizardStepFromQuery('3')).toBe(3)
    expect(wizardStepFromQuery('1')).toBe(1)
    expect(wizardStepFromQuery('5')).toBe(5)
    expect(wizardStepFromQuery('6')).toBe(5) // 旧深链兼容 → 新第 5 步
    expect(wizardStepFromQuery('9')).toBe(5) // 上越界夹到 5
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

describe('5 步文案/顺序（封面并进第 1 步、卡片上传并进第 5 步·不要「设计」）', () => {
  it('大白话：新建与封面→图片与名字→详情信息→课程视频→卡片与二维码，步号 1..5', () => {
    expect(WIZARD_STEPS).toHaveLength(5)
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual([
      '新建与封面',
      '图片与名字',
      '详情信息',
      '课程视频',
      '卡片与二维码',
    ])
    expect(WIZARD_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5])
    expect(WIZARD_STEPS.map((s) => s.icon)).toEqual(['plus', 'image', 'file-text', 'clapperboard', 'credit-card'])
    expect(WIZARD_STEPS.map((s) => s.hint)).toEqual([
      '创建草稿并上传封面图',
      '商品图集与标题文案',
      '规格、价格与详情页',
      '上传并发布教学视频',
      '卡面素材与批次二维码',
    ])
    expect(WIZARD_STEPS.every((s) => !s.label.includes('设计'))).toBe(true)
  })
})

describe('控制台顶栏 + 侧栏步提示（Magic Patterns 打磨·不编同步时间）', () => {
  it('大白话：顶栏写明「同步到小程序顾客才看得见」；侧栏步下挂 hint；向导进度条有卡托', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const shell = readFileSync(join(here, '../src/shell/Shell.vue'), 'utf8')
    const wiz = readFileSync(join(here, '../src/pages/Wizard.vue'), 'utf8')
    expect(shell).toContain('class="topbar"')
    expect(shell).toContain('Lucky Ducky 运营控制台')
    expect(shell).toContain('小棉鸭')
    expect(shell).toContain('同步到小程序')
    expect(shell).toContain('to="/showcase"')
    expect(shell).toContain('s.hint')
    expect(shell).toContain('class="wiz-hint"')
    expect(shell).not.toMatch(/分钟前同步/) // 禁止 Magic Patterns 假同步时间
    expect(wiz).toContain('class="rail-card"')
    expect(wiz).toContain('这五件事互不等同')
    expect(wiz).toContain('卡片素材')
    expect(wiz).toContain('二维码批次')
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
  it('大白话：第 1 步封面、第 2 步图与名、第 3 步详情各切一块；第 5 步卡片上传+二维码同屏', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const wiz = readFileSync(join(here, '../src/pages/Wizard.vue'), 'utf8')
    const prod = readFileSync(join(here, '../src/pages/Products.vue'), 'utf8')
    const router = readFileSync(join(here, '../src/router.ts'), 'utf8')
    expect(wiz).not.toMatch(/Products v-if="step <= 3"/)
    expect(wiz).toMatch(/wizard-slice="1"|:wizard-slice="1"/)
    expect(wiz).toMatch(/wizard-slice="2"|:wizard-slice="2"/)
    expect(wiz).toMatch(/wizard-slice="3"|:wizard-slice="3"/)
    expect(prod).toMatch(/wizardSlice/)
    expect(prod).toMatch(/showCover/)
    expect(prod).toMatch(/showLook/)
    expect(prod).toMatch(/showDetail/)
    expect(wiz).not.toMatch(/卡片设计/)
    expect(wiz).not.toMatch(/\/ 6/)
    expect(wiz).toMatch(/\/ 5/)
    expect(wiz).not.toMatch(/step === 6/)
    expect(wiz).toMatch(/step === 5/)
    expect(wiz).toMatch(/<Cards[\s\S]*<Batches/)
    expect(router).toMatch(/String\(to\.query\.step\) === '6'/)
    expect(router).toMatch(/step:\s*'5'/)
    expect(wiz).toMatch(/loading\.value = true/)
    expect(wiz).toContain('没有找到这个商品')
    expect(wiz).toContain('草稿已创建，列表还在同步')
    expect(wiz).toMatch(/<Courses[\s\S]*@saved/)
    expect(wiz).toMatch(/<Batches[\s\S]*@saved/)
  })
})
