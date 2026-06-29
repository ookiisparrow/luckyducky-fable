#!/usr/bin/env node
/**
 * 品牌字体子集构建——把文源圆体（WenYuan Rounded SC，OFL-1.1）按需子集成 WebFont。
 *
 * 为什么：源 OTF 单字重 ~14MB（全量 CJK·覆盖思源黑体级字符集），整套 84MB。小程序主包仅 2MB，
 * 整字重都塞不进。本脚本把字体子集到「GB2312 一级常用字（3755 汉字）+ ASCII + 常用中文标点」、
 * 只取 Medium(500)/Bold(700) 两个 `--font-display` 实际用到的字重，出 woff（M+B 合计 ~1.9MB）。
 * ⚠ 用 woff 不用 woff2：wx.loadFontFace 真机（iOS/安卓）只稳吃 TTF/WOFF，woff2 不在官方支持列表——
 *   开发者工具用浏览器内核能渲染 woff2（假绿），真机用系统渲染不认 → 字体静默失败（根因#8 实例·2026-06-29 真机逮出）。
 * 产物落 assets/brand-fonts/，**不进 src**（见守卫 font-not-in-package）——经 wx.loadFontFace 远程托管加载。
 *
 * 授权：OFL-1.1 的 WebFont 特例允许「仅为网页端渲染子集化/格式转换、且不作为可安装桌面字体提供下载」时
 * 保留保留字名，故子集仍叫 WenYuan Rounded SC。授权全文随产物在 assets/brand-fonts/LICENSE。
 *
 * 前置（一次性·非运行时依赖，不入 package.json）：
 *   · Python + fonttools（pip install fonttools brotli）→ 提供 pyftsubset。
 *   · 源 OTF：WenYuanRoundedSC-Medium.otf / -Bold.otf（84MB·不入仓·授权见上）。
 *
 * 用法：
 *   BRAND_FONT_SRC=/path/to/otf-dir [PYFTSUBSET=/path/to/pyftsubset] node scripts/build-brand-font.mjs
 *
 * 字符集变了（文案出现 GB2312 一级外的字）或要加字重时，改本脚本重跑、提交新 woff、重新部署到托管。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const OUT_DIR = join(ROOT, 'assets/brand-fonts')

// 取本脚本实际用到的字重：Medium=正文标题、Bold=重点标题（设计 --font-display 仅这两档；600 回退 700）。
const WEIGHTS = [
  { src: 'WenYuanRoundedSC-Medium.otf', out: 'wenyuan-rounded-medium.woff', weight: 500 },
  { src: 'WenYuanRoundedSC-Bold.otf', out: 'wenyuan-rounded-bold.woff', weight: 700 },
]

// GB2312 一级常用字（3755 汉字·区位 0xB0–0xD7）——确定性生成，不依赖外部字表文件。
function gb2312Level1() {
  const dec = new TextDecoder('gbk')
  const set = new Set()
  for (let hi = 0xb0; hi <= 0xd7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = dec.decode(Uint8Array.from([hi, lo]))
      if (ch.length === 1 && ch >= '一' && ch <= '鿿') set.add(ch)
    }
  }
  return [...set].join('')
}

function buildCharset() {
  const ascii = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('')
  const cjkPunct = '，。、；：？！“”‘’（）《》〈〉【】「」『』—…·～￥％°№'
  return gb2312Level1() + ascii + cjkPunct
}

function run() {
  const srcDir = process.env.BRAND_FONT_SRC
  if (!srcDir) {
    console.error('✗ 需设 BRAND_FONT_SRC=源 OTF 目录（含 WenYuanRoundedSC-Medium.otf / -Bold.otf·84MB 不入仓）')
    process.exit(1)
  }
  const pyftsubset = process.env.PYFTSUBSET || 'pyftsubset'
  const charset = buildCharset()
  const tmp = mkdtempSync(join(tmpdir(), 'ld-font-'))
  const charsetFile = join(tmp, 'charset.txt')
  writeFileSync(charsetFile, charset)
  mkdirSync(OUT_DIR, { recursive: true })

  const hanzi = [...charset].filter((c) => c >= '一' && c <= '鿿').length
  console.log(`字符集：${hanzi} 汉字（GB2312 一级）+ ASCII + 常用标点 = ${[...charset].length} 字符`)

  for (const w of WEIGHTS) {
    const srcPath = join(srcDir, w.src)
    if (!existsSync(srcPath)) {
      console.error(`✗ 源字体缺失：${srcPath}`)
      process.exit(1)
    }
    const outPath = join(OUT_DIR, w.out)
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
    console.log(`  ✓ ${w.out}  (weight ${w.weight})  ${kb}KB`)
  }
  console.log(`产物 → ${OUT_DIR}（不进 src·走 wx.loadFontFace 远程加载·见守卫 font-not-in-package）`)
}

run()
