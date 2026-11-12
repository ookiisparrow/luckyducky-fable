// #404 / #417：页面、测试、别的包都没按名字引用的符号，只去掉 export，定义留着。
// export 加回去，这条检查变红。跳过项不在此表。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseExports } from '../../scripts/lib/slim-scan.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 相对路径 → 本批收回导出的名字。 */
const CASES = [
  ['rewrite/cloud/src/functions/cs/kfCallback/bubbles.ts', ['DEFAULT_MAX_BUBBLES']],
  ['rewrite/cloud/src/functions/cs/kfCallback/scriptReply.ts', ['checkpointOf', 'compressNeed']],
  ['rewrite/cloud/src/functions/cs/kfCallback/scriptPool.ts', ['parseSections']],
  ['rewrite/cloud/src/functions/cs/kfCallback/csPack.ts', ['PackHumanSub', 'loadPackSession', 'persistablePack']],
  ['rewrite/cloud/src/functions/cs/kfCallback/csAtomic.ts', ['PackagingFacets', 'AtomicPlayCtx']],
  ['rewrite/cloud/src/functions/cs/kfCallback/trialRefresh.ts', ['isRefreshMenuId', 'trialRefreshConfirmMenu', 'IncomingLite']],
  ['rewrite/cloud/src/functions/cs/kfCallback/jev.ts', ['JevDepartment', 'JEV_ORDER', 'JEV_EMOTION', 'JEV_SEVERITY', 'JEV_RESP']],
  ['rewrite/cloud/src/kit/botpush.ts', ['BotFetch']],
  ['rewrite/cloud/src/functions/adminApi/lib.ts', ['capsForRole']],
  ['rewrite/shared/src/observability.ts', ['CheckStatus']],
  ['rewrite/shared/src/contracts.ts', ['AdminOrderRow', 'AdminRefundRow', 'AdminConversationMsg', 'AdminQcRow']],
  ['rewrite/mp/lib/cart.ts', ['CartItem']],
  ['rewrite/mp/lib/mapDetail.ts', ['SkuVM']],
  ['rewrite/mp/lib/snapshot.ts', ['SnapProduct']],
  ['rewrite/mp/lib/mapLearning.ts', ['ActivationErrReason', 'ActivationView', 'CatalogLessonVM', 'HelpVideoSegVM']],
  ['rewrite/mp/lib/player.ts', ['SegmentPub', 'LessonPub', 'ChapterPub']],
  ['rewrite/mp/lib/pageContent.ts', ['PageKey']],
  ['rewrite/admin/src/lib/mapMoney.ts', ['StatCard', 'SegStat', 'ActivityItem', 'DashboardVM', 'OrderItemVM', 'OverrideLineVM', 'TodoInputs', 'TodoCounts']],
  ['rewrite/admin/src/lib/mapPageContent.ts', ['WelcomeModel', 'CatalogPlayerModel', 'MePageModel', 'AboutModel', 'AgreementModel', 'AgreementClause']],
  ['rewrite/admin/src/lib/mapCs.ts', ['ReportItem', 'PanelField', 'PanelGroupVM']],
  ['rewrite/admin/src/lib/fulfill.ts', ['PaperPreset', 'FulfillItem', 'PickSummary', 'LabelData', 'ScanResult']],
  ['rewrite/admin/src/lib/mapProducts.ts', ['StepMark', 'ProductState']],
  ['rewrite/admin/src/lib/scmHandoff.ts', ['PurchaseHandoff', 'OutworkHandoff']],
  ['rewrite/admin/src/lib/nav.ts', ['WizardStep']],
  ['rewrite/admin/src/lib/scmFlow.ts', ['ScmFlowStep']],
  ['rewrite/admin/src/lib/compressImage.ts', ['CompressImageOpts']],
  ['rewrite/admin/src/api/client.ts', ['ClientDeps']],
  ['rewrite/admin/src/lib/mapContent.ts', ['HomeModel']],
]

const declRe = (name) => new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?(?:interface|type|function|const)\\s+${name}\\b`)

describe('只在本文件用的符号不再 export', () => {
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
