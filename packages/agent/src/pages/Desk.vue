<script setup>
/**
 * 外包坐席工作台主页（承面C 车道 B·M⑦ 车道C 移动化）。
 * 桌面：三栏 待接队列 | 会话窗口 | 客户360 + 快捷回复（grid·不变）。
 * 移动（窄屏 ≤820px）：单栏切换——默认见「队列」，认领/打开→切「会话」（顶部返回回队列）；
 *   客户360 + 快捷回复收进右滑抽屉（会话区「客户/工具」按钮开）。
 * 会话直达（M⑦ 推送卡片 `?session=<id>`）：进页读参→ resolveSessionDeepLink 决策 open/claim/提示（纯函数·logic/deepLink）。
 * 编排层：只持「当前会话 current」+「在线态」+「快捷回复插入信号」+「移动视图/抽屉」，能力下放子组件；后端一律经 agentApi。
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, ArrowLeft, PanelRight, X } from 'lucide-vue-next'
import { currentAgent, currentCaps, logout, listMyActive, listQueue, claimConversation } from '@/api/agentApi.js'
import { toast } from '@/utils/ui.js'
import { resolveSessionDeepLink } from '@/logic/deepLink.js'
import AgentStatusToggle from '@/components/desk/AgentStatusToggle.vue'
import QueueList from '@/components/desk/QueueList.vue'
import ConversationWindow from '@/components/desk/ConversationWindow.vue'
import Customer360Panel from '@/components/desk/Customer360Panel.vue'
import QuickReplies from '@/components/desk/QuickReplies.vue'

const router = useRouter()
const agent = currentAgent() || '坐席'
// 角色显形（超管 vs 外包·防身份混淆）：超管＝商户本人（全量会话+升级件在此接手），外包＝最小权坐席。
const isSuper = currentCaps().includes('*')
const deskTitle = isSuper ? '商户客服工作台' : '外包坐席工作台'
document.title = 'Lucky Ducky · ' + deskTitle

const current = ref(null) // 当前处理的会话 SessionView（null=未接入任何会话）
const status = ref('online')
const insert = ref(null) // { text, id } 快捷回复插入信号
let insertSeq = 0
const queueRef = ref(null)
const mobileView = ref('queue') // 移动单栏：'queue' | 'conv'（桌面 grid 下此值无视觉作用）
const sideOpen = ref(false) // 移动：客户360/快捷回复抽屉开合

function onClaimed(session) {
  current.value = session
  mobileView.value = 'conv' // 移动：认领后切到会话视图
}
// 切回在接会话（我的在接区点击·刷新恢复后重开会话窗口·follow-up ②）
function onOpen(session) {
  current.value = session
  mobileView.value = 'conv'
}
function onEnded() {
  current.value = null
  mobileView.value = 'queue' // 移动：结束后回队列
  sideOpen.value = false
  if (queueRef.value) queueRef.value.refresh() // 结束/退回后立即刷新待接队列（退回的会重回队列）
}
function onPick(text) {
  insert.value = { text, id: ++insertSeq }
  sideOpen.value = false // 移动：选完快捷回复收抽屉，回到会话输入
}
function doLogout() {
  logout()
  router.push('/login')
}

// 会话直达（M⑦ 推送卡片点入·?session=<id>）：一次性读参 → 决策 open/claim/提示（读完清参防刷新重触发）。
onMounted(async () => {
  const params = new URLSearchParams(location.search)
  const target = params.get('session')
  if (!target) return
  const u = new URL(location.href)
  u.searchParams.delete('session')
  history.replaceState(null, '', u.pathname + u.search + u.hash)
  try {
    const [my, q] = await Promise.all([listMyActive(), listQueue({ limit: 50 })])
    const d = resolveSessionDeepLink(target, { myActive: my.sessions || [], queue: q.items || [] })
    if (d.action === 'open') onOpen(d.session)
    else if (d.action === 'claim') {
      const r = await claimConversation(target)
      if (r.ok) onClaimed(r.session)
      else toast(r.error === 'ALREADY_CLAIMED' ? '该会话已被其他坐席接走' : '认领失败', 'err')
    } else if (d.action === 'notfound') {
      toast('该会话已被接走或已结束', 'err')
    }
  } catch {
    /* 直达失败不阻塞进入工作台（坐席仍可手动从队列接） */
  }
})
</script>

<template>
  <div class="desk">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <div class="logo-badge" :class="{ super: isSuper }">🦆</div>
        <div>
          <div class="brand-title">
            {{ deskTitle }}
            <span class="role-chip" :class="isSuper ? 'super' : 'out'">{{ isSuper ? '超管' : '外包' }}</span>
          </div>
          <div class="brand-sub">{{ isSuper ? 'Lucky Ducky · 全量会话 + 升级件在此接手' : 'Lucky Ducky · 承面 C' }}</div>
        </div>
      </div>
      <div class="top-right">
        <AgentStatusToggle v-model:status="status" />
        <div class="who">
          <span class="who-name">{{ agent }}</span>
          <button class="who-out" title="退出登录" @click="doLogout"><LogOut :size="14" /></button>
        </div>
      </div>
    </header>

    <!-- 三栏工作区（桌面 grid；移动按 mobileView 单栏切换） -->
    <div class="grid" :class="'m-' + mobileView">
      <aside class="col-queue card"><QueueList ref="queueRef" :current-id="current ? current.sessionId : ''" @claimed="onClaimed" @open="onOpen" /></aside>

      <main class="col-conv card">
        <!-- 移动会话头：返回队列 + 客户/工具抽屉（桌面隐藏） -->
        <div v-if="current" class="conv-mobar">
          <button class="mbtn" @click="mobileView = 'queue'"><ArrowLeft :size="16" /><span>队列</span></button>
          <button class="mbtn" @click="sideOpen = true"><PanelRight :size="16" /><span>客户/工具</span></button>
        </div>
        <ConversationWindow v-if="current" :key="current.sessionId" :session="current" :insert="insert" @ended="onEnded" />
        <div v-else class="conv-empty">
          <div class="empty-emoji">💬</div>
          <p class="empty-title">从「待接队列」认领一个会话开始接待</p>
          <p class="empty-sub">认领后可查看客户 360、发送回复、升级转商户或结束会话</p>
        </div>
      </main>

      <aside class="col-side" :class="{ 'side-open': sideOpen }">
        <div class="side-mhead">
          <span>客户信息 / 快捷回复</span>
          <button class="mbtn" @click="sideOpen = false"><X :size="16" /></button>
        </div>
        <div class="card side-360"><Customer360Panel :session="current" /></div>
        <div class="card side-qr"><QuickReplies @pick="onPick" /></div>
      </aside>
      <div v-if="sideOpen" class="side-scrim" @click="sideOpen = false"></div>
    </div>
  </div>
</template>

<style scoped>
.desk {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 14px 18px 18px;
  gap: 14px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.logo-badge.super {
  background: var(--ink); /* 超管深色徽标·一眼区别外包紫 */
}
.role-chip {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: var(--r-pill);
  font-size: 10.5px;
  font-weight: 700;
  vertical-align: 2px;
}
.role-chip.super {
  background: var(--ink);
  color: var(--white);
}
.role-chip.out {
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  color: var(--purple-meta);
}
.brand-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
}
.brand-sub {
  font-size: 11px;
  color: var(--purple-meta);
}
.top-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.who {
  display: flex;
  align-items: center;
  gap: 8px;
}
.who-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--content);
}
.who-out {
  border: 1px solid var(--line-strong);
  background: var(--white);
  border-radius: 8px;
  padding: 5px 7px;
  cursor: pointer;
  color: var(--content-2);
  display: flex;
}
.who-out:hover {
  color: var(--red);
  border-color: #f0c8c5;
}
.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 288px 1fr 336px;
  gap: 14px;
}
.card {
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: 13px;
}
.col-queue {
  min-height: 0;
  overflow: hidden;
}
.col-conv {
  min-height: 0;
  overflow: hidden;
}
.conv-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px;
  text-align: center;
}
.empty-emoji {
  font-size: 40px;
}
.empty-title {
  margin: 8px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.empty-sub {
  margin: 0;
  font-size: 12px;
  color: var(--content-2);
}
.col-side {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.side-360,
.side-qr {
  flex: 0 0 auto;
}
/* 移动专属控件（桌面隐藏） */
.conv-mobar,
.side-mhead,
.side-scrim {
  display: none;
}
.mbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--line-strong);
  background: var(--white);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  color: var(--content);
  cursor: pointer;
}
.mbtn:hover {
  border-color: var(--brand);
  color: var(--brand-active);
}

/* ── 移动（窄屏）：单栏切换 + 右滑抽屉 ────────────────────────────── */
@media (max-width: 820px) {
  .desk {
    padding: 10px 12px 12px;
    gap: 10px;
  }
  .brand-sub {
    display: none; /* 窄屏顶栏省空间 */
  }
  .top-right {
    gap: 10px;
  }
  .grid {
    grid-template-columns: 1fr; /* 单栏 */
  }
  /* 按 mobileView 只显一栏（队列 或 会话） */
  .grid.m-queue .col-conv {
    display: none;
  }
  .grid.m-conv .col-queue {
    display: none;
  }
  .conv-mobar {
    display: flex;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    flex: 0 0 auto;
  }
  .col-conv {
    display: flex;
    flex-direction: column;
  }
  /* 客户360/快捷回复：右滑抽屉（默认移出屏外） */
  .col-side {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 30;
    width: 86%;
    max-width: 360px;
    height: 100vh;
    padding: 12px;
    background: var(--bg-lilac);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
    transform: translateX(100%);
    transition: transform 0.22s ease;
  }
  .col-side.side-open {
    transform: translateX(0);
  }
  .side-mhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    padding: 2px 2px 4px;
  }
  .side-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(0, 0, 0, 0.32);
  }
}
</style>
