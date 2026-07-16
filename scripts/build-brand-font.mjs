#!/usr/bin/env node
/**
 * 品牌字体分层子集构建——把文源圆体（WenYuan Rounded SC，OFL-1.1）按「首屏优先」分三层子集成 WebFont。
 *
 * 为什么分层（字体分层批·2026-07-16 工作流实测定档）：源 OTF 单字重 ~14MB 塞不进 2MB 主包（远程加载
 * 不变）；旧产物「GB2312 一级 3755 字整包」每档 ~965KB、冷启动两档 ~1.9MB 全下完首屏才换字。真实上屏
 * 只 ~890 字，其中 tab 首屏闭包仅 ~430 字——分层后首屏所需从 1.9MB 降到 ~220KB（-88%）：
 *   tier1（每档 ~110KB）= tab 页闭包+custom-tab-bar+brand-splash+app 闭包+seed 商品/课程标题+ASCII+标点
 *   tier2（每档 ~111KB）= 其余 20 页闭包+云端可上屏文案+高频补字（圳）
 *   tier3（每档 ~765KB）= GB2312 一级剩余（UGC 昵称/评价/地址兜底·空闲加载）
 * 分层归属单源 scripts/lib/brand-font-charset.mjs（守卫 rw-mp-font-tier-subset-covers 同源盯漂移）。
 * 加载侧三层字族回退栈+持久缓存见 rewrite/mp/utils/brandFont.ts。
 *
 * ⚠ 用 woff 不用 woff2：wx.loadFontFace 官方建议格式仅 TTF/WOFF，woff2 真机静默失败（根因#8·2026-06-29
 *   真机逮出·开发者工具浏览器内核能渲染=假绿）。
 * ⚠ 产物落 assets/brand-fonts/，**不进 src**（守卫 font-not-in-package）——wx.loadFontFace 远程托管加载。
 * ⚠ 文件名带版本号（V 常量）：托管 CDN 可放心配长缓存，字符集变更=版本+1=新文件名=天然缓存失效；
 *   rewrite/mp/utils/brandFont.ts 的 URL 与本脚本产物名必须一致（tests/brand-font.test.ts 钉形状）。
 * ⚠ txt 与 woff 永远一起产出（本脚本无「只出 txt」路径）——守卫只读 txt，txt 新 woff 旧=守卫绿但真机
 *   缺字，故禁止手改 txt。
 *
 * 授权：OFL-1.1 WebFont 特例（仅网页端渲染子集化/格式转换、不作可安装桌面字体分发）可保留保留字名，
 * 子集仍叫 WenYuan Rounded SC。授权全文随产物在 assets/brand-fonts/LICENSE。
 *
 * 前置（一次性·非运行时依赖，不入 package.json）：
 *   · Python + fonttools（pip install fonttools brotli）→ 提供 pyftsubset。
 *   · 源 OTF：WenYuanRoundedSC-Medium.otf / -Bold.otf（84MB·不入仓·授权见上）。
 *
 * 用法：
 *   BRAND_FONT_SRC=/path/to/otf-dir [PYFTSUBSET=/path/to/pyftsubset] node scripts/build-brand-font.mjs
 *
 * 文案出现子集外新字（守卫会红并点名）或要加字重/改分层时：改 lib/brand-font-charset.mjs 或本脚本，
 * 重跑、提交新产物（txt+woff 全套）、把 woff 重新部署到托管 /fonts/（README 部署节）。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, statSync, existsSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { deriveTierCharsets, ASCII, CJK_PUNCT } from './lib/brand-font-charset.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'assets/brand-fonts')

// 产物版本（进文件名·CDN 缓存失效靠改名）：字符集/分层口径变更时 +1，并同步 rewrite/mp/utils/brandFont.ts。
const V = 'v2'

// 设计 --font-display 实际只用 Medium(500)/Bold(700) 两档（600 就近落 700、400 就近落 500）。
const WEIGHTS = [
  { src: 'WenYuanRoundedSC-Medium.otf', tag: 'medium', weight: 500 },
  { src: 'WenYuanRoundedSC-Bold.otf', tag: 'bold', weight: 700 },
]

function run() {
  const srcDir = process.env.BRAND_FONT_SRC
  if (!srcDir) {
    console.error('✗ 需设 BRAND_FONT_SRC=源 OTF 目录（含 WenYuanRoundedSC-Medium.otf / -Bold.otf·84MB 不入仓）')
    process.exit(1)
  }
  const pyftsubset = process.env.PYFTSUBSET || 'pyftsubset'

  const { tier1, tier2, tier3 } = deriveTierCharsets(ROOT)
  // ASCII+标点只进 tier1（后层不重复·三层互斥）
  const tiers = [
    { name: 'tier1', text: [...tier1].join('') + ASCII + CJK_PUNCT, cjk: tier1.size },
    { name: 'tier2', text: [...tier2].join(''), cjk: tier2.size },
    { name: 'tier3', text: [...tier3].join(''), cjk: tier3.size },
  ]
  console.log(`分层字符集：tier1=${tier1.size} CJK（+ASCII/标点）· tier2=${tier2.size} · tier3=${tier3.size}（GB2312 一级兜底）`)

  mkdirSync(OUT_DIR, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'ld-font-'))

  for (const t of tiers) {
    // txt 与 woff 同批产出（守卫读 txt·禁止只改 txt 不建 woff）
    writeFileSync(join(OUT_DIR, `${t.name}.txt`), t.text)
    const charsetFile = join(tmp, `${t.name}.txt`)
    writeFileSync(charsetFile, t.text)
    for (const w of WEIGHTS) {
      const srcPath = join(srcDir, w.src)
      if (!existsSync(srcPath)) {
        console.error(`✗ 源字体缺失：${srcPath}`)
        process.exit(1)
      }
      const outName = `wenyuan-${t.name}-${w.tag}.${V}.woff`
      const outPath = join(OUT_DIR, outName)
      execFileSync(
        pyftsubset,
        [
          srcPath,
          `--text-file=${charsetFile}`,
          '--flavor=woff',
          '--layout-features=',
          '--no-hinting',
          '--desubroutinize',
          `--output-file=${outPath}`,
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] }
      )
      const kb = (statSync(outPath).size / 1024).toFixed(0)
      console.log(`  ✓ ${outName}  (weight ${w.weight})  ${kb}KB`)
    }
  }
  console.log(`产物 → ${OUT_DIR}（不进 src·wx.loadFontFace 远程分层加载·守卫 font-not-in-package + rw-mp-font-tier-subset-covers）`)
  console.log('下一步（靠人·控制台）：6 个 woff 传 CloudBase 静态托管 /fonts/ 下（README 部署节·含 CDN 缓存建议）')
}

run()
