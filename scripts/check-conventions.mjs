#!/usr/bin/env node
/**
 * 约定检查（CLAUDE.md §5 多端约束 / §8 样式规则中 ESLint 管不到的几条）。
 *
 * 用法：
 *   node scripts/check-conventions.mjs            # 全量检查 src 下 .vue/.scss
 *   node scripts/check-conventions.mjs <文件...>  # 只检查指定文件
 *   node scripts/check-conventions.mjs --hook     # Claude Code PostToolUse 模式：
 *                                                 #   从 stdin 读 hook JSON，取编辑的文件检查，
 *                                                 #   违例 exit 2（stderr 会反馈给 Claude 立即修正）
 *
 * 规则：
 *   1. rpx 单位（项目统一 px，决策 §14）
 *   2. 写死主题色——hex 与 src/uni.scss 色票相同才算（中性色另记技术债 #11，不在此拦）
 *   3. 内联 <svg>（小程序端不支持，用 <image> 引 static/icons）
 *   4. <button>（交互用 <view>+@tap；微信能力按钮 open-type=... 例外）
 *   5. backdrop-filter / color-mix()（兼容性差）
 *   6. background-image: url(本地)（本地图用 <image>；http(s)/data: 放行）
 *
 * 刻意例外：在违例行或其上一行写注释含 `convention-ok` 即豁免（同 eslint-disable 思路）。
 * 注释行（//、*、/*、<!--）不检查，避免「提到规则」被误伤。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const SRC = join(ROOT, 'packages', 'miniapp', 'src')
const UNI_SCSS = join(SRC, 'uni.scss')

// ---- 色票：运行时从 uni.scss 读，保持单一来源 ----
function normalizeHex(hex) {
  let h = hex.toLowerCase()
  // #abc → #aabbcc、#abcd → #aabbccdd，统一成长形再比对
  if (h.length === 4 || h.length === 5) {
    h = '#' + [...h.slice(1)].map((c) => c + c).join('')
  }
  return h
}
const TOKEN_COLORS = new Set(
  (readFileSync(UNI_SCSS, 'utf8').match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(normalizeHex)
)
// 纯黑白是中性色不是品牌色（沉浸页黑底等场景语义上不宜映射 $ink-pure/$white），
// 不在此拦——中性色收口已记技术债 #11
TOKEN_COLORS.delete('#ffffff')
TOKEN_COLORS.delete('#000000')

// ---- 规则表：test 返回违例说明（null = 通过） ----
// roots：本规则守的不变量来源（均守 CLAUDE §5 多端硬约束，标 '多端'）——
// 机读 provenance，与 check-structure 同一约定（见 docs/元模式.md A3）。
export const RULES = [
  {
    id: 'rpx',
    roots: ['多端'],
    test(line) {
      return /(?<![\w$#])\d+(\.\d+)?rpx\b/.test(line) ? '用 px，不用 rpx（CLAUDE.md §8）' : null
    },
  },
  {
    id: 'theme-hex',
    roots: ['多端'],
    test(line) {
      const hits = (line.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((h) =>
        TOKEN_COLORS.has(normalizeHex(h))
      )
      return hits.length
        ? `写死主题色 ${hits.join(' ')}，请用 src/uni.scss 对应变量（CLAUDE.md §8）`
        : null
    },
  },
  {
    id: 'inline-svg',
    roots: ['多端'],
    test(line) {
      return /<svg\b/.test(line)
        ? '小程序端不支持内联 <svg>，用 <image> 引 static/icons/*.svg（CLAUDE.md §5）'
        : null
    },
  },
  {
    id: 'button',
    roots: ['多端'],
    test(line) {
      return /<button\b/.test(line) && !/open-type\s*=/.test(line)
        ? '交互元素用 <view> + @tap，不用 <button>；微信能力按钮（open-type）例外（CLAUDE.md §5）'
        : null
    },
  },
  {
    id: 'css-compat',
    roots: ['多端'],
    test(line) {
      return /backdrop-filter\s*:|color-mix\s*\(/.test(line)
        ? 'backdrop-filter / color-mix() 多端兼容性差，避免使用（CLAUDE.md §5）'
        : null
    },
  },
  {
    id: 'bg-image-local',
    roots: ['多端'],
    test(line) {
      const m = line.match(/background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)/)
      return m && !/^(https?:\/\/|data:)/.test(m[1])
        ? '不用 background-image 引本地图片，本地图用 <image>（CLAUDE.md §5）'
        : null
    },
  },
  {
    // 文件级规则：本文件含 <scroll-view> 才拦（ctx.hasScrollView）——mp-weixin 中 scroll-view
    // 内的 CSS position:sticky 不生效（H5/浏览器 overflow 容器内支持 → 假绿），顶栏会随内容滚走。
    // 仓内约定：品牌顶栏随内容流（home Hero / me ProfileHeader 均如此，未在 scroll-view 内 sticky）。
    id: 'sticky-in-scroll-view',
    roots: ['多端'],
    test(line, ctx) {
      return ctx?.hasScrollView && /position\s*:\s*sticky\b/.test(line)
        ? 'scroll-view 内 position:sticky 在 mp-weixin 不吸顶（H5 假绿）；改页面级固定头或随内容流（参 home/me 顶栏）（CLAUDE.md §5·根因#8）'
        : null
    },
  },
  {
    // 全屏遮罩（class 含 *-mask / *-backdrop，仓内命名＝position:fixed/absolute;inset:0 的暗层）须锁背景
    // 滚动：mp-weixin 中 fixed/absolute mask 上 touchmove 会透传滚动背景页（H5/构建看不出·根因#8）。
    // 遮罩根 <view> 须带 catchtouchmove（uni：@touchmove.stop → catch 绑定）。开标签单行写、class 与锁同行。
    id: 'overlay-scroll-lock',
    test(line) {
      const isMask = /<view\b[^>]*\bclass="[^"]*\b[\w]+-(?:mask|backdrop)\b/.test(line)
      return isMask && !/catchtouchmove|@touchmove|catch-touch-move/.test(line)
        ? '全屏遮罩须锁背景滚动：根 <view> 加 @touchmove.stop.prevent（catchtouchmove）——否则 mp-weixin touchmove 透传滚背景页（H5 假绿）（CLAUDE.md §5·根因#8）'
        : null
    },
    roots: ['多端'],
  },
  {
    // 微信自定义组件 wxss 禁标签选择器（2026-07-02 me 页 devtools 逮出·根因#8「页面合法组件不合法」）：
    // 页面 wxss 里 `text {}` 合法，但组件（路径含 /components/ 的 .vue）编译成自定义组件后，
    // `.cls text` 这类标签选择器被微信判「Some selectors are not allowed in component wxss」——真机可能
    // 静默不生效。给节点加 class 再选；页面文件不拦（合法）。
    id: 'tag-selector-in-component',
    roots: ['多端'],
    test(line, ctx) {
      if (!ctx?.file || !/\/components\//.test(ctx.file) || !ctx.file.endsWith('.vue')) return null
      return /(^|[\s,>+~])(view|text|image|button|input|textarea|label|form|navigator|swiper|swiper-item|scroll-view|cover-view|rich-text)(::?[a-z-]+(\([^)]*\))?)*\s*\{/.test(
        line
      )
        ? '组件（/components/ 下 .vue）样式禁标签选择器（view/text/image…）——mp 自定义组件 wxss 不允许·真机可能静默不生效；给节点加 class 再选（页面文件里合法）（根因#8）'
        : null
    },
  },
]

const isCommentLine = (line) => /^(\/\/|\/\*|\*|<!--)/.test(line.trim())

// export：供 check-report 体检面板复用同一套遍历/判定（面板=派生视图，禁自建第二套语义）
export function checkFile(file) {
  const violations = []
  const content = readFileSync(file, 'utf8')
  const lines = content.split('\n')
  // 文件级上下文（一次算好，传给需要跨行判断的规则，如 sticky-in-scroll-view）
  const ctx = { file, lines, hasScrollView: /<scroll-view\b/.test(content) }
  lines.forEach((line, i) => {
    if (isCommentLine(line)) return
    if (line.includes('convention-ok') || (i > 0 && lines[i - 1].includes('convention-ok'))) return
    for (const rule of RULES) {
      const msg = rule.test(line, { ...ctx, i })
      if (msg) {
        violations.push({
          id: rule.id,
          loc: `${relative(ROOT, file)}:${i + 1}`,
          msg,
          src: line.trim().slice(0, 80),
        })
      }
    }
  })
  return violations
}

// 范围：src/ 下 .vue/.scss，uni.scss 本身除外（色票定义地）
function inScope(file) {
  const abs = resolve(file)
  return (
    abs.startsWith(SRC + '/') && /\.(vue|scss)$/.test(abs) && abs !== UNI_SCSS && existsSync(abs)
  )
}

export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (inScope(p)) yield p
  }
}
export { SRC as CONVENTION_SRC }

function report(violations, stream) {
  for (const v of violations) stream.write(`${v.loc}\n  ✗ ${v.msg}\n  → ${v.src}\n`)
  stream.write(`\n约定检查未通过：${violations.length} 处违例（刻意例外可在该行注释加 convention-ok）\n`)
}

// CLI 入口包进 main()，只在被 node 直接运行时执行——这样测试可 import RULES
// 而不触发全量检查（isMain 守门，与 check-structure 同一约定）。
async function main() {
  const args = process.argv.slice(2)

  if (args[0] === '--hook') {
    // Claude Code PostToolUse：stdin 是 hook JSON，违例 exit 2 让 stderr 反馈给 Claude
    let stdin = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) stdin += chunk
    let file
    try {
      file = JSON.parse(stdin)?.tool_input?.file_path
    } catch {
      process.exit(0) // 解析不了就放行，hook 不应阻塞正常编辑
    }
    if (!file || !inScope(file)) process.exit(0)
    const violations = checkFile(resolve(file))
    if (violations.length) {
      report(violations, process.stderr)
      process.exit(2)
    }
    process.exit(0)
  }

  const files = args.length ? args.filter(inScope).map((f) => resolve(f)) : [...walk(SRC)]
  if (args.length && !files.length) {
    console.log('（指定文件均不在检查范围：src/ 下 .vue/.scss）')
    process.exit(0)
  }
  const violations = files.flatMap(checkFile)
  if (violations.length) {
    report(violations, process.stdout)
    process.exit(1)
  }
  console.log(`✅ 约定检查通过（${files.length} 个文件，${RULES.length} 条规则）`)
}

const isMain = resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
if (isMain) main()
