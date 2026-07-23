#!/usr/bin/env node
/**
 * 体检面板生成器（守卫 check-report-in-gates + check-report-derived·roots 正册）。
 *
 * 为什么：一百多条守卫 + 千余条测试的健康状态只在终端滚屏里一闪而过——哪条守卫红了、
 * 哪个测试挂了、每条病根有几道网，没有可以「单独查看」的入口。本面板把它们变成一页
 * 可筛可搜的红绿视图（失败置顶·单条带复跑命令·病根覆盖地图）。
 *
 * 派生铁律（防手抄漂移·病根#11 同款）：面板守卫清单 = check-structure 三个注册表的机器派生 + vitest JSON 实跑结果——本文件不允许手抄任何守卫清单；
 * 遍历/判定复用两检查器 export 的同一套 walk/checkFile（不自建第二套语义）。
 * 漏一条注册表守卫 → tests/scripts/checkReport.test.js 红。
 *
 * 面板只呈现不拦截：`npm run check` 仍是唯一质量闸；本脚本恒 exit 0（生成器自身崩溃除外）。
 *
 * 用法：
 *   npm run report            # 全量：守卫 + vitest + typecheck + lint（约 2-3 分钟）
 *   npm run report -- --fast  # 快查：守卫 + vitest（跳过 typecheck/lint，约 1 分钟）
 * 产物：reports/check-report.html（自包含·浏览器直开）+ reports/check-report.json（机器可 diff）
 *
 * 后期加针对性测试（自动入册·无需登记）：
 *   新线行为测试 → rewrite/<包>/tests/xxx.test.ts；守卫/脚本 → tests/scripts/xxx.test.js。
 *   落文件即被 vitest 项目自动发现，下次生成即出现在面板；要升格为守卫（纳入 guard-coverage
 *   病根覆盖核算）再到 check-structure.mjs 的 typeAndTestGuards 加 { id, mechanism:'test',
 *   roots, reverseTest } 一条。结构守卫 → repoChecks/fileRules 加条目，面板同样自动入册。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  repoChecks,
  fileRules,
  typeAndTestGuards,
  walk as structureWalk,
  checkFile as structureCheckFile,
  SRC_DIRS,
} from './check-structure.mjs'
// check-conventions.mjs（旧线 packages/miniapp 专用扫描器）已随旧线于 2026-07-23 瘦身拍板批退役

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'reports')

// ============ 派生层（纯函数·checkReport.test.js 直测） ============

/** 守卫总册：三个注册表的机器派生（一条不漏也不多造——测试焊死）。 */
export function guardCatalog() {
  return [
    ...repoChecks.map((g) => ({ id: g.id, kind: 'repo', roots: g.roots || [], desc: g.desc || '' })),
    ...fileRules.map((g) => ({ id: g.id, kind: 'file', roots: g.roots || [], desc: g.desc || '逐文件规则（违例信息见规则 test 文案）' })),
    ...typeAndTestGuards.map((g) => ({
      id: g.id,
      kind: g.mechanism, // 'ts' | 'test'
      roots: g.roots || [],
      desc: g.mechanism === 'test' ? `行为测试守卫 → ${g.reverseTest}` : g.reverseTest || '',
      reverseTest: g.reverseTest,
    })),
  ]
}

/** 病根册解析：docs/根因账本.md §一 的 `### N. 标题`（与 guard-coverage/guard-count-synced 同源口径）。 */
export function parseRootLedger() {
  const p = join(ROOT, 'docs/根因账本.md')
  if (!existsSync(p)) return []
  const head = readFileSync(p, 'utf8').split('## 二、')[0]
  return [...head.matchAll(/^###\s*(\d+)\.\s*(.+?)\s*$/gm)].map((m) => ({ num: Number(m[1]), title: m[2] }))
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmtMs = (ms) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)

/** 病根/标签 → 守卫聚合（#N 行带账本标题；13 条病根即使 0 守卫也列出——覆盖诚实）。 */
function buildRoots(guards, ledger) {
  const byLabel = new Map()
  for (const g of guards) {
    for (const r of g.roots) {
      if (!byLabel.has(r)) byLabel.set(r, [])
      byLabel.get(r).push(g)
    }
  }
  const numbered = ledger.map(({ num, title }) => {
    const list = byLabel.get('#' + num) || []
    byLabel.delete('#' + num)
    return { label: '#' + num, title, guards: list, red: list.filter((g) => g.ok === false).length }
  })
  const labels = [...byLabel.entries()]
    .map(([label, list]) => ({ label, title: '', guards: list, red: list.filter((g) => g.ok === false).length }))
    .sort((a, b) => b.guards.length - a.guards.length)
  return { numbered, labels }
}

// ============ 采集层（跑真守卫/真测试——npm run report 用；测试不走这层） ============

/** 结构规则守卫实跑（repoChecks 逐条计时；fileRules 复用检查器的 walk+checkFile）。 */
export function collectRuleGuardResults() {
  const rows = []
  for (const c of repoChecks) {
    const t0 = Date.now()
    let violations
    try {
      violations = c.run().map((msg) => ({ msg }))
    } catch (e) {
      violations = [{ msg: `守卫自身异常：${e?.message || e}` }]
    }
    rows.push({ id: c.id, kind: 'repo', roots: c.roots || [], desc: c.desc || '', ok: violations.length === 0, ms: Date.now() - t0, violations })
  }
  // fileRules：一次遍历，按规则 id 归组（checkFile 已带 structure-ok/注释跳过语义——同一套判定）
  const t1 = Date.now()
  const fileHits = new Map(fileRules.map((r) => [r.id, []]))
  for (const dir of SRC_DIRS) for (const f of structureWalk(join(ROOT, dir))) for (const v of structureCheckFile(f)) fileHits.get(v.id)?.push(v)
  const fileMs = (Date.now() - t1) / Math.max(1, fileRules.length)
  for (const r of fileRules) {
    const hits = fileHits.get(r.id) || []
    rows.push({ id: r.id, kind: 'file', roots: r.roots || [], desc: '逐文件规则', ok: hits.length === 0, ms: fileMs, violations: hits.map((v) => ({ msg: `${v.loc} ${v.msg}` })) })
  }
  return rows
}

function sh(cmd, opts = {}) {
  try {
    const out = execSync(cmd, { cwd: ROOT, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024, ...opts })
    return { ok: true, out: String(out || '') }
  } catch (e) {
    return { ok: false, out: String(e?.stdout || '') + String(e?.stderr || ''), code: e?.status }
  }
}

/** vitest 全量实跑（JSON reporter）→ 逐测试行。挂测不阻断（面板要的就是红灯现场）。 */
export function collectVitest() {
  mkdirSync(OUT_DIR, { recursive: true })
  const jsonPath = join(OUT_DIR, 'vitest-raw.json')
  const t0 = Date.now()
  const r = sh(`npx vitest run --reporter=json --outputFile=${JSON.stringify(jsonPath)}`)
  const ms = Date.now() - t0
  if (!existsSync(jsonPath)) return { ok: false, ms, tests: [], error: 'vitest 未产出 JSON：' + r.out.slice(-400) }
  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const projectOf = (rel) =>
    rel.startsWith('rewrite/') ? 'rw（活线）'
    : rel.startsWith('tests/scripts/') ? 'scripts（守卫元测试）'
    : '其他'
  const tests = []
  for (const tr of raw.testResults || []) {
    const rel = relative(ROOT, tr.name)
    for (const a of tr.assertionResults || []) {
      const skipped = ['skipped', 'pending', 'todo', 'disabled'].includes(a.status)
      tests.push({
        file: rel,
        project: projectOf(rel),
        name: a.fullName || [...(a.ancestorTitles || []), a.title].filter(Boolean).join(' › '),
        ok: a.status === 'passed',
        skipped,
        ms: Math.round(a.duration || 0),
        error: a.status === 'failed' ? (a.failureMessages || []).join('\n').slice(0, 1200) : undefined,
      })
    }
  }
  return { ok: raw.success === true, ms, tests, total: raw.numTotalTests, failed: raw.numFailedTests, passed: raw.numPassedTests }
}

/** typecheck：按 package.json 的 typecheck 脚本逐段跑（单源派生命令序列，不手抄）。 */
export function collectTypecheck() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const parts = String(pkg.scripts?.typecheck || '').split('&&').map((s) => s.trim()).filter(Boolean)
  return parts.map((cmd) => {
    const t0 = Date.now()
    const r = sh(cmd)
    const label = (cmd.match(/-p\s+(\S+?)(?:\/tsconfig\.json)?(\s|$)/) || [])[1] || cmd
    return { pkg: label, cmd, ok: r.ok, ms: Date.now() - t0, out: r.ok ? '' : r.out.slice(0, 2000) }
  })
}

export function collectLint() {
  const t0 = Date.now()
  const r = sh('npx eslint . --format json')
  let errors = 0, warnings = 0
  const files = []
  try {
    for (const f of JSON.parse(r.out || '[]')) {
      errors += f.errorCount || 0
      warnings += f.warningCount || 0
      if (f.errorCount > 0) files.push(`${relative(ROOT, f.filePath)}（${f.errorCount} 错）`)
    }
  } catch {
    return { ok: r.ok, ms: Date.now() - t0, errors: r.ok ? 0 : -1, warnings: 0, files: ['eslint JSON 解析失败：' + r.out.slice(0, 200)] }
  }
  return { ok: errors === 0, ms: Date.now() - t0, errors, warnings, files: files.slice(0, 12) }
}

// ============ 渲染层（自包含 HTML·亮暗双主题·纯手写无外链） ============

export function renderHtml(data) {
  const { meta = {}, guards = [], tests = [], gates = {}, ledger = [] } = data
  const redGuards = guards.filter((g) => g.ok === false)
  const skipGuards = guards.filter((g) => g.ok == null)
  const redTests = tests.filter((t) => !t.ok && !t.skipped)
  const skippedTests = tests.filter((t) => t.skipped)
  const roots = buildRoots(guards, ledger)
  const tc = gates.typecheck || []
  const lint = gates.lint
  const allGreen = redGuards.length === 0 && redTests.length === 0 && tc.every((t) => t.ok) && (!lint || lint.ok)

  const dot = (g) => (g.ok === false ? '<span class="dot bad"></span>' : g.ok == null ? '<span class="dot skip"></span>' : '<span class="dot ok"></span>')
  const chips = (arr) => arr.map((r) => `<span class="chip">${esc(r)}</span>`).join('')
  const vmsg = (v) => (typeof v === 'string' ? v : v?.msg ?? '') // 违例条目形状宽容：string | {msg}

  const guardRows = guards
    .map((g) => {
      const hay = `${g.id} ${g.kind} ${(g.roots || []).join(' ')} ${g.desc}`.toLowerCase()
      const firstBad = g.ok === false && g.violations?.length ? `<div class="vio">${esc(vmsg(g.violations[0])).slice(0, 300)}${g.violations.length > 1 ? `（共 ${g.violations.length} 处）` : ''}</div>` : ''
      return `<tr class="grow${g.ok === false ? ' bad' : ''}" data-hay="${esc(hay)}" data-kind="${g.kind}" data-ok="${g.ok === false ? '0' : g.ok == null ? 's' : '1'}" data-rw="${g.id.startsWith('rw-') ? '1' : '0'}">
<td>${dot(g)}</td><td class="mono">${esc(g.id)}</td><td><span class="chip kind">${{ repo: '仓级', file: '逐文件', convention: '约定', ts: '类型', test: '行为测试' }[g.kind] || esc(g.kind)}</span></td>
<td class="roots">${chips(g.roots || [])}</td><td class="desc">${esc(g.desc)}${firstBad}</td><td class="num">${g.ms != null ? fmtMs(g.ms) : '—'}</td></tr>`
    })
    .join('\n')

  // 测试按 project → file 分组
  const byFile = new Map()
  for (const t of tests) {
    if (!byFile.has(t.file)) byFile.set(t.file, [])
    byFile.get(t.file).push(t)
  }
  const byProject = new Map()
  for (const [file, list] of byFile) {
    const proj = list[0].project
    if (!byProject.has(proj)) byProject.set(proj, [])
    byProject.get(proj).push({ file, list })
  }
  const testSections = [...byProject.entries()]
    .map(([proj, files]) => {
      const projRed = files.reduce((s, f) => s + f.list.filter((t) => !t.ok && !t.skipped).length, 0)
      const blocks = files
        .sort((a, b) => a.file.localeCompare(b.file))
        .map(({ file, list }) => {
          const red = list.filter((t) => !t.ok && !t.skipped).length
          const rows = list
            .map((t) => {
              const cmd = `npx vitest run ${t.file} -t ${JSON.stringify(t.name.split(' › ').pop() || t.name)}`
              return `<tr class="trow${!t.ok && !t.skipped ? ' bad' : ''}${t.skipped ? ' skip' : ''}" data-ok="${t.ok ? '1' : t.skipped ? 's' : '0'}" data-hay="${esc((t.file + ' ' + t.name).toLowerCase())}">
<td>${t.skipped ? '<span class="dot skip"></span>' : t.ok ? '<span class="dot ok"></span>' : '<span class="dot bad"></span>'}</td>
<td class="tname">${esc(t.name)}${t.error ? `<pre class="err">${esc(t.error)}</pre><code class="cmd">${esc(cmd)}</code>` : ''}</td>
<td class="num">${fmtMs(t.ms || 0)}</td></tr>`
            })
            .join('\n')
          return `<details class="tfile" ${red ? 'open' : ''} data-red="${red}" data-hay="${esc(file.toLowerCase())}">
<summary>${red ? '<span class="dot bad"></span>' : '<span class="dot ok"></span>'} <span class="mono">${esc(file)}</span>
<span class="meta">${list.length} 条${red ? `·<b class="badtxt">${red} 红</b>` : ''}</span>
<code class="cmd">npx vitest run ${esc(file)}</code></summary>
<table class="ttable">${rows}</table></details>`
        })
        .join('\n')
      return `<section class="proj"><h3>${esc(proj)} <span class="meta">${files.length} 文件${projRed ? `·<b class="badtxt">${projRed} 红</b>` : '·全绿'}</span></h3>${blocks}</section>`
    })
    .join('\n')

  const redZone = allGreen
    ? `<div class="green-banner">✅ 全绿 —— ${guards.length} 条守卫 / ${tests.length} 条测试无一红灯${skipGuards.length ? `（${skipGuards.length} 条守卫本次未跑）` : ''}</div>`
    : `<div class="redlist">
${redGuards.map((g) => `<div class="redcard"><div class="rhead"><span class="dot bad"></span><code>${esc(g.id)}</code><span class="chip kind">守卫</span></div>${(g.violations || []).slice(0, 6).map((v) => `<div class="vio">${esc(vmsg(v))}</div>`).join('')}<code class="cmd">npm run check:structure</code></div>`).join('\n')}
${redTests.map((t) => `<div class="redcard"><div class="rhead"><span class="dot bad"></span><span class="tname">${esc(t.name)}</span><span class="chip kind">测试</span></div><div class="vio mono">${esc(t.file)}</div>${t.error ? `<pre class="err">${esc(t.error)}</pre>` : ''}<code class="cmd">npx vitest run ${esc(t.file)}</code></div>`).join('\n')}
${tc.filter((x) => !x.ok).map((x) => `<div class="redcard"><div class="rhead"><span class="dot bad"></span><code>typecheck ${esc(x.pkg)}</code></div><pre class="err">${esc((x.out || '').slice(0, 800))}</pre><code class="cmd">${esc(x.cmd || '')}</code></div>`).join('\n')}
${lint && !lint.ok ? `<div class="redcard"><div class="rhead"><span class="dot bad"></span><code>eslint</code></div><div class="vio">${lint.errors} 个错误：${esc((lint.files || []).join('、'))}</div><code class="cmd">npm run lint</code></div>` : ''}
</div>`

  const rootRow = (r) =>
    `<tr><td class="mono">${esc(r.label)}</td><td>${esc(r.title)}</td><td class="num">${r.guards.length}</td><td class="num">${r.red ? `<b class="badtxt">${r.red}</b>` : '0'}</td><td class="roots">${r.guards.slice(0, 14).map((g) => `<code class="gid${g.ok === false ? ' badtxt' : ''}">${esc(g.id)}</code>`).join(' ')}${r.guards.length > 14 ? ` <span class="meta">…共 ${r.guards.length} 条</span>` : ''}</td></tr>`

  const tile = (label, value, sub, bad) =>
    `<div class="tile${bad ? ' bad' : ''}"><div class="tlabel">${esc(label)}</div><div class="tvalue">${value}</div><div class="tsub">${esc(sub)}</div></div>`

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Lucky Ducky 守卫与测试体检面板</title>
<style>
:root{--bg:#fcfaff;--surface:#ffffff;--ink:#241733;--meta:#7e6e96;--line:#c9bbe0;--hair:#e9e2f4;--accent:#7b5caf;--accent-soft:#f3edfb;--ok:#2e7d4f;--ok-bg:#e9f5ee;--bad:#b93a2b;--bad-bg:#fdeeea;--skip:#8d81a5;--code-bg:#f5f1fb}
@media (prefers-color-scheme: dark){:root{--bg:#171120;--surface:#201931;--ink:#efeaf8;--meta:#a294bd;--line:#3c3153;--hair:#2b2340;--accent:#b795ec;--accent-soft:#2a2140;--ok:#6fc99a;--ok-bg:#17301f;--bad:#ee8474;--bad-bg:#3a1d18;--skip:#8d81a5;--code-bg:#281f3d}}
:root[data-theme="light"]{--bg:#fcfaff;--surface:#ffffff;--ink:#241733;--meta:#7e6e96;--line:#c9bbe0;--hair:#e9e2f4;--accent:#7b5caf;--accent-soft:#f3edfb;--ok:#2e7d4f;--ok-bg:#e9f5ee;--bad:#b93a2b;--bad-bg:#fdeeea;--skip:#8d81a5;--code-bg:#f5f1fb}
:root[data-theme="dark"]{--bg:#171120;--surface:#201931;--ink:#efeaf8;--meta:#a294bd;--line:#3c3153;--hair:#2b2340;--accent:#b795ec;--accent-soft:#2a2140;--ok:#6fc99a;--ok-bg:#17301f;--bad:#ee8474;--bad-bg:#3a1d18;--skip:#8d81a5;--code-bg:#281f3d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 80px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:0 0 12px;color:var(--accent)}
h3{font-size:14px;margin:18px 0 8px}
.mono,code,pre{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace}
.meta{color:var(--meta);font-size:12px}
.metaline{color:var(--meta);font-size:12px;display:flex;gap:14px;flex-wrap:wrap;margin-bottom:20px}
section.card{background:var(--surface);border:1px solid var(--hair);border-radius:12px;padding:18px 20px;margin-bottom:18px;overflow-x:auto}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px}
.tile{background:var(--surface);border:1px solid var(--hair);border-left:4px solid var(--ok);border-radius:10px;padding:12px 14px}
.tile.bad{border-left-color:var(--bad)}
.tlabel{font-size:12px;color:var(--meta)}
.tvalue{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.tsub{font-size:12px;color:var(--meta)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:2px;vertical-align:baseline}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}.dot.skip{background:var(--skip)}
.badtxt{color:var(--bad)}
.green-banner{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok);border-radius:10px;padding:14px 18px;font-weight:600}
.redcard{background:var(--bad-bg);border:1px solid var(--bad);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.rhead{display:flex;gap:8px;align-items:center;font-weight:600;margin-bottom:6px}
.vio{font-size:13px;margin:4px 0;overflow-wrap:anywhere}
.err{background:var(--code-bg);border-radius:8px;padding:8px 10px;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:6px 0}
.cmd{display:inline-block;background:var(--code-bg);border-radius:6px;padding:2px 8px;font-size:12px;color:var(--accent);user-select:all;margin-top:4px}
table{border-collapse:collapse;width:100%}
th{font-size:12px;color:var(--meta);text-align:left;font-weight:500;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:6px 8px;border-bottom:1px solid var(--hair);vertical-align:top;font-size:13px}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--meta)}
tr.bad td{background:var(--bad-bg)}
tr.skip td{color:var(--skip)}
.chip{display:inline-block;background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:0 8px;font-size:11px;margin:1px 2px;white-space:nowrap}
.chip.kind{background:transparent;border:1px solid var(--line);color:var(--meta)}
.gid{font-size:11px;background:var(--code-bg);border-radius:4px;padding:0 4px}
.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.controls input[type=search]{flex:1;min-width:220px;padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:var(--ink);font-size:13px}
.fbtn{border:1px solid var(--line);background:transparent;color:var(--meta);border-radius:999px;padding:4px 12px;font-size:12px;cursor:pointer}
.fbtn.on{background:var(--accent);border-color:var(--accent);color:#fff}
.fbtn:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
details.tfile{border:1px solid var(--hair);border-radius:10px;padding:6px 12px;margin:8px 0;background:var(--surface)}
details.tfile summary{cursor:pointer;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}
details.tfile summary::-webkit-details-marker{display:none}
.ttable{margin-top:6px}
.tname{overflow-wrap:anywhere}
.help li{margin:6px 0}
.help code{background:var(--code-bg);border-radius:4px;padding:0 5px}
footer{color:var(--meta);font-size:12px;margin-top:24px}
@media (prefers-reduced-motion: no-preference){details.tfile{transition:border-color .15s}}
</style></head><body><div class="wrap">
<h1>Lucky Ducky 守卫与测试体检面板</h1>
<div class="metaline"><span>生成 ${esc(meta.generatedAt || '')}</span><span>HEAD <code>${esc(meta.head || '?')}</code>（${esc(meta.branch || '?')}）</span>${meta.dirty ? `<span>工作区 ${meta.dirty} 处未提交改动</span>` : '<span>工作区干净</span>'}<span>总耗时 ${fmtMs(meta.durationMs || 0)}</span>${meta.fast ? '<span class="badtxt">--fast 模式（typecheck/lint 未跑）</span>' : ''}</div>

<div class="tiles">
${tile('守卫', `${guards.length - redGuards.length - skipGuards.length}<span class="meta">/${guards.length}</span>`, redGuards.length ? `${redGuards.length} 条红` : skipGuards.length ? `${skipGuards.length} 条未跑` : '全绿', redGuards.length > 0)}
${tile('测试', `${tests.filter((t) => t.ok).length}<span class="meta">/${tests.length}</span>`, redTests.length ? `${redTests.length} 条红${skippedTests.length ? `·${skippedTests.length} 跳过` : ''}` : skippedTests.length ? `${skippedTests.length} 条跳过` : '全绿', redTests.length > 0)}
${tile('typecheck', tc.length ? `${tc.filter((x) => x.ok).length}<span class="meta">/${tc.length}</span>` : '—', tc.length ? (tc.every((x) => x.ok) ? '六包全过' : '有包未过') : '本次未跑', tc.some((x) => !x.ok))}
${tile('lint', lint ? (lint.ok ? '0 错' : `${lint.errors} 错`) : '—', lint ? `${lint.warnings} 条 warning` : '本次未跑', lint ? !lint.ok : false)}
</div>

<section class="card"><h2>红灯区（失败置顶·带复跑命令）</h2>${redZone}</section>

<section class="card"><h2>病根覆盖地图（根因账本 §一 同源·13 条病根每条几道网）</h2>
<table><thead><tr><th>病根</th><th>名称</th><th style="text-align:right">守卫数</th><th style="text-align:right">红</th><th>守卫</th></tr></thead>
<tbody>${roots.numbered.map(rootRow).join('\n')}</tbody></table>
<h3>主张/标签类（T1–T4·铁律·正册·基建·多端…）</h3>
<table><tbody>${roots.labels.map(rootRow).join('\n')}</tbody></table></section>

<section class="card"><h2>守卫册（${guards.length} 条·四注册表机器派生）</h2>
<div class="controls"><input type="search" id="gq" placeholder="搜守卫：id / 病根 / 说明…" aria-label="搜索守卫">
<button class="fbtn on" data-gf="all">全部</button><button class="fbtn" data-gf="bad">仅红</button><button class="fbtn" data-gf="rw">rw- 新线</button><button class="fbtn" data-gf="repo">仓级</button><button class="fbtn" data-gf="file">逐文件</button><button class="fbtn" data-gf="convention">约定</button><button class="fbtn" data-gf="ts">类型</button><button class="fbtn" data-gf="test">行为测试</button></div>
<table><thead><tr><th></th><th>id</th><th>类型</th><th>治什么</th><th>说明</th><th style="text-align:right">耗时</th></tr></thead>
<tbody id="gbody">${guardRows}</tbody></table></section>

<section class="card"><h2>测试册（${tests.length} 条·按项目 → 文件分组·失败文件默认展开）</h2>
<div class="controls"><input type="search" id="tq" placeholder="搜测试：文件 / 用例名…" aria-label="搜索测试">
<label class="fbtn" style="cursor:pointer"><input type="checkbox" id="tonly" style="vertical-align:-2px"> 只看失败</label></div>
${testSections}</section>

<section class="card help"><h2>怎么单独增加针对性测试（落文件即入册·无需登记面板）</h2>
<ul>
<li><b>新线行为测试</b>：在 <code>rewrite/&lt;包&gt;/tests/xxx.test.ts</code> 落一个 vitest 文件（旧线/脚本域放 <code>tests/&lt;域&gt;/xxx.test.js</code>）——vitest 项目自动发现，下次 <code>npm run report</code> 自动出现在本面板。</li>
<li><b>单独跑</b>：<code>npx vitest run 文件路径</code>；只跑一条用例加 <code>-t "用例名"</code>（红灯卡片里已带好命令，点选即可复制）。</li>
<li><b>升格为守卫</b>（纳入病根覆盖核算）：在 <code>scripts/check-structure.mjs</code> 的 <code>typeAndTestGuards</code> 注册 <code>{ id, mechanism:'test', roots:['#病根'], reverseTest:'测试文件路径' }</code>——guard-coverage / provenance 元守卫自动纳管。</li>
<li><b>结构守卫</b>：<code>repoChecks</code>（仓级断言）或 <code>fileRules</code>（逐文件规则）加条目并标 <code>roots</code>；本面板是注册表的派生视图，加完即自动入册。</li>
<li><b>面板只呈现不拦截</b>：质量闸仍是 <code>npm run check</code>（pre-commit / CI 同源）；本面板用于「单独查看谁红了、每条病根有几道网」。</li>
</ul></section>

<footer>面板=守卫注册表+vitest 实跑的机器派生视图（守卫 check-report-in-gates / check-report-derived）·手抄清单迟早漂移，派生不会。</footer>
</div>
<script>
(function(){
  var state={chip:'all',q:''};
  var gq=document.getElementById('gq'),gbody=document.getElementById('gbody');
  function applyG(){
    if(!gbody)return;
    var rows=gbody.querySelectorAll('tr.grow');
    for(var i=0;i<rows.length;i++){
      var r=rows[i],show=true;
      if(state.q&&r.getAttribute('data-hay').indexOf(state.q)<0)show=false;
      if(state.chip==='bad'&&r.getAttribute('data-ok')!=='0')show=false;
      else if(state.chip==='rw'&&r.getAttribute('data-rw')!=='1')show=false;
      else if(['repo','file','convention','ts','test'].indexOf(state.chip)>=0&&r.getAttribute('data-kind')!==state.chip)show=false;
      r.style.display=show?'':'none';
    }
  }
  if(gq)gq.addEventListener('input',function(){state.q=gq.value.trim().toLowerCase();applyG();});
  var btns=document.querySelectorAll('[data-gf]');
  for(var j=0;j<btns.length;j++)btns[j].addEventListener('click',function(){
    for(var k=0;k<btns.length;k++)btns[k].classList.remove('on');
    this.classList.add('on');state.chip=this.getAttribute('data-gf');applyG();
  });
  var tq=document.getElementById('tq'),tonly=document.getElementById('tonly');
  function applyT(){
    var q=tq?tq.value.trim().toLowerCase():'',only=tonly&&tonly.checked;
    var files=document.querySelectorAll('details.tfile');
    for(var i=0;i<files.length;i++){
      var f=files[i],rows=f.querySelectorAll('tr.trow'),any=false;
      for(var r=0;r<rows.length;r++){
        var row=rows[r],show=true;
        if(q&&row.getAttribute('data-hay').indexOf(q)<0&&f.getAttribute('data-hay').indexOf(q)<0)show=false;
        if(only&&row.getAttribute('data-ok')!=='0')show=false;
        row.style.display=show?'':'none';if(show)any=true;
      }
      f.style.display=(q||only)?(any?'':'none'):'';
      if((q||only)&&any)f.open=true;
    }
  }
  if(tq)tq.addEventListener('input',applyT);
  if(tonly)tonly.addEventListener('change',applyT);
})();
</script>
</body></html>`
}

// ============ 主流程 ============

async function main() {
  const fast = process.argv.includes('--fast')
  const t0 = Date.now()
  mkdirSync(OUT_DIR, { recursive: true })

  console.log('① 结构/约定守卫实跑…')
  const ruleGuards = collectRuleGuardResults()

  console.log('② vitest 全量实跑（JSON reporter）…')
  const vt = collectVitest()

  console.log(fast ? '③ typecheck/lint 跳过（--fast）' : '③ typecheck 六包逐段…')
  const tc = fast ? [] : collectTypecheck()
  const lint = fast ? null : (console.log('④ eslint…'), collectLint())

  // ts/test 型守卫状态：ts 随 typecheck 闸；test 型 = reverseTest 文件的 vitest 实跑结果
  const byFile = new Map()
  for (const t of vt.tests) {
    if (!byFile.has(t.file)) byFile.set(t.file, [])
    byFile.get(t.file).push(t)
  }
  const tcAllOk = tc.length ? tc.every((x) => x.ok) : null
  const derived = typeAndTestGuards.map((g) => {
    if (g.mechanism === 'ts') {
      return { id: g.id, kind: 'ts', roots: g.roots || [], desc: g.reverseTest || '', ok: tcAllOk, ms: null, violations: tcAllOk === false ? [{ msg: 'typecheck 未过（见红灯区 typecheck 卡片）' }] : [] }
    }
    const rows = byFile.get(g.reverseTest) || []
    const exists = existsSync(join(ROOT, g.reverseTest))
    const red = rows.filter((t) => !t.ok && !t.skipped)
    const ok = exists && rows.length > 0 && red.length === 0
    const violations = !exists
      ? [{ msg: `reverseTest 文件不存在：${g.reverseTest}` }]
      : rows.length === 0
        ? [{ msg: `reverseTest 未被 vitest 跑到：${g.reverseTest}` }]
        : red.map((t) => ({ msg: `${t.name} —— ${String(t.error || '').slice(0, 200)}` }))
    return { id: g.id, kind: 'test', roots: g.roots || [], desc: `行为测试守卫 → ${g.reverseTest}（${rows.length} 条用例）`, ok, ms: rows.reduce((s, t) => s + (t.ms || 0), 0), violations }
  })

  const guards = [...ruleGuards, ...derived]
  const meta = {
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    head: sh('git rev-parse --short HEAD').out.trim(),
    branch: sh('git rev-parse --abbrev-ref HEAD').out.trim(),
    dirty: sh('git status --short').out.split('\n').filter(Boolean).length,
    durationMs: Date.now() - t0,
    fast,
  }
  const data = { meta, guards, tests: vt.tests, gates: { typecheck: tc, lint, vitest: { ok: vt.ok, ms: vt.ms } }, ledger: parseRootLedger() }

  const htmlPath = join(OUT_DIR, 'check-report.html')
  writeFileSync(htmlPath, renderHtml(data))
  writeFileSync(
    join(OUT_DIR, 'check-report.json'),
    JSON.stringify({ ...data, tests: vt.tests.map(({ error, ...t }) => ({ ...t, error: error?.slice(0, 400) })) }, null, 1)
  )

  const redG = guards.filter((g) => g.ok === false).length
  const redT = vt.tests.filter((t) => !t.ok && !t.skipped).length
  console.log(`\n体检面板已生成：${relative(ROOT, htmlPath)}（浏览器直开）`)
  console.log(`守卫 ${guards.length - redG}/${guards.length} 绿${redG ? `（${redG} 红）` : ''}·测试 ${vt.tests.filter((t) => t.ok).length}/${vt.tests.length} 绿${redT ? `（${redT} 红）` : ''}·耗时 ${fmtMs(meta.durationMs)}`)
  // 面板只呈现不拦截：恒 exit 0（质量闸是 npm run check）
}

const isMain = resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
if (isMain) main()
