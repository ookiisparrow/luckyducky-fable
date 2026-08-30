import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import courses from '../src/pages/Courses.vue?raw'
import helpVideos from '../src/pages/HelpVideos.vue?raw'
import agents from '../src/pages/Agents.vue?raw'
import checkpoints from '../src/pages/Checkpoints.vue?raw'
import conversations from '../src/pages/Conversations.vue?raw'
import csat from '../src/pages/Csat.vue?raw'
import reviews from '../src/pages/Reviews.vue?raw'
import kb from '../src/pages/Kb.vue?raw'
import products from '../src/pages/Products.vue?raw'
import scmBom from '../src/pages/ScmBom.vue?raw'
import scmMaterials from '../src/pages/ScmMaterials.vue?raw'
import scmOutwork from '../src/pages/ScmOutwork.vue?raw'
import scmPurchase from '../src/pages/ScmPurchase.vue?raw'
import adminReporter from '../src/lib/errorReporter.ts?raw'
import agentReporter from '../../agent/src/lib/errorReporter.ts?raw'

const consoleCss = readFileSync(new URL('../src/styles/console.css', import.meta.url), 'utf8')
const style = (source: string) => source.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''

describe('admin 页面共享结构样式单源（Issue #137 F1）', () => {
  it('课程与帮助视频的树编辑控件只在 console.css 定义', () => {
    for (const selector of [
      '.ld-autosave',
      '.ld-uploading',
      '.ld-tree-upload',
      '.ld-icon-btn',
      '.ld-tree-add',
      '.ld-tree-add-root',
    ]) {
      expect(consoleCss).toContain(`${selector} {`)
    }

    for (const source of [courses, helpVideos]) {
      expect(style(source)).not.toMatch(/^\.(autosave|uploading|upload|icon-btn|add-btn)\s*\{/m)
      for (const className of ['ld-autosave', 'ld-uploading', 'ld-tree-upload', 'ld-icon-btn', 'ld-tree-add', 'ld-tree-add-root']) {
        expect(source).toContain(className)
      }
    }
  })

  it('跨页小组件不再在非 red 页面各写一份', () => {
    for (const selector of ['.ld-range-chips', '.ld-mono', '.ld-muted', '.ld-more-wrap', '.ld-end-mark', '.ld-table-foot']) {
      expect(consoleCss).toContain(`${selector} {`)
    }
    for (const source of [courses, helpVideos, checkpoints, kb, products, scmBom]) {
      expect(style(source)).not.toMatch(/^\.(icon-btn|kb-del|eye-btn)\s*\{/m)
      expect(source).toContain('ld-icon-btn')
    }
    for (const source of [agents, conversations, csat, reviews]) {
      expect(style(source)).not.toMatch(/^\.(mono|muted|range-chips|more-wrap|end-mark)\s*\{/m)
      expect(source).toMatch(/ld-(mono|muted|range-chips|more-wrap|end-mark)/)
    }
    for (const source of [scmBom, scmMaterials, scmOutwork, scmPurchase]) {
      expect(style(source)).not.toMatch(/^\.tbl-foot\s*\{/m)
      expect(source).toContain('ld-table-foot')
    }
  })
})

describe('web errorReporter 刻意孪生声明（Issue #137 F3）', () => {
  it('两端头注互指并提醒改必同步', () => {
    expect(adminReporter).toContain('刻意孪生·改必同步：rewrite/agent/src/lib/errorReporter.ts')
    expect(agentReporter).toContain('刻意孪生·改必同步：rewrite/admin/src/lib/errorReporter.ts')
  })
})
