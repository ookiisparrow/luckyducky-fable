#!/usr/bin/env bash
# 多模型流水线编排器 (orchestrator.sh)
# 定稿方案 §3: 交叉验证协议的执行封装
#
# 用法:
#   pipeline.sh snapshot <LD号>                生成不可变输入快照
#   pipeline.sh review-send <target> <LD号>    发审查任务给 B/C 面板(目标= pane id 或 agent 名)
#   pipeline.sh archive <LD号> <票名> <target>  归档 B/C 原始输出(不可变, 同批 commit)
#   pipeline.sh list                           列出当前 herdr agent
#
# 原则: 原始输出不可变归档, 主控不得改写删减; 争议清单由归档生成。

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVES="$ROOT/.agents/archives"
CONTEXTS="$ROOT/.agents/contexts"
HERDR="${HERDR:-herdr}"

snapshot() {
  local ld="$1"
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  # 不可变输入快照: git 已提交状态 + 变更上下文
  local commit
  commit="$(git -C "$ROOT" rev-parse --short HEAD)"
  echo "{\"ld\":\"$ld\",\"snapshot_commit\":\"$commit\",\"timestamp\":\"$ts\",\"cwd\":\"$ROOT\"}"
}

review_send() {
  local target="$1" ld="$2"
  local ctx_file="$CONTEXTS/$ld.md"
  if [ ! -f "$ctx_file" ]; then
    echo "❌ 缺少变更上下文: $ctx_file (先用模板生成)"
    return 1
  fi
  local prompt="请对以下变更做独立审查(挑错者角色)。输入快照与变更上下文: $ctx_file
审查要求: 1.独立审查不参考其他审查者 2.每条意见必须结构化{类型,位置,复现,证据,影响,置信度} 3.无意见明确说'通过' 4.按严重程度排序。请用中文回答。"
  "$HERDR" agent prompt "$target" "$prompt" --wait --timeout "${REVIEW_TIMEOUT:-600000}" >/dev/null
  archive "$ld" "$target" "$target"
}

archive() {
  local ld="$1" label="$2" target="$3"
  local out="$ARCHIVES/$ld-$(echo "$label" | tr -cd 'a-zA-Z0-9-').md"
  "$HERDR" agent read "$target" --source recent-unwrapped --lines 200 --format text > "$out"
  git -C "$ROOT" add "$out" >/dev/null 2>&1 || true
  echo "📦 归档: $out ($(wc -l < "$out") 行)"
}

list() {
  "$HERDR" agent list
}

case "${1:-}" in
  snapshot) snapshot "${2:?LD号}";;
  review-send) review_send "${2:?target}" "${3:?LD号}";;
  archive) archive "${2:?LD号}" "${3:?票名}" "${4:?target}";;
  list) list;;
  *) echo "用法见文件头"; exit 2;;
esac
