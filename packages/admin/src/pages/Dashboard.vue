<script setup>
/**
 * 数据看板（S12 重设计）：从「干瞪眼的数字」改成 owner 的行动入口。
 *
 * 重设计要点：
 * - 顶部「待处理」行动条：待发货 / 待审退款 / 低库存 / 钱链告警——数字直接点进对应页处理。
 *   计数复用服务端精确口径（orderCounts/refundCounts·根因#7）+ 库存按 SKU 实算，不再要 owner
 *   自己去各页数。这是看板真正的价值：一眼知道今天要干嘛。
 * - KPI 卡精炼（去 emoji）、激活率给进度条；热点/卡点/最近订单沿用 getDashboard 既有数据。
 * - 趋势 / 时间范围 / 经营漏斗（访问→加购→下单→支付→激活→完课）需事件时序聚合 + 容量评估
 *   （根因#8·看板内存聚合封顶），列后续、不伪造时序。
 */
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { cloudMode, getDashboard, orderCounts, refundCounts, listInventory } from '@/api/cloud.js'

const router = useRouter()
const data = ref(null)
const todo = ref({ ship: 0, refund: 0, lowStock: 0, money: 0 })
const loading = ref(true)
const loadErr = ref('')

const txAlertCount = (t) =>
  !t ? 0 : (t.feeMismatch?.length || 0) + (t.refundMismatch?.length || 0) + (t.stuckRefunds?.length || 0)

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    // 看板主数据 + 待处理计数并行；待处理任一失败不拖垮主看板（各自兜底 0）
    const [dash, oc, rc, inv] = await Promise.all([
      getDashboard(),
      orderCounts().catch(() => ({})),
      refundCounts().catch(() => ({})),
      listInventory().catch(() => []),
    ])
    data.value = dash
    const lowStock = inv.filter((d) => d.stock != null && d.stock <= (d.threshold ?? 10)).length
    todo.value = {
      ship: oc.paid || 0,
      refund: rc.applied || 0,
      lowStock,
      money: txAlertCount(dash.txAlerts),
    }
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const TODOS = computed(() => [
  { key: 'ship', label: '待发货', n: todo.value.ship, to: '/orders', tone: 'warn' },
  { key: 'refund', label: '待审退款', n: todo.value.refund, to: '/refunds', tone: 'warn' },
  { key: 'lowStock', label: '低库存 / 售罄', n: todo.value.lowStock, to: '/inventory', tone: 'red' },
  { key: 'money', label: '钱链告警', n: todo.value.money, to: '/orders', tone: 'red' },
])
const todoTotal = computed(() => TODOS.value.reduce((s, t) => s + t.n, 0))

const fmtTime = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const rate = (a, b) => (b ? Math.round((a / b) * 100) : 0)
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>数据看板</h1>
        <p class="sub">经营与学习数据一屏总览 · 待处理项可直接点进去处理</p>
      </div>
      <button class="btn ghost" @click="init">↻ 刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">数据看板需云端模式。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">统计中…</p>

    <template v-else-if="data">
      <!-- 待处理行动条：数字点进对应页 -->
      <section class="todobar">
        <div
          v-for="t in TODOS"
          :key="t.key"
          class="todo"
          :class="[t.tone, { active: t.n > 0 }]"
          @click="router.push(t.to)"
        >
          <div class="todo-n">{{ t.n }}</div>
          <div class="todo-l">{{ t.label }}</div>
        </div>
        <p v-if="!todoTotal" class="todo-clear">✓ 当前没有待处理事项</p>
      </section>

      <!-- 钱链告警明细（钱事·保留具体单号与处理去向；三类都空则不显示） -->
      <div v-if="todo.money > 0 && data.txAlerts" class="card txalerts">
        <h3>钱链告警待处理（{{ todo.money }}）</h3>
        <p v-if="data.txAlerts.feeMismatch.length" class="alert-line">
          支付金额异常单（去「订单发货」复核解除）：{{ data.txAlerts.feeMismatch.join('、') }}
        </p>
        <p v-if="data.txAlerts.refundMismatch.length" class="alert-line">
          退款通知不符（去商户平台核对流水）：{{ data.txAlerts.refundMismatch.join('、') }}
        </p>
        <p v-if="data.txAlerts.stuckRefunds.length" class="alert-line">
          退款已触发超 1 小时未回调（商户平台查退款进度）：{{ data.txAlerts.stuckRefunds.join('、') }}
        </p>
      </div>

      <div class="cards">
        <div class="stat card">
          <div class="num">{{ data.stats.users }}</div>
          <div class="lbl">小程序用户</div>
        </div>
        <div class="stat card">
          <div class="num">{{ data.stats.orders }}</div>
          <div class="lbl">
            订单数 · 合计 ￥{{ data.stats.gmv.toFixed(0) }}
            <span v-if="data.approx?.gmv" class="dim">（近 {{ data.approx.sampleSize }} 单估算）</span>
          </div>
        </div>
        <div class="stat card">
          <div class="num">{{ data.stats.codesActivated }}<span class="dim">/{{ data.stats.codesTotal }}</span></div>
          <div class="lbl">激活码已激活 · 激活率 {{ rate(data.stats.codesActivated, data.stats.codesTotal) }}%</div>
          <div class="bar"><i :style="{ width: rate(data.stats.codesActivated, data.stats.codesTotal) + '%' }" /></div>
        </div>
        <div class="stat card">
          <div class="num">{{ data.stats.learners }}</div>
          <div class="lbl">在学学员（有观看进度）</div>
        </div>
      </div>

      <div class="cols">
        <div class="card col">
          <h3>热点 · 最多人看完的段</h3>
          <p v-if="data.approx?.hot" class="note">数据量大，下列为近 {{ data.approx.sampleSize }} 条样本估算</p>
          <p v-if="!data.hot.length" class="empty">还没有观看数据</p>
          <div v-for="(h, i) in data.hot" :key="h.segId" class="row">
            <span class="rank">{{ i + 1 }}</span>
            <span class="name">{{ h.name }}</span>
            <b class="count">{{ h.count }} 人看完</b>
          </div>
        </div>
        <div class="card col">
          <h3>卡点 · 最多人停留的段</h3>
          <p class="note">学员最后看到的位置——集中卡在哪段，哪段就值得重讲或加求助引导</p>
          <p v-if="data.approx?.stuck" class="note">数据量大，下列为近 {{ data.approx.sampleSize }} 条样本估算</p>
          <p v-if="!data.stuck.length" class="empty">还没有观看数据</p>
          <div v-for="(h, i) in data.stuck" :key="h.segId" class="row">
            <span class="rank warn">{{ i + 1 }}</span>
            <span class="name">{{ h.name }}</span>
            <b class="count">{{ h.count }} 人停在这</b>
          </div>
        </div>
      </div>

      <div class="card col recent">
        <h3>最近订单</h3>
        <p v-if="!data.recentOrders.length" class="empty">还没有订单</p>
        <div v-for="o in data.recentOrders" :key="o.id" class="row">
          <span class="name">{{ o.summary || o.id }}</span>
          <span class="time">{{ fmtTime(o.createdAt) }}</span>
          <b class="count">￥{{ Number(o.amount).toFixed(2) }}</b>
        </div>
      </div>

      <p class="defer">趋势曲线 / 时间范围 / 经营漏斗（访问→加购→下单→支付→激活→完课）需事件时序聚合，待后续接入。</p>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
h1 {
  font-size: 22px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--content-2);
}
.todobar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
  position: relative;
}
.todo {
  border: 1px solid var(--line);
  background: var(--white);
  border-radius: 12px;
  padding: 14px 18px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.todo:hover {
  border-color: var(--purple-line);
}
.todo-n {
  font-size: 26px;
  font-weight: 700;
  color: var(--content-2);
  line-height: 1.1;
}
.todo-l {
  font-size: 12px;
  color: var(--content-2);
  margin-top: 3px;
}
.todo.active.warn {
  background: #fdf6ec;
  border-color: #f0ddc0;
}
.todo.active.warn .todo-n {
  color: #8a6420;
}
.todo.active.red {
  background: #fdf0ef;
  border-color: #f0c8c5;
}
.todo.active.red .todo-n {
  color: var(--red);
}
.todo-clear {
  position: absolute;
  right: 2px;
  top: -22px;
  margin: 0;
  font-size: 12px;
  color: var(--green);
}
.txalerts {
  padding: 14px 20px;
  margin-bottom: 18px;
  border-color: #f0c8c5;
  background: #fdf0ef;
}
.txalerts h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--ink);
}
.alert-line {
  margin: 4px 0;
  font-size: 12.5px;
  color: var(--red);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}
.stat {
  padding: 18px 20px;
}
.num {
  font-size: 28px;
  font-weight: 700;
  color: var(--ink);
}
.dim {
  font-size: 16px;
  color: var(--content-2);
  font-weight: 400;
}
.lbl {
  font-size: 12px;
  color: var(--content-2);
  margin-top: 4px;
}
.bar {
  margin-top: 10px;
  height: 5px;
  border-radius: 3px;
  background: var(--bg-grey);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--brand);
  border-radius: 3px;
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.col {
  padding: 16px 20px;
}
.col h3 {
  font-size: 13.5px;
  color: var(--ink);
  margin: 0 0 10px;
}
.recent {
  margin-top: 18px;
}
.note {
  font-size: 11px;
  color: var(--content-2);
  margin: -4px 0 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-top: 1px solid var(--line);
  font-size: 12.5px;
}
.rank {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  color: var(--brand-active);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.rank.warn {
  background: #fdf6ec;
  border-color: #f0ddc0;
  color: #8a6420;
}
.name {
  flex: 1;
  min-width: 0;
  color: var(--content);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.count {
  flex: 0 0 auto;
  color: var(--ink);
  font-size: 12px;
}
.time {
  font-size: 11px;
  color: var(--content-2);
}
.empty {
  font-size: 12px;
  color: var(--content-2);
  padding: 10px 0;
}
.defer {
  margin: 18px 0 0;
  font-size: 11px;
  color: var(--content-2);
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
