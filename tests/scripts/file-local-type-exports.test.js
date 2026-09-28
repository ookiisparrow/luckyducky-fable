// 本批只收回「页面、测试、别的包都没按名字引用」的类型导出。
// 定义留着，只是不再 export。export 加回去，这条检查变红。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseExports } from '../../scripts/lib/slim-scan.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 相对路径 → 本批收回导出的类型名。跳过项不在此表。 */
const CASES = [
  ['rewrite/admin/src/lib/mapMoney.ts', ['StatCard', 'SegStat', 'ActivityItem', 'DashboardVM', 'OrderItemVM', 'OverrideLineVM']],
  ['rewrite/admin/src/lib/mapPageContent.ts', ['WelcomeModel', 'CatalogPlayerModel', 'MePageModel', 'AboutModel', 'AgreementModel']],
  ['rewrite/admin/src/lib/mapCs.ts', ['ReportItem', 'PanelField', 'PanelGroupVM']],
  ['rewrite/admin/src/lib/fulfill.ts', ['PaperPreset', 'FulfillItem', 'PickSummary', 'LabelData', 'ScanResult']],
  ['rewrite/admin/src/lib/mapProducts.ts', ['StepMark']],
  ['rewrite/admin/src/lib/scmHandoff.ts', ['PurchaseHandoff', 'OutworkHandoff']],
  ['rewrite/admin/src/lib/nav.ts', ['WizardStep']],
  ['rewrite/admin/src/lib/scmFlow.ts', ['ScmFlowStep']],
  ['rewrite/admin/src/lib/compressImage.ts', ['CompressImageOpts']],
  ['rewrite/admin/src/api/client.ts', ['ClientDeps']],
  ['rewrite/mp/lib/player.ts', ['SegmentPub']],
]

const declRe = (name) => new RegExp(`(?:^|\\n)(?:export\\s+)?(?:interface|type)\\s+${name}\\b`)

describe('只在本文件用的类型不再 export', () => {
  for (const [rel, names] of CASES) {
    it(`${rel} 收回 ${names.join('、')}`, () => {
      const src = readFileSync(resolve(root, rel), 'utf8')
      const exported = new Set(parseExports(src))
      for (const name of names) {
        expect(exported.has(name), `${name} 仍被 export`).toBe(false)
        expect(declRe(name).test(src), `${name} 定义被删了`).toBe(true)
      }
    })
  }
})
