<script setup>
/**
 * 数据看板（规格 §八 路线收官）：经营与学习数据的聚合视图。
 * 数据源全在云端既有集合：users / orders / qrcodes / progress（trackEvent 折叠）/ courses。
 * 热点 = 看完次数最多的段；卡点 = 学员「最后停留」次数最多的段——选题与重制的依据。
 */
import { ref, computed } from 'vue'
import { cloudMode, getDashboard } from '@/api/cloud.js'

const data = ref(null)
// 交易异常合计（旧版云函数无 txAlerts 字段时安全为 0）
const txAlertCount = computed(() => {
  const t = data.value?.txAlerts
  if (!t) return 0
  return (t.feeMismatch?.length || 0) + (t.refundMismatch?.length || 0) + (t.stuckRefunds?.length || 0)
})
const loading = ref(true)
const loadErr = ref('')

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  try {
    data.value = await getDashboard()
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const fmtTime = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const rate = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—')
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>数据看板</h1>
        <p class="sub">经营与学习数据一屏总览 · 热点 / 卡点来自学员真实观看记录</p>
      </div>
      <button class="btn ghost" @click="((loading = true), init())">↻ 刷新</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">数据看板需云端模式。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">统计中…</p>

    <template v-else-if="data">
      <div class="cards">
        <div class="stat card">
          <div class="num">{{ data.stats.users }}</div>
          <div class="lbl">小程序用户</div>
        </div>
        <div class="stat card">
          <div class="num">{{ data.stats.orders }}</div>
          <div class="lbl">订单数 · 合计 ￥{{ data.stats.gmv.toFixed(0) }}</div>
        </div>
        <div class="stat card">
          <div class="num">{{ data.stats.codesActivated }}<span class="dim">/{{ data.stats.codesTotal }}</span></div>
          <div class="lbl">激活码已激活 · 激活率 {{ rate(data.stats.codesActivated, data.stats.codesTotal) }}</div>
        </div>
        <div class="stat card">
          <div class="num">{{ data.stats.learners }}</div>
          <div class="lbl">在学学员（有观看进度）</div>
        </div>
      </div>

      <!-- 交易异常（查询即对账）：三类都为空 = 资金链路健康；旧版云函数无此字段时不显示 -->
      <div v-if="txAlertCount > 0" class="card txalerts warn-card">
        <h3>⚠️ 交易异常待处理（{{ txAlertCount }}）</h3>
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
      <div v-else-if="data.txAlerts" class="card txalerts ok-card">
        ✅ 交易链路无异常（支付金额 / 退款核验 / 退款回调均正常）
      </div>

      <div class="cols">
        <div class="card col">
          <h3>🔥 热点 · 最多人看完的段</h3>
          <p v-if="!data.hot.length" class="empty">还没有观看数据</p>
          <div v-for="(h, i) in data.hot" :key="h.segId" class="row">
            <span class="rank">{{ i + 1 }}</span>
            <span class="name">{{ h.name }}</span>
            <b class="count">{{ h.count }} 人看完</b>
          </div>
        </div>
        <div class="card col">
          <h3>🧗 卡点 · 最多人停留的段</h3>
          <p class="note">学员最后看到的位置——集中卡在哪段，哪段就值得重讲或加求助引导</p>
          <p v-if="!data.stuck.length" class="empty">还没有观看数据</p>
          <div v-for="(h, i) in data.stuck" :key="h.segId" class="row">
            <span class="rank warn">{{ i + 1 }}</span>
            <span class="name">{{ h.name }}</span>
            <b class="count">{{ h.count }} 人停在这</b>
          </div>
        </div>
      </div>

      <div class="card col" style="margin-top: 18px">
        <h3>🧾 最近订单</h3>
        <p v-if="!data.recentOrders.length" class="empty">还没有订单</p>
        <div v-for="o in data.recentOrders" :key="o.id" class="row">
          <span class="name">{{ o.summary || o.id }}</span>
          <span class="time">{{ fmtTime(o.createdAt) }}</span>
          <b class="count">￥{{ Number(o.amount).toFixed(2) }}</b>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
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
.txalerts {
  padding: 14px 20px;
  margin-bottom: 18px;
}
.txalerts h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.warn-card {
  border-color: #f0c8c5;
  background: #fdf0ef;
}
.warn-card .alert-line {
  margin: 4px 0;
  font-size: 12.5px;
  color: var(--red);
}
.ok-card {
  font-size: 12.5px;
  color: var(--content-2);
}
</style>
