<script setup>
/**
 * 客户 360 侧栏（B2·scoped 版·follow-up ①）：按**会话**调 getSessionCustomer360（外包唯一 360 读路径·
 * cap agent:handle·后端双闸：分配 scope assertOwnedByAgent + 数据共享同意 assertDataShareConsent + 强制审计留痕）。
 * 通用渲染 panels 数组（铁律三·后端给什么面板渲什么·不硬编码面板类型），与 admin Customer360.vue 同构。
 * 身份桥接（kfIdentity）未建时 openid 为 null → 后端回 NO_BRIDGE（真实存在的状态·根因#8·如实提示）；
 * 客户未同意数据共享 → NO_CONSENT（fail-closed·如实提示坐席·不静默空白）。
 */
import { ref, watch } from 'vue'
import { getSessionCustomer360 } from '@/api/agentApi.js'

const props = defineProps({ session: { type: Object, default: null } }) // SessionView（null=未接入会话）

const panels = ref([])
const loading = ref(false)
const err = ref('')

// 字段中文名（通用渲染友好名·未知字段回退原始 key·与 admin 同一 LABELS）
const LABELS = {
  orderCount: '订单数', ordersCapped: '订单超采样', paidCount: '已付单', totalSpent: '总消费(元)',
  activatedCount: '激活课程', enteredCount: '已进课', enterRate: '进课率(%)', lastActiveAt: '最近活跃',
  count: '数量', capped: '超采样', status: '状态', amount: '金额(元)', createdAt: '时间',
  itemCount: '件数', trackingNo: '运单号', id: '单号', courseId: '课程', code: '激活码',
  activated: '已激活', entered: '已进课', enteredAt: '进课时间', orders: '订单', activations: '激活/课程',
}
const fieldLabel = (k) => LABELS[k] || k

const fmtTime = (ms) => {
  if (!ms && ms !== 0) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const isObj = (v) => v && typeof v === 'object'
const scalarEntries = (data) => (isObj(data) ? Object.entries(data).filter(([, v]) => !Array.isArray(v) && !isObj(v)) : [])
const arrayEntries = (data) => (isObj(data) ? Object.entries(data).filter(([, v]) => Array.isArray(v)) : [])
function fmtVal(k, v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (/At$/.test(k) && typeof v === 'number') return fmtTime(v)
  return String(v)
}

// 后端拒绝态 → 坐席可读的解释（如实提示·不静默空白）
const DENY_HINTS = {
  NO_BRIDGE: '该会话尚未建立身份桥接（客户未登录小程序 / kfIdentity 未建），暂无法关联客户档案。',
  NO_CONSENT: '该客户尚未同意向受托客服共享数据（隐私保护），档案不可见——如需核单请「升级转商户」处理。',
  FORBIDDEN: '只能查看自己认领会话的客户档案。',
}
const denied = ref('')

async function load(session) {
  panels.value = []
  err.value = ''
  denied.value = ''
  if (!session || !session.sessionId) return
  loading.value = true
  try {
    const r = await getSessionCustomer360(session.sessionId)
    if (r && r.ok) panels.value = r.panels || []
    else denied.value = DENY_HINTS[r && r.error] || '暂时取不到该客户档案。'
  } catch (e) {
    err.value = '加载 360 失败：' + e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.session, (v) => load(v), { immediate: true })
</script>

<template>
  <section class="c360">
    <h3 class="s-title">客户 360</h3>
    <p v-if="!session" class="hint">认领会话后，这里显示对应客户的档案（订单 / 激活课程 / 学习位置）。</p>
    <p v-else-if="err" class="hint warn">{{ err }}</p>
    <p v-else-if="loading" class="muted">加载中…</p>
    <p v-else-if="denied" class="hint">{{ denied }}</p>
    <p v-else-if="!panels.length" class="hint">未找到该客户的档案数据。</p>

    <div v-else class="panels">
      <article v-for="panel in panels" :key="panel.key" class="panel">
        <h4 class="p-title">{{ panel.label }}</h4>
        <p v-if="panel.error" class="p-err">这个板块暂时取不到（{{ panel.error }}）</p>
        <template v-else>
          <div v-if="scalarEntries(panel.data).length" class="kv">
            <div v-for="[k, v] in scalarEntries(panel.data)" :key="k" class="kv-item">
              <span class="kv-k">{{ fieldLabel(k) }}</span>
              <span class="kv-v">{{ fmtVal(k, v) }}</span>
            </div>
          </div>
          <div v-for="[name, list] in arrayEntries(panel.data)" :key="name" class="sub">
            <p class="sub-cap">{{ fieldLabel(name) }}（{{ list.length }}）</p>
            <p v-if="!list.length" class="muted small">暂无</p>
            <ul v-else class="rows">
              <li v-for="(row, i) in list" :key="i" class="rowcard">
                <span v-for="[k, v] in scalarEntries(row)" :key="k" class="cell"><em>{{ fieldLabel(k) }}</em>{{ fmtVal(k, v) }}</span>
              </li>
            </ul>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>

<style scoped>
.c360 {
  padding: 14px 14px 6px;
}
.s-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.muted {
  color: var(--content-2);
  font-size: 12px;
}
.small {
  font-size: 11.5px;
}
.hint {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  color: var(--content-2);
  line-height: 1.6;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
.panels {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.panel {
  border: 1px solid var(--line);
  border-radius: 11px;
  padding: 12px 13px;
  background: var(--white);
}
.p-title {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--ink);
}
.p-err {
  margin: 0;
  font-size: 12px;
  color: var(--red);
}
.kv {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.kv-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  background: var(--bg-lilac);
  border-radius: 8px;
}
.kv-k {
  font-size: 10.5px;
  color: var(--content-2);
}
.kv-v {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.sub {
  margin-top: 12px;
}
.sub-cap {
  margin: 0 0 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--purple-meta);
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.rowcard {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 12px;
  color: var(--content);
}
.cell {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}
.cell em {
  font-style: normal;
  font-size: 10.5px;
  color: var(--content-2);
}
</style>
