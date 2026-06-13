#!/usr/bin/env node
/**
 * 编辑即格式化——「格式交给工具」主张的机器化（PostToolUse hook）。
 *
 * 与 npm run format 同一引擎、同一范围：用 prettier 库按仓 .prettierrc.json 就地格式化，
 * 尊重 .prettierignore；只动 packages/miniapp/src 下 prettier 治理的文件（与 format 脚本 glob 对齐）。
 * 把 format 从「靠人记得手动跑」变「编辑即发生」，排版不再进 diff、不靠肉眼对齐。
 *
 * 用法：
 *   node scripts/format-hook.mjs --hook   # PostToolUse：读 stdin 取被编辑文件，就地格式化
 * 守卫：tests/scripts/format-hook.test.js（行为）+ check-structure 的 format-hook-wired（接线）。
 *
 * 设计：格式化从不阻塞编辑（恒 exit 0、出错即吞）——拦截是约定/结构闸的职责，排版只做不挡。
 */
import prettier from 'prettier'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const IGNORE_PATH = join(ROOT, '.prettierignore')
const SCOPE_EXT = /\.(vue|js|scss|json)$/

// 与 npm run format 同范围：仅 packages/miniapp/src 下的 vue/js/scss/json。
// 其余包（cloud ts、根 scripts、admin）维持现状不扩域——扩域是另一笔决策。
export function inScope(file) {
  return file.includes('/packages/miniapp/src/') && SCOPE_EXT.test(file)
}

// 按仓配置就地格式化；prettier 自身负责忽略(.prettierignore)与选择解析器；返回是否有改动。
export async function formatFile(file) {
  const info = await prettier.getFileInfo(file, { ignorePath: IGNORE_PATH })
  if (info.ignored || !info.inferredParser) return false
  const src = readFileSync(file, 'utf8')
  const config = await prettier.resolveConfig(file)
  const out = await prettier.format(src, { ...config, filepath: file })
  if (out !== src) writeFileSync(file, out)
  return out !== src
}

const args = process.argv.slice(2)

if (args[0] === '--hook') {
  // Claude Code PostToolUse：stdin 是 hook JSON。格式化不阻塞编辑——任何情况都 exit 0。
  let stdin = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) stdin += chunk
  let file
  try {
    file = JSON.parse(stdin)?.tool_input?.file_path
  } catch {
    process.exit(0)
  }
  if (file && inScope(file)) {
    try {
      await formatFile(resolve(file))
    } catch {
      // 格式化出错不挡路（约定/结构闸才负责拦）
    }
  }
  process.exit(0)
}
