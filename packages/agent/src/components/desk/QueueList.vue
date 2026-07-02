<script setup>
/**
 * 待接队列 + 我的在接（B2·follow-up ②）：调 listQueue 拉 pending 会话（bounded·cursor/limit·根因#7）+
 * listMyActive 拉本坐席在接会话（**刷新/重登不丢在接**·多会话切换），定时刷新（轮询·带清理）。
 * 待接条「认领接入」→ claimConversation → emit('claimed', session)；在接条点击 → emit('open', session)
 * （切回在接会话·交父级打开会话窗口）。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { RefreshCw, UserPlus } from 'lucide-vue-next'
import { listQueue, claimConversation, listMyActive } from '@/api/agentApi.js'
import { toast } from '@/utils/ui.js'

defineProps({ currentId: { type: String, default: '' } }) // currentId 在模板中直接引用（高亮当前会话）
const emit = defineEmits(['claimed', 'open'])

const items = ref([])
const mine = ref([]) // 我的在接（active·刷新恢复·多会话切换）
const loading = ref(false)
const err = ref('')
const claiming = ref('')
const QUEUE_POLL_MS = 4000
let timer = null

async function refresh() {
  loading.value = true
  err.value = ''
  try {
    const [q, my] = await Promise.all([listQueue({ limit: 30 }), listMyActive()])
    items.value = q && q.ok ? q.items : []
    mine.value = my && my.ok ? my.sessions : []
  } catch (e) {
    err.value = '队列加载失败：' + e.message
  } finally {
    loading.value = false
  }
}

async function claim(it) {
  if (claiming.value) return
  claiming.value = it.sessionId
  try {
    const r = await claimConversation(it.sessionId)
    if (r && r.ok) {
      items.value = items.value.filter((x) => x.sessionId !== it.sessionId) // 乐观移出待接
      emit('claimed', r.session)
      toast('已认领：' + (it.display || it.externalUserId), 'ok')
    } else {
      toast(r && r.error === 'NOT_CLAIMABLE' ? '该会话已被他人认领' : '认领失败', 'err')
      refresh()
    }
  } catch (e) {
    toast('认领失败：' + e.message, 'err')
  } finally {
    claiming.value = ''
  }
}

const waitLabel = (ms) => {
  const m = Math.floor((ms || 0) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  return Math.floor(m / 60) + ' 小时前'
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, QUEUE_POLL_MS) // 轮询刷新待接队列
})
onUnmounted(() => {
  if (timer) clearInterval(timer) // 清理轮询 timer（防泄漏·守卫 agent-poll-cleanup）
  timer = null
})

defineExpose({ refresh })
</script>

<template>
  <section class="queue">
    <!-- 我的在接（active·点击切回·刷新恢复·follow-up ②） -->
    <header v-if="mine.length" class="q-head">
      <div class="q-title">
        我的在接 <span class="cnt green">{{ mine.length }}</span>
      </div>
    </header>
    <ul v-if="mine.length" class="q-list mine">
      <li v-for="it in mine" :key="it.sessionId" class="q-item clickable" :class="{ on: it.sessionId === currentId }" @click="emit('open', it)">
        <div class="q-main">
          <div class="q-name">{{ it.display || it.externalUserId }}</div>
          <div class="q-meta"><span class="chip green">在接</span></div>
        </div>
      </li>
    </ul>

    <header class="q-head">
      <div class="q-title">
        待接队列 <span class="cnt">{{ items.length }}</span>
      </div>
      <button class="icon-btn" title="刷新" @click="refresh"><RefreshCw :size="14" :class="{ spin: loading }" /></button>
    </header>

    <p v-if="err" class="q-err">{{ err }}</p>
    <p v-else-if="!items.length && !loading" class="q-empty">暂无待接会话 🎉</p>

    <ul class="q-list">
      <li v-for="it in items" :key="it.sessionId" class="q-item" :class="{ on: it.sessionId === currentId }">
        <div class="q-main">
          <div class="q-name">{{ it.display || it.externalUserId }}</div>
          <div class="q-meta">
            <!-- 升级件与普通待接区分（超管队列含 escalated·外包甩单一眼可辨） -->
            <span class="chip amber">{{ it.status === 'escalated' ? '升级' : '待接' }}</span>
            <span class="q-wait">{{ waitLabel(it.waitingMs) }}</span>
          </div>
        </div>
        <button class="btn brand mini" :disabled="claiming === it.sessionId" @click="claim(it)">
          <UserPlus :size="13" />认领
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.queue {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.q-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}
.q-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.cnt {
  display: inline-flex;
  min-width: 20px;
  justify-content: center;
  padding: 1px 6px;
  margin-left: 4px;
  border-radius: var(--r-pill);
  background: var(--brand);
  color: var(--white);
  font-size: 11px;
}
.cnt.green {
  background: var(--green);
}
.q-list.mine {
  flex: 0 0 auto; /* 在接区不挤占待接列表的滚动空间 */
  max-height: 40%;
  overflow-y: auto;
}
.q-item.clickable {
  cursor: pointer;
}
.icon-btn {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--content-2);
  display: flex;
  padding: 4px;
}
.icon-btn:hover {
  color: var(--brand);
}
.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.q-err {
  padding: 10px 16px;
  color: var(--red);
  font-size: 12px;
}
.q-empty {
  padding: 24px 16px;
  color: var(--content-2);
  font-size: 12.5px;
  text-align: center;
}
.q-list {
  list-style: none;
  margin: 0;
  padding: 0 10px 10px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.q-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.q-item + .q-item {
  margin-top: 4px;
}
.q-item:hover {
  background: var(--bg-lilac);
}
.q-item.on {
  background: var(--bg-lilac);
  border-color: var(--purple-line);
}
.q-main {
  flex: 1;
  min-width: 0;
}
.q-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.q-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.q-wait {
  font-size: 11px;
  color: var(--content-2);
}
</style>
