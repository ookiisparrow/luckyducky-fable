#!/usr/bin/env bash
# 多模型流水线编排器 (orchestrator.sh)
# 定稿方案 §3/§4 最低约束: 交叉验证 + 快照冻结(含代码) + 只读审查包 + 不可变归档
#
# 用法:
#   pipeline.sh freeze <LD号>                冻结快照(git archive 全代码) + 只读审查包
#   pipeline.sh review-send <target> <LD号>  发审查任务(指向只读审查包) + 等待 + 归档
#   pipeline.sh archive <LD号> <票名> <target> 归档 B/C 原始输出 (写文件+sha256, 不自动 commit)
#   pipeline.sh list                         列出当前 herdr agent
#
# 原则: 审查对象 = 冻结的只读审查包(含完整代码); 原始输出不可变归档; 不向主仓库自动写 commit。

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARCHIVES="$ROOT/.agents/archives"
CONTEXTS="$ROOT/.agents/contexts"
REVIEW_DIR="${PIPELINE_REVIEW_DIR:-/tmp/pipeline-review}"
HERDR="${HERDR:-herdr}"

# 只允许安全字符, 防路径穿越 (P2.1-4): 先校验原始输入, 再过滤
safe_id() {
  local raw="$1"
  [[ "$raw" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "❌ 非法 LD (仅允许 A-Za-z0-9_-)" >&2; return 1; }
  echo "$raw"
}

freeze() {
  local ld raw
  raw="$1"; ld="$(safe_id "$raw")" || return 1
  [ -n "$ld" ] || { echo "❌ 非法 LD"; return 1; }

  local ctx_file="$CONTEXTS/$ld.md"
  [ -f "$ctx_file" ] || { echo "❌ 缺少变更上下文: $ctx_file"; return 1; }

  local commit ts pkg
  commit="$(git -C "$ROOT" rev-parse --short HEAD)"
  ts="$(date +%Y%m%d-%H%M%S)"
  pkg="$REVIEW_DIR/$ld-$commit"

  rm -rf -- "$pkg"
  mkdir -p "$pkg"
  # 完整代码快照 (冻结审查对象, B/C 无需访问活仓库)
  git -C "$ROOT" archive --format=tar HEAD | (cd "$pkg" && tar xf -) 2>/dev/null || \
    { echo "❌ git archive 失败"; return 1; }
  # 排除审查污染/敏感目录: 历史审查归档(交叉污染) + 扩展凭据(.pi)
  rm -rf -- "$pkg/.agents" "$pkg/.pi" "$pkg/.claude" "$pkg/.omp" "$pkg/.github" 2>/dev/null || true
  # 审查上下文 + 快照元数据
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

# 发审查任务: B/C 只读审查包 (含完整代码, 不接触活仓库)
review_send() {
  local raw_target ld pkg
  raw_target="$1"; ld="$(safe_id "$2")" || return 1
  [ -n "$ld" ] || { echo "❌ 非法 LD"; return 1; }

  pkg="$(ls -dt "$REVIEW_DIR"/"$ld"-* 2>/dev/null | head -1 || true)"
  [ -n "$pkg" ] || { echo "❌ 无审查包, 先运行 freeze"; return 1; }
  local commit
  commit="$(grep '^snapshot_commit' "$pkg/snapshot.txt" | cut -d' ' -f2)"

  local prompt="请对以下变更做独立审查(挑错者角色)。审查材料在(只读, 勿修改): $pkg/
审查包内含完整代码快照(snapshot_commit: $commit) + context.md + snapshot.txt。
请只基于审查包内容审查, 不要访问项目活仓库。
审查要求: 1.独立审查不参考其他审查者 2.每条意见必须结构化{类型,位置,复现,证据,影响,置信度} 3.无意见明确说'通过' 4.按严重程度排序。请用中文回答。"

  "$HERDR" agent prompt "$raw_target" "$prompt" --wait --timeout "${REVIEW_TIMEOUT:-600000}" >/dev/null
  archive "$ld" "$raw_target" "$raw_target"
}

# 归档: 写文件 + sha256 校验和; 不自动 commit (P2.2: 不污染主仓库/不绕过复核钩子)
archive() {
  local ld label target out
  ld="$(safe_id "$1")" || return 1; label="$(safe_id "$2")" || return 1; target="$3"
  out="$ARCHIVES/$ld-$label.md"

  "$HERDR" agent read "$target" --source visible --lines 400 --format text > "$out" 2>/dev/null || true
  local vlines
  vlines="$(wc -l < "$out" 2>/dev/null || echo 0)"
  if [ "$vlines" -lt 5 ]; then
    "$HERDR" agent read "$target" --source recent-unwrapped --lines 400 --format text > "$out" 2>/dev/null || true
  fi

  local hash
  hash="$(shasum -a 256 "$out" | cut -d' ' -f1)"
  echo "$hash  $(basename "$out")" > "$out.sha256"
  chmod a-w "$out" "$out.sha256" 2>/dev/null || true
  if [ "$vlines" -lt 5 ]; then
    echo "⚠️ 归档疑似为空 ($vlines 行), 请人工核查审查输出是否完整"
  fi
  echo "📦 归档: $out ($vlines 行) sha256=${hash:0:12}… (未自动提交, 请人工决定入库)"
}

list() {
  "$HERDR" agent list
}

# P3: 部署到测试环境（排练厅）。调用既有 deploy-test.mjs, TEST_ENV 单源兜底。
# 生产部署不在此命令——永远走人工授权（AGENTS.md 铁律）。
deploy_test() {
  node "$ROOT/scripts/deploy-test.mjs" "$@"
}

case "${1:-}" in
  freeze) freeze "${2:?LD号}";;
  review-send) review_send "${2:?target}" "${3:?LD号}";;
  archive) archive "${2:?LD号}" "${3:?票名}" "${4:?target}";;
  deploy-test) shift; deploy_test "$@";;
  list) list;;
  *) echo "用法见文件头"; exit 2;;
esac
