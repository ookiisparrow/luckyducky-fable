#!/usr/bin/env bash
# orchestrator.sh 冒烟测试（P2.2-6: 编排器关键路径回归）
# 验证: freeze 生成只读包且含代码 / 路径过滤防穿越
# archive+sha256 真路径要 herdr，不在这里造假段。本文件留下是给 pipeline-scripts-wired 接线用。
set -euo pipefail
cd "$(dirname "$0")/../../.."
TMP="$(mktemp -d)"
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

pass=0; fail=0
check() { # $1=描述 $2=条件
  if [ "$2" = "true" ]; then pass=$((pass+1)); echo "✅ $1";
  else fail=$((fail+1)); echo "❌ $1"; fi
}

# 准备: 临时上下文（gitignore，不入库）
mkdir -p .agents/contexts
echo "# SMOKE: orchestrator 冒烟测试" > .agents/contexts/SMOKE-01.md

# 1. freeze 生成审查包
OUT="$(PIPELINE_REVIEW_DIR="$TMP/reviews" bash scripts/pipeline/orchestrator.sh freeze SMOKE-01 2>&1)"
check "freeze 返回 JSON" "$(echo "$OUT" | grep -q '"review_package"' && echo true || echo false)"

PKG="$(echo "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["review_package"])' 2>/dev/null || echo "")"
[ -n "$PKG" ] && [ -d "$PKG" ] || { echo "❌ 审查包不存在"; exit 1; }
check "审查包含代码快照 (route.mjs)" "$([ -f "$PKG/scripts/pipeline/route.mjs" ] && echo true || echo false)"
check "审查包含 context.md" "$([ -f "$PKG/context.md" ] && echo true || echo false)"
check "审查包只读 (a-w)" "$([ ! -w "$PKG/context.md" ] && echo true || echo false)"

# 2. 路径过滤: 非法 LD 拒绝
INVALID="$(bash scripts/pipeline/orchestrator.sh freeze '../etc/passwd' 2>&1 || true)"
check "路径穿越 LD 被拒" "$(echo "$INVALID" | grep -qE '非法|error' && echo true || echo false)"

echo ""
echo "通过 $pass / $((pass+fail))"
[ "$fail" -eq 0 ] || exit 1
