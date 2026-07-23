// 瘦身扫描（病根17「持续义务有传感器」·瘦身大作战 2026-07-23）：死导出/幽灵依赖/规模棘轮的纯逻辑核。
// 「靠人记住哪个导出没人用了/哪个依赖其实没声明」迟早漂移——本模块把判定做成可测的纯函数，
// 供 rw-dead-exports / rw-phantom-deps / rw-loc-budget / rw-lock-budget 等守卫复用，基线单源
// scripts/slim-baseline.json（守卫侧维护，本模块只提供判定，不读该文件）。
// IO 收集层（collectImportSpecifiers/countLoc）薄封装真实文件系统，不进单测断言——
// 单测只喂字符串固件锁纯逻辑（tests/scripts/slimScan.test.js），IO 层的正确性靠守卫跑起来时的真实产物验。
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

// 逐行匹配 TS 顶层导出声明的正则：export [async] const|function|type|interface|class Name
// 只认本仓 shared 会写的六种形态，不处理 `export {...}` 聚合再导出（本仓 shared 不用这种形态）。
const EXPORT_RE = /^\s*export\s+(?:async\s+)?(?:const|function|type|interface|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/

// 逐行扫描，跳过注释行（行首 // 或 *，含 JSDoc 续行），返回 [{name, lineIndex}]（含行号供内部消费判定用）。
function parseExportsDetailed(srcText) {
  const found = []
  const lines = srcText.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    const m = EXPORT_RE.exec(lines[i])
    if (m) found.push({ name: m[1], lineIndex: i })
  }
  return found
}

// 从 TS 源文本提取导出符号名（供守卫/调用方直接列举一个文件导出了什么）。
export function parseExports(srcText) {
  return parseExportsDetailed(srcText).map((e) => e.name)
}

// 死导出判定：符号名在「消费面全文」（cloud/admin/agent 源、各包 tests、check-structure.mjs 等守卫
// 文本——本仓铁律：守卫文本级引用也算消费）里零出现，且在 shared 包内部（除定义行自身、除 index.ts
// 的 `export * from` 整包再导出行）也零出现（同包内部使用算活），才判死。
// files：shared 源文件 [{path, text}]；consumerTexts：消费面全文 [{path, text}]。
export function findDeadExports({ files, consumerTexts }) {
  const dead = []
  const consumerBlob = (consumerTexts || []).map((c) => c.text).join('\n')

  for (const file of files) {
    for (const { name, lineIndex } of parseExportsDetailed(file.text)) {
      const wordRe = new RegExp(`\\b${name}\\b`)
      if (wordRe.test(consumerBlob)) continue // 消费面用到→活

      let usedInternally = false
      for (const other of files) {
        const isIndexReExport = /(^|\/)index\.ts$/.test(other.path)
        const lines = other.text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (other.path === file.path && i === lineIndex) continue // 跳过定义行本身
          if (isIndexReExport && /^\s*export\s+\*\s+from\b/.test(lines[i])) continue // 跳过整包再导出行
          if (wordRe.test(lines[i])) {
            usedInternally = true
            break
          }
        }
        if (usedInternally) break
      }
      if (!usedInternally) dead.push({ file: file.path, name })
    }
  }
  return dead
}

// import 说明符取顶层包名；内置模块（node:*）与相对路径（./ 或 ../）返回 null；
// 作用域包（@scope/pkg/sub）取前两段；普通包（pkg/sub 或裸 pkg）取第一段。
export function topLevelPkgName(specifier) {
  if (!specifier) return null
  if (specifier.startsWith('node:')) return null
  if (specifier.startsWith('.')) return null
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  const idx = specifier.indexOf('/')
  return idx === -1 ? specifier : specifier.slice(0, idx)
}

// 幽灵依赖判定：说明符解出的顶层包名不在「已声明包名合集」（各 package.json 的 deps+devDeps 键）
// 里、且不是 workspace 内别名 @ldrw/shared，即记一条幽灵依赖（只留首见位置，去重）。
// sourceImports：[{path, specifiers}]；declared：Set(已声明包名)。
export function findPhantomDeps({ sourceImports, declared }) {
  const firstSeenAt = new Map()
  for (const { path, specifiers } of sourceImports) {
    for (const spec of specifiers) {
      const pkg = topLevelPkgName(spec)
      if (!pkg) continue
      if (pkg === '@ldrw/shared') continue
      if (declared.has(pkg)) continue
      if (!firstSeenAt.has(pkg)) firstSeenAt.set(pkg, path)
    }
  }
  return [...firstSeenAt.entries()].map(([pkg, path]) => `${pkg}（首见于 ${path}）`)
}

// 规模棘轮判定（病根17）：涨超预算（current > baseline*growCap）＝膨胀须显式记账；
// 瘦身后基线虚高（baseline > current*slackCap）＝成果锁死不回弹，两头都算违例、互不排斥。
export function checkBudget({ label, current, baseline, growCap = 1.05, slackCap = 1.1 }) {
  const violations = []
  if (current > baseline * growCap) {
    violations.push(`${label} 膨胀 ${baseline}→${current} 超预算——瘦身或显式上调基线并记账`)
  }
  if (baseline > current * slackCap) {
    violations.push(`${label} 基线虚高 ${baseline} vs 现值 ${current}——下调基线锁住瘦身成果（防回弹）`)
  }
  return violations
}

const SCAN_EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.claude'])

// 递归遍历 dir，对每个非排除目录下的文件调用 onFile(fullPath)；目录不存在时静默跳过。
function walk(dir, onFile) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SCAN_EXCLUDE_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, onFile)
    } else if (entry.isFile()) {
      onFile(full)
    }
  }
}

const IMPORT_EXTS = new Set(['.ts', '.vue', '.mjs', '.cjs', '.js'])

// 薄 IO 收集层：递归 dir 下 .ts/.vue/.mjs/.cjs/.js，抓每文件的 `from '...'`/`require('...')`/
// `import('...')` 说明符，供 findPhantomDeps 消费。返回 [{path, specifiers}]（无说明符的文件不进结果）。
export function collectImportSpecifiers(dir) {
  const results = []
  walk(dir, (file) => {
    if (!IMPORT_EXTS.has(extname(file))) return
    const text = readFileSync(file, 'utf8')
    const specifiers = new Set()
    let m
    const fromRe = /from\s+['"]([^'"]+)['"]/g
    while ((m = fromRe.exec(text))) specifiers.add(m[1])
    const reqRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((m = reqRe.exec(text))) specifiers.add(m[1])
    const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((m = dynRe.exec(text))) specifiers.add(m[1])
    if (specifiers.size > 0) results.push({ path: file, specifiers: [...specifiers] })
  })
  return results
}

// 薄 IO 收集层：递归 dir 下指定扩展名文件的总行数，供 checkBudget 的 current 参数用。
export function countLoc(dir, exts) {
  const extSet = new Set(exts)
  let total = 0
  walk(dir, (file) => {
    if (!extSet.has(extname(file))) return
    const text = readFileSync(file, 'utf8')
    total += text.split('\n').length
  })
  return total
}
