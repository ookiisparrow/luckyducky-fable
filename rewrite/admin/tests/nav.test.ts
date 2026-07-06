// 上下文侧栏导航模型（守卫 rw-admin-nav-contextual·根因#8「构建过≠真机能用」）：向导路由识别 /
// 步单源 ?step 夹取 / 6 步文案·顺序·图标对齐设计 console.pen Component/Sidebar（kz2uD）——换皮把上新
// 向导「按步直达」聚焦侧栏删光、退成全局 nav（决策§27②收敛为上下文侧栏·此表焊死设计单源）。
import { describe, it, expect } from 'vitest'
import { isWizardPath, wizardStepFromQuery, WIZARD_STEPS } from '../src/lib/nav'

describe('向导路由识别（上下文侧栏切换靶·isWizardPath）', () => {
  it('大白话：只有 /products/:id/wizard 进聚焦模式；列表/其它页不进', () => {
    expect(isWizardPath('/products/p-2048/wizard')).toBe(true)
    expect(isWizardPath('/products/abc123/wizard')).toBe(true)
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

describe('6 步文案/顺序/图标对齐设计 kz2uD（换皮删光聚焦侧栏·此表焊死设计单源）', () => {
  it('大白话：产品图片→商品信息→商品SKU→视频上传→二维码卡片→码批次与印刷包，步号 1..6', () => {
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual([
      '产品图片',
      '商品信息',
      '商品 SKU',
      '视频上传',
      '二维码卡片',
      '码批次与印刷包',
    ])
    expect(WIZARD_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6])
    // 图标名抄录设计帧 kz2uD 的 lucide icon（NavImg…NavBatch）
    expect(WIZARD_STEPS.map((s) => s.icon)).toEqual([
      'image',
      'file-text',
      'tags',
      'clapperboard',
      'qr-code',
      'printer',
    ])
  })
})
