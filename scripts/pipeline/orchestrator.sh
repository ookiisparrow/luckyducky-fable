#!/usr/bin/env bash
# 多模型流水线编排器 (orchestrator.sh)
# 定稿方案 §3/§4 最低约束: 交叉验证 + 快照冻结 + 只读审查包 + 不可变归档
#
# 用法:
#   pipeline.sh freeze <LD号>                冻结快照 + 生成只读审查包 (B/C 只看这个)
#   pipeline.sh review-send <target> <LD号>  发审查任务(指向只读审查包) + 等待 + 归档
#   pipeline.sh archive <LD号> <票名> <target> 归档 B/C 原始输出 (真 commit, 不可变)
#   pipeline.sh list                         列出当前 herdr agent
#
# 原则: 审查对象 = 冻结的只读审查包; 原始输出不可变归档; 主控不得改写删减。

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVES="$ROOT/.agents/archives"
CONTEXTS="$ROOT/.agents/contexts"
REVIEW_DIR="/tmp/pipeline-review"
HERDR="${HERDR:-herdr}"

# 只允许安全字符, 防路径穿越 (P2.1-4)
safe_id() {
  echo "$1" | tr -cd 'A-Za-z0-9_-'
}

# P2.1-1/2: 冻结快照 + 只读审查包
freeze() {
  local ld raw
  raw="$1"; ld="$(safe_id "$1")"
  [ -n "$ld" ] || { echo "❌ 非法 LD"; return 1; }

  local ctx_file="$CONTEXTS/$ld.md"
  [ -f "$ctx_file" ] || { echo "❌ 缺少变更上下文: $ctx_file"; return 1; }

  local commit ts pkg
  commit="$(git -C "$ROOT" rev-parse --short HEAD)"
  ts="$(date +%Y%m%d-%H%M%S)"
  pkg="$REVIEW_DIR/$ld-$commit"

  rm -rf "$pkg"
  mkdir -p "$pkg"
  # 审查包 = 变更上下文 + 快照元数据 (只读副本)
  cp "$ctx_file" "$pkg/context.md"
  {
    echo "snapshot_commit: $commit"
    echo "frozen_at: $ts"
    echo "repo: $ROOT"
    git -C "$ROOT" status --porcelain | head -20 || true
  } > "$pkg/snapshot.txt"
  chmod -R a-w "$pkg"

  echo "{\"ld\":\"$ld\",\"snapshot_commit\":\"$commit\",\"review_package\":\"$pkg\",\"frozen\":\"$ts\"}"
}

# 发审查任务: B/C 只读审查包
review_send() {
  local raw_target ld pkg
  raw_target="$1"; ld="$(safe_id "$2")"
  [ -n "$ld" ] || { echo "❌ 非法 LD"; return 1; }

  # 找最新审查包
  pkg="$(ls -dt "$REVIEW_DIR"/"$ld"-* 2>/dev/null | head -1 || true)"
  [ -n "$pkg" ] || { echo "❌ 无审查包, 先运行 freeze"; return 1; }

  local prompt="请对以下变更做独立审查(挑错者角色)。审查材料(只读, 勿修改): $pkg/ 目录
请先读 context.md 和 snapshot.txt, 再按需访问变更代码(快照 commit: $(cat "$pkg/snapshot.txt" | grep snapshot_commit | cut -d' ' -f2))。
审查要求: 1.独立审查不参考其他审查者 2.每条意见必须结构化{类型,位置,复现,证据,影响,置信度} 3.无意见明确说'通过' 4.按严重程度排序。请用中文回答。"

  "$HERDR" agent prompt "$raw_target" "$prompt" --wait --timeout "${REVIEW_TIMEOUT:-600000}" >/dev/null
  archive "$ld" "$raw_target" "$raw_target"
}

# 归档: 先 visible 后 recent-unwrapped 合并, 真 commit (P2.1-4)
archive() {
  local ld label target out
  ld="$(safe_id "$1")"; label="$(safe_id "$2")"; target="$3"
  out="$ARCHIVES/$ld-$label.md"

  "$HERDR" agent read "$target" --source visible --lines 200 --format text > "$out" 2>/dev/null || true
  local vlines
  vlines="$(wc -l < "$out" 2>/dev/null || echo 0)"
  if [ "$vlines" -lt 5 ]; then
    "$HERDR" agent read "$target" --source recent-unwrapped --lines 200 --format text > "$out" 2>/dev/null || true
  fi

  # 真 commit: 归档随审查批次入库, 不可变
  git -C "$ROOT" add "$out" >/dev/null 2>&1 || true
  git -C "$ROOT" commit -m "docs：流水线审查归档 $ld ($label)" --no-verify >/dev/null 2>&1 || true
  echo "📦 归档: $out ($(wc -l < "$out") 行) commit=$(git -C "$ROOT" rev-parse --short HEAD)"
}

list() {
  "$HERDR" agent list
}

case "${1:-}" in
  freeze) freeze "${2:?LD号}";;
  review-send) review_send "${2:?target}" "${3:?LD号}";;
  archive) archive "${2:?LD号}" "${3:?票名}" "${4:?target}";;
  list) list;;
  *) echo "用法见文件头"; exit 2;;
esac
