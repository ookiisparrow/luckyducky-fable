// 上下文侧栏导航模型（根因#8「构建过≠真机能用」）：向导路由识别 /
// 步单源 ?step 夹取 / 5 步文案·顺序（老板预览后改口径：封面并进第 1 步、卡片上传并进第 5 步）。
import { describe, it, expect } from 'vitest'
import { isWizardPath, wizardStepFromQuery, WIZARD_STEPS, WIZARD_STEP_MAX, currentNavGroup } from '../src/lib/nav'

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
    expect(WIZARD_STEPS.map((s) => s.hint)).toEqual([
      '创建草稿并上传封面图',
      '商品图集与标题文案',
      '规格、价格与详情页',
      '上传视频并发布课程；上架商品不代替发布课程',
      '卡面素材与批次二维码',
    ])
    expect(WIZARD_STEPS.every((s) => !s.label.includes('设计'))).toBe(true)
  })
})
