#!/bin/sh
# ─────────────────────────────────────────────────────────────
# 每日巡逻（工作流1.0·2026-08-21）：机器体检总入口。
#
# 设计原则：
#   ① 只跑现成命令+轻量脚本，AI 判断另起会话做（本脚本=纯机器层）；
#   ② fail-soft 逐项收集、末尾汇总退出码——单项坏不中断其余检查；
#   ③ 全绿也输出「平安报」行（死人开关：没收到日报=巡逻本身死了）；
#   ④ 本脚本零写操作（不碰 DB/不部署/不改代码）——爆炸范围=0。
#
# 排程：launchd 每天 04:35（接在 04:00 本地自动备份之后·正好验到新鲜备份）。
#   launchd plist 安装见 docs/工作流.md §3。
# 用法：npm run patrol
# ─────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.." || exit 1
FAIL=0
note() { echo ""; echo "━━━ $1 ━━━"; }

note "① Git 卫生（未推送提交/未跟踪文件）"
REMOTE=$(git ls-remote https://github.com/ookiisparrow/luckyducky-fable.git refs/heads/main 2>/dev/null | cut -f1)
LOCAL=$(git rev-parse HEAD)
if [ -n "$REMOTE" ] && [ "$REMOTE" = "$LOCAL" ]; then AHEAD=0; elif [ -n "$REMOTE" ]; then AHEAD=$(git rev-list --count $REMOTE..HEAD 2>/dev/null || echo "?"); else AHEAD="?"; fi
DIRTY=$(git status --porcelain | grep -v '^??' | wc -l | tr -d ' ')
UNTRACKED=$(git status --porcelain | grep '^??' | wc -l | tr -d ' ')
echo "领先远程 ${AHEAD} 笔 / 未提交改动 ${DIRTY} 文件 / 未登记 ${UNTRACKED} 文件"
[ "$AHEAD" = "?" ] && FAIL=1
[ "${AHEAD:-0}" -gt 20 ] && { echo "🔴 未推送积压 >20 笔——有丢失风险"; FAIL=1; }

note "② 质量闸快检（structure·约2秒）"
node scripts/check-structure.mjs > /tmp/patrol-structure.log 2>&1 \
  && echo "✅ 结构守卫全绿" || { echo "🔴 结构守卫红（详见 /tmp/patrol-structure.log）"; FAIL=1; }

note "③ SSL 证书到期倒计时"
node scripts/check-cert-expiry.mjs || FAIL=1

note "④ 数据库备份新鲜度"
NEWEST=$(find .db-backups.local -type f \( -name "*.json" -o -name "*.csv" \) -print0 2>/dev/null | xargs -0 stat -f "%m %N" 2>/dev/null | sort -rn | head -1)
if [ -z "$NEWEST" ]; then
  echo "🔴 .db-backups.local 无产物——备份链断了"
  FAIL=1
else
  MTIME=${NEWEST%% *}; FNAME=${NEWEST#* }
  AGE_H=$(( ($(date +%s) - MTIME) / 3600 ))
  if [ "$AGE_H" -le 26 ]; then
    echo "✅ 最新备份 ${AGE_H} 小时前（$FNAME）"
  else
    echo "🔴 最新备份已 ${AGE_H} 小时（>26h·$FNAME）——导出链可疑"
    FAIL=1
  fi
fi

note "⑤ GitHub Issues 卫生"
OPEN=$(gh issue list --state open --limit 200 --json number 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d||'[]').length))")
case "$OPEN" in
  ''|*[!0-9]*) echo "🟡 gh 不可用（离线？），跳过";;
  *) echo "开着的 Issue：${OPEN} 个（>50 需清淤）"; [ "$OPEN" -gt 50 ] && FAIL=1;;
esac

note "⑥ npm audit 高危计数"
AUDIT=$(npm audit --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const v=JSON.parse(d).metadata.vulnerabilities;console.log((v.high||0)+(v.critical||0))}catch{console.log('?')}})")
case "$AUDIT" in
  ''|*[!0-9]*) echo "🟡 audit 读不到，跳过";;
  *) if [ "$AUDIT" -eq 0 ]; then echo "✅ 无 high/critical"; else echo "🟡 high+critical 共 ${AUDIT} 条（基线见 Issue #108，超基线即红）"; fi;;
esac

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅✅ 平安报：今日巡逻全部通过（$(date '+%F %T')）"
else
  echo "❌❌ 巡逻有红项（$? 上文逐条·$(date '+%F %T')）——处理指引见 docs/工作流.md §4"
fi
exit $FAIL
