/**
 * 把 kfCallback/cs-pack/<id> 打成 csPackAssets.generated.json（构建时内联，运行时不拉 GitHub）。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = import.meta.dirname
const PACK_ID = 'lucky-ducky-2026-09-19'
const SRC = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'cs-pack', PACK_ID)
const OUT = join(ROOT, '..', 'src', 'functions', 'cs', 'kfCallback', 'csPackAssets.generated.json')

const readJson = (name) => JSON.parse(readFileSync(join(SRC, name), 'utf8'))
const scripts = {}
for (const f of readdirSync(join(SRC, 'scripts'))) {
  if (!f.endsWith('.txt')) continue
  scripts[f.replace(/\.txt$/, '')] = readFileSync(join(SRC, 'scripts', f), 'utf8')
}

writeFileSync(
  OUT,
  JSON.stringify({
    pack_id: PACK_ID,
    brief: readJson('brief.json'),
    state_machine: readJson('state_machine.json'),
    triage_rules: readJson('triage_rules.json'),
    slots_schema: readJson('slots_schema.json'),
    handoff_payload: readJson('handoff_payload.json'),
    scripts,
  }) + '\n'
)
console.log(`bundled cs-pack ${PACK_ID} (${Object.keys(scripts).length} scripts) → csPackAssets.generated.json`)
