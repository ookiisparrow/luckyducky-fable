<script setup>
/**
 * 外包坐席工作台主页（承面C 车道 B）。三栏：待接队列 | 会话窗口 | 客户360 + 快捷回复。
 * 编排层：只持有「当前会话 current」+「坐席在线态」+「快捷回复插入信号」，把具体能力下放子组件；
 * 后端调用一律经 api/agentApi.js（单点接缝·组件不碰 mock）。
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut } from 'lucide-vue-next'
import { currentAgent, logout } from '@/api/agentApi.js'
import AgentStatusToggle from '@/components/desk/AgentStatusToggle.vue'
import QueueList from '@/components/desk/QueueList.vue'
import ConversationWindow from '@/components/desk/ConversationWindow.vue'
import Customer360Panel from '@/components/desk/Customer360Panel.vue'
import QuickReplies from '@/components/desk/QuickReplies.vue'

const router = useRouter()
const agent = currentAgent() || '坐席'

const current = ref(null) // 当前处理的会话 SessionView（null=未接入任何会话）
const status = ref('online')
const insert = ref(null) // { text, id } 快捷回复插入信号
let insertSeq = 0
const queueRef = ref(null)

function onClaimed(session) {
  current.value = session
}
function onEnded() {
  current.value = null
  if (queueRef.value) queueRef.value.refresh() // 结束/退回后立即刷新待接队列（退回的会重回队列）
}
function onPick(text) {
  insert.value = { text, id: ++insertSeq }
}
function doLogout() {
  logout()
  router.push('/login')
}
</script>

<template>
  <div class="desk">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <div class="logo-badge">🦆</div>
        <div>
          <div class="brand-title">外包坐席工作台</div>
          <div class="brand-sub">Lucky Ducky · 承面 C</div>
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

    <!-- 三栏工作区 -->
    <div class="grid">
      <aside class="col-queue card"><QueueList ref="queueRef" :current-id="current ? current.sessionId : ''" @claimed="onClaimed" /></aside>

      <main class="col-conv card">
        <ConversationWindow v-if="current" :key="current.sessionId" :session="current" :insert="insert" @ended="onEnded" />
        <div v-else class="conv-empty">
          <div class="empty-emoji">💬</div>
          <p class="empty-title">从左侧「待接队列」认领一个会话开始接待</p>
          <p class="empty-sub">认领后可查看客户 360、发送回复、升级转商户或结束会话</p>
        </div>
      </main>

      <aside class="col-side">
        <div class="card side-360"><Customer360Panel :openid="current ? current.openid : null" /></div>
        <div class="card side-qr"><QuickReplies @pick="onPick" /></div>
      </aside>
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
</style>
