// 品牌字体分层字符集推导单源（字体分层批）：tier1(tab首屏) / tier2(二级页+云端文案) / tier3(GB2312一级兜底)。
// 谁在用：scripts/build-brand-font.mjs（子集构建）+ check-structure.mjs 守卫 rw-mp-font-tier-subset-covers
// （盯「上屏字 ⊆ 已提交子集」防新增文案静默掉回退）。分层归属只此一处权威，两端不各写各的（病根#5）。
//
// 分层口径（工作流实测定档·2026-07-16）：
//   tier1 = tab 页(home/cart/me)四件套闭包 ∪ custom-tab-bar ∪ brand-splash ∪ app.ts import 闭包
//           ∪ app.json 值(tabBar text/导航标题) ∪ seed 标题类字段(首页卡片渲染的商品/课程名)
//           + ASCII + 常用中文标点（只进 tier1，后层不重复）
//   tier2 = 其余页闭包 + mp 未被闭包触达的散文件 + seed 其余 + rewrite/{shared,cloud/src} 字面量 − tier1
//           + 高频 GBK 二级补字（圳：收货地址「深圳」几乎必现、GB2312 一级不含、源 OTF 有字形）
//   tier3 = GB2312 一级(3755) − tier1 − tier2（UGC 昵称/评价/地址兜底·最后空闲加载）
// 抽取口径：wxml 剥注释全量 CJK；json 只取 value；ts/js 只取字符串字面量（剥注释——注释字不上屏，
// 混进来虚胖 3 倍）；wxss 不抽（无上屏文案）；tests/typings 排除。

import fs from 'node:fs'
import path from 'node:path'

const isCJK = (cp) => cp >= 0x4e00 && cp <= 0x9fff
const cjkOf = (text, into) => {
  for (const ch of text) if (isCJK(ch.codePointAt(0))) into.add(ch)
}

export const ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('')
export const CJK_PUNCT = '，。、；：？！“”‘’（）《》〈〉【】「」『』—…·～￥％°№'
// 高频 GBK 二级补字（GB2312 一级之外、真实 UGC 高频、源 OTF 有字形）：现仅「圳」（深圳收货地址）。
// 加字条件从严：确有真实上屏场景才补，不为「万一」囤字（§7 防过度工程）。
export const GBK2_EXTRA = '圳'

// ---------- ts/js 字符串字面量抽取（跳过注释；' " ` 三种；模板字面量跳 ${…}） ----------
function extractStringLiterals(src) {
  const out = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++ // 行注释
    } else if (c === '/' && c2 === '*') {
      i += 2 // 块注释
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
    } else if (c === "'" || c === '"') {
      const q = c
      i++
      let buf = ''
      let ok = false
      while (i < n) {
        if (src[i] === '\\') {
          buf += src[i + 1] ?? ''
          i += 2
        } else if (src[i] === q) {
          ok = true
          i++
          break
        } else if (src[i] === '\n') {
          break // 未闭合当误判丢弃（如正则里的引号）
        } else {
          buf += src[i]
          i++
        }
      }
      if (ok) out.push(buf)
    } else if (c === '`') {
      i++
      let buf = ''
      while (i < n) {
        if (src[i] === '\\') {
          buf += src[i + 1] ?? ''
          i += 2
        } else if (src[i] === '`') {
          i++
          break
        } else if (src[i] === '$' && src[i + 1] === '{') {
          i += 2
          let depth = 1
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') depth--
            i++
          }
        } else {
          buf += src[i]
          i++
        }
      }
      out.push(buf)
    } else {
      i++
    }
  }
  return out
}

// ---------- 按文件类型抽 CJK ----------
function extractFileCJK(file, into) {
  if (!fs.existsSync(file)) return
  const src = fs.readFileSync(file, 'utf8')
  const ext = path.extname(file)
  if (ext === '.wxml') {
    cjkOf(src.replace(/<!--[\s\S]*?-->/g, ''), into) // 剥注释后全量 CJK
  } else if (ext === '.json') {
    try {
      const walk = (v) => {
        if (typeof v === 'string') cjkOf(v, into)
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.values(v).forEach(walk)
      }
      walk(JSON.parse(src))
    } catch {
      /* 非法 json 忽略 */
    }
  } else if (ext === '.ts' || ext === '.js') {
    for (const s of extractStringLiterals(src)) cjkOf(s, into)
  }
  // .wxss 不抽：样式表无上屏文案，CJK 只在注释里（虚胖源）
}

// ---------- 页面/组件闭包（json usingComponents 递归 + ts import 递归） ----------
function resolveComponent(mpRoot, fromJsonDir, ref) {
  if (ref.startsWith('plugin://') || ref.startsWith('weui-miniprogram')) return null
  return ref.startsWith('/') ? path.join(mpRoot, ref.slice(1)) : path.resolve(fromJsonDir, ref)
}

function resolveImport(fromTsDir, spec) {
  if (!spec.startsWith('.')) return null // 非相对导入（mp 无包依赖）
  const p = path.resolve(fromTsDir, spec)
  for (const cand of [p + '.ts', p + '.js', path.join(p, 'index.ts'), path.join(p, 'index.js'), p]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
  }
  return null
}

function collectTsImports(repoRoot, tsFile, files, seen) {
  const key = 'ts:' + tsFile
  if (seen.has(key)) return
  seen.add(key)
  files.add(tsFile)
  const src = fs.readFileSync(tsFile, 'utf8')
  const re = /(?:import|export)[^'"\n;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2]
    const resolved = resolveImport(path.dirname(tsFile), spec)
    if (resolved && resolved.startsWith(repoRoot)) collectTsImports(repoRoot, resolved, files, seen)
  }
}

// 收集一个 base（页面或组件，不带扩展名）的文件域：四件套 + 组件递归 + ts import 递归
function collectClosure(repoRoot, mpRoot, base, files, seen) {
  if (seen.has(base)) return
  seen.add(base)
  for (const ext of ['.wxml', '.json', '.ts', '.js']) {
    const f = base + ext
    if (fs.existsSync(f)) files.add(f)
  }
  const jsonFile = base + '.json'
  if (fs.existsSync(jsonFile)) {
    try {
      const conf = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
      for (const ref of Object.values(conf.usingComponents || {})) {
        const compBase = resolveComponent(mpRoot, path.dirname(jsonFile), ref)
        if (compBase) collectClosure(repoRoot, mpRoot, compBase, files, seen)
      }
    } catch {
      /* ignore */
    }
  }
  // ts import 闭包：页面渲染的兜底文案住在 lib/map*.ts 字面量里（如首页 223 字在 mapHome），必须跟进
  for (const ext of ['.ts', '.js']) {
    const tsFile = base + ext
    if (fs.existsSync(tsFile)) collectTsImports(repoRoot, tsFile, files, seen)
  }
}

function gb2312Level1() {
  const dec = new TextDecoder('gbk')
  const set = new Set()
  for (let hi = 0xb0; hi <= 0xd7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = dec.decode(Uint8Array.from([hi, lo]))
      if (ch.length === 1 && ch >= '一' && ch <= '鿿') set.add(ch)
    }
  }
  return set
}

/**
 * 推导三层字符集。返回 { tier1, tier2, tier3 }（均为 Set<单字>·仅 CJK；ASCII/标点由调用方按
 * 「只进 tier1」拼装——见 build-brand-font.mjs）。
 */
export function deriveTierCharsets(repoRoot) {
  const MP = path.join(repoRoot, 'rewrite/mp')
  const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'))
  const allPages = appJson.pages
  const tabPages = new Set((appJson.tabBar?.list || []).map((x) => x.pagePath))

  // tier1 文件域：tab 页闭包 ∪ custom-tab-bar ∪ brand-splash（首页冷启动必现）∪ app.ts 闭包
  const t1files = new Set()
  const t1seen = new Set()
  for (const p of allPages) if (tabPages.has(p)) collectClosure(repoRoot, MP, path.join(MP, p), t1files, t1seen)
  collectClosure(repoRoot, MP, path.join(MP, 'custom-tab-bar/index'), t1files, t1seen)
  collectClosure(repoRoot, MP, path.join(MP, 'components/brand-splash/brand-splash'), t1files, t1seen)
  collectTsImports(repoRoot, path.join(MP, 'app.ts'), t1files, t1seen)

  const tier1 = new Set()
  for (const f of t1files) extractFileCJK(f, tier1)
  extractFileCJK(path.join(MP, 'app.json'), tier1) // tabBar text「首页/购物车/我」+ 导航标题

  // tier1 追加：seed 标题类字段（首页卡片渲染的动态商品/课程标题——已知内容提前进首屏子集）
  const seedDir = path.join(repoRoot, 'rewrite/shared/src/seed')
  const seedAllCjk = new Set()
  if (fs.existsSync(seedDir)) {
    for (const f of fs.readdirSync(seedDir)) {
      const src = fs.readFileSync(path.join(seedDir, f), 'utf8')
      const titleRe = /\b(?:name|tag|title)\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
      let m
      while ((m = titleRe.exec(src))) cjkOf(m[1] ?? m[2], tier1)
      for (const s of extractStringLiterals(src)) cjkOf(s, seedAllCjk) // 其余（如播放页分段名）归 tier2
    }
  }

  // tier2 文件域：其余页闭包（已归 t1 的组件/模块不重复展开——字符层最后再减 tier1）
  const t2files = new Set()
  const t2seen = new Set(t1seen)
  for (const p of allPages) if (!tabPages.has(p)) collectClosure(repoRoot, MP, path.join(MP, p), t2files, t2seen)

  const tier2raw = new Set()
  for (const f of t2files) extractFileCJK(f, tier2raw)

  // mp 内未被任何闭包触达的散文件（防漏：闭包解析不到的动态引用）——tests/typings/配置排除
  {
    const touched = new Set([...t1files, ...t2files])
    const sweep = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f)
        const st = fs.statSync(p)
        if (st.isDirectory()) {
          if (['node_modules', 'tests', 'typings', 'dist'].includes(f) || f.startsWith('.')) continue
          sweep(p)
        } else if (['.wxml', '.json', '.ts', '.js'].includes(path.extname(f)) && !touched.has(p)) {
          if (f.endsWith('.d.ts') || f === 'project.config.json' || f === 'project.private.config.json' || f === 'package.json') continue
          extractFileCJK(p, tier2raw)
        }
      }
    }
    sweep(MP)
  }

  for (const ch of seedAllCjk) tier2raw.add(ch)
  // rewrite/shared 与 rewrite/cloud/src 的字符串字面量（云端报错文案会经 toast 上屏·刻意超收不缺字）
  const sweepTs = (d) => {
    if (!fs.existsSync(d)) return
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      const st = fs.statSync(p)
      if (st.isDirectory()) {
        if (['node_modules', 'dist', 'tests'].includes(f) || f.startsWith('.')) continue
        sweepTs(p)
      } else if (['.ts', '.js'].includes(path.extname(p)) && !p.endsWith('.d.ts') && !p.endsWith('.spec.ts') && !p.endsWith('.test.ts')) {
        for (const s of extractStringLiterals(fs.readFileSync(p, 'utf8'))) cjkOf(s, tier2raw)
      }
    }
  }
  sweepTs(path.join(repoRoot, 'rewrite/shared/src'))
  sweepTs(path.join(repoRoot, 'rewrite/cloud/src'))

  for (const ch of GBK2_EXTRA) tier2raw.add(ch)
  const tier2 = new Set([...tier2raw].filter((c) => !tier1.has(c)))

  const gb1 = gb2312Level1()
  const tier3 = new Set([...gb1].filter((c) => !tier1.has(c) && !tier2.has(c)))

  return { tier1, tier2, tier3 }
}
