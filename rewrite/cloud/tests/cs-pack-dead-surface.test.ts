import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assemblePackagingBubbles, atomicText, loadAtomicAssets } from '../src/functions/cs/kfCallback/csAtomic'
import { composeLine, emptyFlow } from '../src/functions/cs/kfCallback/scriptReply'
import { scriptPools } from '../src/functions/cs/kfCallback/scriptPool'
import SCRIPT_MD from '../src/functions/cs/kfCallback/scriptAssets.generated.json'

const here = dirname(fileURLToPath(import.meta.url))
const kf = join(here, '../src/functions/cs/kfCallback')

const PHOTO1 = atomicText('business/packaging/ask_photo_01')

describe('包装对客死面已卸', () => {
  it('大白话：对客包装句只来自 atomic，不再从 Pack 文本抽', () => {
    const expectAtomic = assemblePackagingBubbles({
      text: '包裹被摔坏了',
      hasRecentOrder: true,
      rand: () => 0,
    })
    const { line, pieces } = composeLine(
      emptyFlow(),
      {
        model: 'jev-1.13.0',
        urgency: 0.2,
        department: 'sales',
        needStatus: 'packaging',
        emotionStatus: 'upset',
        orderStatus: 'delivered',
        topic: 'packaging',
      },
      '包裹被摔坏了',
      () => 0
    )
    expect(pieces).toEqual(expectAtomic)
    expect(line).toBe(expectAtomic.join('\n'))
    expect(line).toContain(PHOTO1)
    expect(line).not.toMatch(/订单号/)
  })

  it('大白话：Pack 对客抽句、旧 firstTouch、空池映射、科室菜单桥都卸了', () => {
    const pack = readFileSync(join(kf, 'csPack.ts'), 'utf8')
    expect(pack).not.toMatch(/export function packScriptReply/)
    expect(pack).not.toMatch(/export function pickPackScript/)
    expect(pack).not.toMatch(/export function packScriptLines/)
    expect(pack).not.toMatch(/export function parsePackScript/)
    expect(pack).not.toMatch(/export function packagingPhotoAsks/)

    const atomic = readFileSync(join(kf, 'csAtomic.ts'), 'utf8')
    expect(atomic).not.toMatch(/PACKAGING_FIRST_TOUCH_ID/)
    expect(atomic).not.toMatch(/packagingFirstTouchBubbles/)
    expect(atomic).not.toMatch(/firstTouchLegacy/)

    const jev = readFileSync(join(kf, 'jev.ts'), 'utf8')
    expect(jev).not.toMatch(/export function mapJevDepartment/)
    expect(jev).not.toMatch(/export function jevHitWord/)

    const pool = readFileSync(join(kf, 'scriptPool.ts'), 'utf8')
    for (const id of ['pause', 'think', 'logisticsSlow', 'rushEmpathy', 'missingSearch']) {
      expect(pool, id).not.toMatch(new RegExp("id: '" + id + "'"))
      expect(scriptPools()[id]).toBeUndefined()
    }

    const assets = loadAtomicAssets()
    expect(assets.route.sequences && (assets.route.sequences as { firstTouchLegacy?: string }).firstTouchLegacy).toBeUndefined()
    expect(assets.sequences.packaging_damage_first_touch).toBeUndefined()
    expect(existsSync(join(kf, 'atomic-v1/sequences/packaging_damage_first_touch.json'))).toBe(false)
    expect(existsSync(join(kf, 'atomic-v1/lib/_deprecated/emotion_try_hard'))).toBe(false)

    const bundled = Object.keys(SCRIPT_MD as Record<string, string>)
    for (const dead of [
      'README.md',
      'docs/02-语气穿插-停顿思考.md',
      'docs/08-jev-route.md',
      'docs/10-主流程-含bot情绪表演-v0.0.2.md',
      'docs/13-退货开场.md',
    ]) {
      expect(bundled, dead).not.toContain(dead)
    }
    expect(bundled.every((k) => k.endsWith('.md'))).toBe(true)
    expect(readdirSync(join(kf, 'cs-scripts/docs')).includes('08-jev-route.md')).toBe(true)
  })
})
