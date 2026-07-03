<script setup>
/**
 * 发货工作台（R32·主流程，形态参照上新向导 Wizard.vue）：/fulfill/step/<1-3>。
 * ①拣货备货（全部待发货按产品汇总）②打印内部标签（QR=订单id 贴箱）③扫码发货（扫箱码选单+扫快递码发货）。
 *
 * 数据归壳：三步是同一物理队列（全部待发货订单）的三个视图，数字必须互相咬合——
 * 备货 N 单 = 标签 N 张 = 扫码队列 N 单；且 <component :is> 换步即销毁组件，步内自拉会每次重跑
 * 整个游标循环。新付款订单只在显式点「刷新」时进队（干活途中拣货单不被悄悄改）。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { cloudMode, listOrders } from '@/api/cloud.js'
import { FULFILL_STEP_NAMES, pickSummary } from '@/utils/fulfill.js'
import { RefreshCw } from 'lucide-vue-next'
import Skeleton from '@/components/Skeleton.vue'
import StepPick from '@/pages/fulfill/StepPick.vue'
import StepPrint from '@/pages/fulfill/StepPrint.vue'
import StepScan from '@/pages/fulfill/StepScan.vue'

const props = defineProps({ n: { type: String, default: '1' } })
const router = useRouter()

const step = computed(() => Math.min(3, Math.max(1, parseInt(props.n, 10) || 1)))
const comp = computed(() => [StepPick, StepPrint, StepScan][step.value - 1])

// —— 待发货队列（壳持有，传给各步）——
const orders = ref([])
const loading = ref(true)
const loadErr = ref('')
// 本次发货流水（放壳：中途跳回步1看余量再回步3，流水不丢；刷新页面即清，属会话态不持久化）
const sessionLog = ref([])

async function reload() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    // 游标循环拉全量 paid（每页服务端上限 200；25 页保险丝防异常数据下无限翻页）
    const acc = []
    const seen = new Set()
    let cursor = null
    let hasMore = true
    let pages = 0
    while (hasMore && pages < 25) {
      const r = await listOrders({ status: 'paid', cursor })
      for (const o of r.list) {
        if (!seen.has(o.id)) {
          seen.add(o.id)
          acc.push(o)
        }
      }
      cursor = r.nextCursor
      hasMore = r.hasMore && cursor != null
      pages++
    }
    orders.value = acc
  } catch (e) {
    loadErr.value = '加载待发货订单失败：' + e.message
  } finally {
    loading.value = false
  }
}
reload()

const summary = computed(() => pickSummary(orders.value))

function onShipped({ id, entry }) {
  orders.value = orders.value.filter((o) => o.id !== id)
  sessionLog.value.unshift(entry)
}
function onLog(entry) {
  sessionLog.value.unshift(entry)
}

function go(n) {
  if (n >= 1 && n <= 3) router.push(`/fulfill/step/${n}`)
}
function railState(n) {
  if (n === step.value) return 'current'
  return n < step.value ? 'done' : 'todo'
}
</script>

<template>
  <div>
    <header class="top">
      <h1 class="title">发货工作台</h1>
      <span class="chip">第 {{ step }} / 3 步 · {{ FULFILL_STEP_NAMES[step - 1] }}</span>
      <span v-if="!loading && cloudMode" class="chip grey">待发货 {{ summary.orderCount }} 单 · 共 {{ summary.totalQty }} 件</span>
      <span class="flex"></span>
      <button class="btn ghost" :disabled="loading" @click="reload"><RefreshCw :size="14" />刷新队列</button>
    </header>

    <div class="rail card">
      <template v-for="sn in 3" :key="sn">
        <span v-if="sn > 1" class="line" :class="{ lit: railState(sn) !== 'todo' }"></span>
        <button class="step" :class="railState(sn)" @click="go(sn)">
          <span class="circ">{{ railState(sn) === 'done' ? '✓' : sn }}</span>
          <span class="sname">{{ FULFILL_STEP_NAMES[sn - 1] }}</span>
        </button>
      </template>
    </div>

    <p v-if="!cloudMode" class="hint warn">发货工作台需云端模式（配置 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <Skeleton v-else-if="loading" class="card" :rows="6" />

    <div v-else class="content card">
      <component :is="comp" :orders="orders" :session-log="sessionLog" @shipped="onShipped" @log="onLog" />
      <div class="nav">
        <button v-if="step > 1" class="btn ghost" @click="go(step - 1)">
          ← 上一步 · {{ FULFILL_STEP_NAMES[step - 2] }}
        </button>
        <span class="flex"></span>
        <button v-if="step < 3" class="btn primary" @click="go(step + 1)">
          下一步 · {{ FULFILL_STEP_NAMES[step] }} →
        </button>
        <button v-else class="btn primary" @click="router.push('/orders')">✓ 完成 · 去订单发货页</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.title {
  font-size: 19px;
  color: var(--ink);
  margin: 0;
}
.flex {
  flex: 1;
}
.rail {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  margin-bottom: 18px;
}
.line {
  flex: 1;
  height: 2px;
  border-radius: 2px;
  background: var(--line);
}
.line.lit {
  background: var(--green-line);
}
.step {
  display: flex;
  align-items: center;
  gap: 7px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.circ {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 700;
  background: var(--bg-grey);
  border: 1px solid var(--line-strong);
  color: var(--content-2);
}
.sname {
  font-size: 12px;
  color: var(--content-2);
}
.step.done .circ {
  background: var(--green-bg);
  border-color: var(--green-line);
  color: var(--green);
}
.step.done .sname {
  color: var(--content);
}
.step.current .circ {
  background: var(--brand);
  border-color: var(--brand);
  color: var(--white);
}
.step.current .sname {
  color: var(--purple-ink);
  font-weight: 700;
}
.content {
  padding: 22px 24px;
  min-height: 480px;
  display: flex;
  flex-direction: column;
}
.nav {
  display: flex;
  align-items: center;
  border-top: 1px solid var(--line);
  padding-top: 16px;
  margin-top: 22px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
