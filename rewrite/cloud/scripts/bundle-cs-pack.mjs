/**
 * 把 kfCallback/cs-pack/<id> 里运行时真读的字段打成 csPackAssets.generated.json（构建时内联，运行时不拉 GitHub）。
 * 只打分流规则、forbidden_transitions、交接必填字段名。话术正文、简介、槽位表留在源目录。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = import.meta.dirname
const PACK_ID = 'lucky-ducky-2026-09-19'
const SRC = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'cs-pack', PACK_ID)
const OUT = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'csPackAssets.generated.json')

const readJson = (name) => JSON.parse(readFileSync(join(SRC, name), 'utf8'))
const triage = readJson('triage_rules.json')
const machine = readJson('state_machine.json')
const handoff = readJson('handoff_payload.json')

writeFileSync(
  OUT,
  JSON.stringify({
    pack_id: PACK_ID,
    state_machine: {
      forbidden_transitions: machine.forbidden_transitions,
    },
    triage_rules: {
      rules: triage.rules,
      stage_keywords: triage.stage_keywords,
    },
    handoff_payload: {
      required_fields: (handoff.required_fields || []).map((f) => ({ name: f.name })),
    },
  }) + '\n'
)
console.log(`bundled cs-pack ${PACK_ID} (rules + forbidden + handoff names) → csPackAssets.generated.json`)
