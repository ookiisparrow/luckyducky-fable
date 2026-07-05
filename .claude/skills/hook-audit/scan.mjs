#!/usr/bin/env node
// hook-audit/scan.mjs —— 只读解析 Claude Code 执行轨迹，吐确定性 digest。
// 确定性计数交给本脚本；「这值不值得做成 hook」的判断交给读 digest 的 Claude（见 SKILL.md）。
//
// 用法： node .claude/skills/hook-audit/scan.mjs [项目路径 | slug]
//   缺省 = 当前工作目录所属项目。
//   传路径（含 /）自动编码成 slug；传 slug（如 -Users-sparrow-luckyducky-miniprogram）直接用。
//
// 零写：只读 ~/.claude/projects/<slug>/*.jsonl，只往 stdout 打印。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TOP = 25; // 各榜单取前 N
const EARLY = 10; // 「开局」= 一段会话前 N 个工具调用
const INTERP = new Set(['node', 'python', 'python3', 'npx', 'sh', 'bash', 'zsh', 'deno', 'bun', 'tsx']);
const VALIDATE = /\b(npm run (check|test|lint)|vitest|tsc|npm run build|eslint)\b/; // 收尾验证类命令

// ---- 解析项目 → transcript 目录 ----
function toSlug(p) {
  return p.replace(/[/.]/g, '-'); // Claude Code 把 / 和 . 编码成 -
}
function resolveDir(arg) {
  const projects = path.join(os.homedir(), '.claude', 'projects');
  let slug;
  if (!arg) slug = toSlug(process.cwd());
  else if (arg.includes('/')) slug = toSlug(path.resolve(arg));
  else slug = arg; // 已是 slug
  return { dir: path.join(projects, slug), slug };
}

// ---- Bash 命令 → 签名（找「形态」而非逐字）----
// 先剥 heredoc 体（python3 << 'PYEOF' … PYEOF），别把脚本正文当命令计数。
function stripHeredocs(cmd) {
  const out = [];
  let marker = null;
  for (const ln of String(cmd).split('\n')) {
    if (marker) { if (ln.trim() === marker) marker = null; continue; } // body 全丢, 含闭合标记
    const m = ln.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (m) { marker = m[1]; out.push(ln); continue; } // 保留开头行（含命令）, 丢 body
    out.push(ln);
  }
  return out.join('\n');
}

// 引号感知地按顶层 && || | ; 换行 切段，避免把 `node -e '…js…'` 里的 JS 体当命令切碎。
function splitTopLevel(cmd) {
  const s = String(cmd);
  const segs = [];
  let cur = '';
  let sq = false;
  let dq = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const nx = s[i + 1];
    if (sq) { cur += ch; if (ch === "'") sq = false; continue; }
    if (dq) { cur += ch; if (ch === '\\' && nx !== undefined) { cur += nx; i++; continue; } if (ch === '"') dq = false; continue; }
    if (ch === "'") { sq = true; cur += ch; continue; }
    if (ch === '"') { dq = true; cur += ch; continue; }
    if (ch === '\\' && nx !== undefined) { cur += ch + nx; i++; continue; }
    if (ch === '\n' || ch === ';') { segs.push(cur); cur = ''; continue; }
    if ((ch === '&' && nx === '&') || (ch === '|' && nx === '|')) { segs.push(cur); cur = ''; i++; continue; }
    if (ch === '|') { segs.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  return segs.map((x) => x.trim()).filter(Boolean);
}

function bashSignatures(cmd) {
  const out = [];
  for (const seg0 of splitTopLevel(stripHeredocs(cmd))) {
    const seg = seg0.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, ''); // 去开头的 VAR=… 赋值
    const toks = seg.split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const prog = toks[0].split('/').pop();
    if (!/^[\w.@-]+$/.test(prog)) continue; // 不像命令名（引号/JS 残片）→ 丢
    const rest = [];
    if (INTERP.has(prog)) {
      if (/<</.test(seg)) {
        rest.push('(heredoc)'); // 内联脚本归一成一个签名，不切碎
      } else if (toks.some((t) => ['-e', '-c', '-p', '--eval', '--print'].includes(t))) {
        rest.push('-e (inline)');
      } else {
        const p = toks.slice(1).find((t) => !t.startsWith('-') && (t.includes('/') || /\.(mjs|cjs|js|ts|py)$/.test(t)));
        if (p) rest.push(p.split('/').pop());
        else if (toks[1] && !toks[1].startsWith('-')) rest.push(toks[1]);
      }
    } else {
      for (let i = 1; i < toks.length && rest.length < 2; i++) {
        const t = toks[i];
        if (t.startsWith('-')) continue;
        if (t.includes('/')) continue;
        rest.push(/^[A-Za-z][\w:.-]*$/.test(t) ? t : '…');
      }
    }
    out.push([prog, ...rest].join(' ').trim());
  }
  return out;
}

function topN(map, n = TOP) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
function bump(map, k, by = 1) {
  if (!k && k !== 0) return;
  map.set(k, (map.get(k) || 0) + by);
}
function pad(n, w = 4) {
  return String(n).padStart(w);
}
function inline(map, n = TOP) { // 「k:v  k:v …」单行榜，空则 —
  return topN(map, n).map(([k, v]) => `${k}:${v}`).join('  ') || '—';
}

// ---- 主流程 ----
const { dir, slug } = resolveDir(process.argv[2]);
if (!fs.existsSync(dir)) {
  console.error(`[hook-audit] 没找到轨迹目录：${dir}\n  传 slug 或项目路径作参数，或确认 ~/.claude/projects 下有该项目。`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));

const toolCount = new Map();
const bashSig = new Map();
const editExt = new Map();
const editDir = new Map();
const earlyReads = new Map();
const errByTool = new Map();
const sysByLevel = new Map();
const guardHits = new Map(); // 已知守卫脚本在 system 输出里被点名的次数
const guardSamples = [];
const perSession = []; // {file, edits, validates}
let lines = 0;
let skipped = 0;
let permModeSwitch = 0;
let errResults = 0;

const GUARDS = ['guard-deploy', 'check-conventions', 'check-structure', 'interface-catalog', 'writes-need-gate', 'flow-seam', 'visual-check'];

for (const file of files) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const idToTool = new Map();
  let edits = 0;
  let validates = 0;
  let toolSeen = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    lines++;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (o.type === 'permission-mode') permModeSwitch++;

    if (o.type === 'system') {
      bump(sysByLevel, o.level || o.subtype || 'info');
      const txt = typeof o.content === 'string' ? o.content : JSON.stringify(o.content || '');
      for (const g of GUARDS) if (txt.includes(g)) bump(guardHits, g);
      if ((o.level === 'error' || o.level === 'warning') && guardSamples.length < 6) {
        guardSamples.push(`[${o.level}] ${txt.replace(/\s+/g, ' ').slice(0, 140)}`);
      }
    }

    const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
    if (o.type === 'assistant') {
      for (const c of content) {
        if (c.type !== 'tool_use') continue;
        toolSeen++;
        bump(toolCount, c.name);
        idToTool.set(c.id, c.name);
        if (c.name === 'Bash' && c.input && c.input.command) {
          for (const sig of bashSignatures(c.input.command)) bump(bashSig, sig);
          if (VALIDATE.test(c.input.command)) validates++;
        }
        if ((c.name === 'Edit' || c.name === 'Write' || c.name === 'MultiEdit' || c.name === 'NotebookEdit') && c.input && c.input.file_path) {
          edits++;
          const fp = c.input.file_path;
          bump(editExt, path.extname(fp) || '(无扩展)');
          const rel = fp.replace(/^.*?\/(packages|src|docs|scripts|tests|admin|console-assets|\.claude)\//, '$1/');
          bump(editDir, rel.split('/').slice(0, 2).join('/'));
        }
        if (c.name === 'Read' && toolSeen <= EARLY && c.input && c.input.file_path) {
          bump(earlyReads, path.basename(c.input.file_path));
        }
      }
    }
    if (o.type === 'user') {
      for (const c of content) {
        if (c.type === 'tool_result' && c.is_error) {
          errResults++;
          bump(errByTool, idToTool.get(c.tool_use_id) || '?');
        }
      }
    }
  }
  perSession.push({ file: path.basename(file), edits, validates });
}

// ---- 打印 digest ----
const P = (s = '') => console.log(s);
P(`# hook-audit digest`);
P(`project slug : ${slug}`);
P(`dir          : ${dir}`);
P(`sessions     : ${files.length}   lines: ${lines}   parse-skipped: ${skipped}`);
P();

P(`## 工具使用次数`);
P('  ' + inline(toolCount));
P();

P(`## 高频 Bash 命令签名 (top ${TOP}) —— 反复跑的确定性命令 = hook/allowlist 候选`);
for (const [k, v] of topN(bashSig)) P(`  ${pad(v)}  ${k}`);
P();

P(`## 编辑落点 —— 按扩展名 / 按顶层目录（PostToolUse 候选）`);
P('  ext : ' + inline(editExt, 12));
P('  dir : ' + inline(editDir, 12));
P();

P(`## 开局重复读取的文件 (前 ${EARLY} 个工具调用内, 跨会话计数) —— SessionStart 候选`);
for (const [k, v] of topN(earlyReads, 15)) P(`  ${pad(v)}  ${k}`);
P();

P(`## 工具报错 / 授权摩擦 —— 近似, 需复核`);
P(`  tool_result is_error : ${errResults}   permission-mode 切换 : ${permModeSwitch}`);
P('  按工具 : ' + inline(errByTool, 10));
P();

P(`## 守卫 / hook 触发 (system 条目) —— 已机械化的信号, 别重复建议`);
P('  level : ' + inline(sysByLevel, 10));
P('  点名守卫 : ' + inline(guardHits, 10));
for (const s of guardSamples) P(`    · ${s}`);
P();

P(`## 收尾验证覆盖 (每会话: 编辑数 vs 验证命令数) —— 近似, 编辑远多于验证 = Stop hook 候选`);
for (const s of perSession.sort((a, b) => b.edits - a.edits).slice(0, 12)) {
  P(`  ${s.file.slice(0, 12)}…  edits=${pad(s.edits, 3)}  validates=${pad(s.validates, 3)}`);
}
P();
P(`# 读法：本 digest 只给确定性计数。判断哪些值得做成 hook、过滤判断型、减掉已机械化的、起草配置——见 SKILL.md。`);
