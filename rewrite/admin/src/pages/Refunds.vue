<script setup lang="ts">
// 售后退款（design/console.pen S10 视觉 + 退款决策抽屉·M3 UI 批4）：chip 计数走云端 refundCounts、
// grid 列表、右滑决策抽屉——把「退货权判据」摆到决策位（激活码/进课状态取 getRefundDetail 真判据·
// 根因#8 不伪造徽章）。同意由「人工验收」勾选闸放行，服务端 approveRefund 仍权威复核（进课即拒/降级）。
import { ref, computed, onMounted } from 'vue'
import { RefreshCw, Search, X, CircleCheck, Ticket, GraduationCap, Check } from 'lucide-vue-next'
import { listRefunds, refundCounts, approveRefund, rejectRefund, getRefundDetail } from '../api/money'
import UiButton from '../components/ui/Button.vue'
import { mapRefundRows, refundVerdict, type RefundRowVM, type RefundVerdictVM } from '../lib/mapMoney'
import { useLatest } from '../lib/latest'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const TABS = [
  { key: 'applied', label: '待审核' },
  { key: 'approved', label: '退款处理中' },
  { key: 'refunded', label: '已退款' },
  { key: 'rejected', label: '已拒绝' },
  { key: '', label: '全部' },
]

const tab = ref('applied')
const counts = ref<Record<string, number>>({})
const rows = ref<RefundRowVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const message = ref('')
const busy = ref(false)
const search = ref('') // 搜索框输入
const activeQ = ref('') // 已提交搜索词（空=按标签·跨全部状态服务端命中）

interface Verdict {
  loading: boolean
  activated: boolean
  entered: boolean
  code: string
  courseId: string
  lineRefundable: boolean // 本单此行真实可退性（P2·判据绑单·非课程级）
  refundableQty: number | null
  lineFound: boolean
}
const decideRow = ref<RefundRowVM | null>(null)
const verdict = ref<Verdict | null>(null)
const checkPkg = ref(false)
const checkCard = ref(false)
const rejecting = ref(false)
const rejectReason = ref('')
const actionMsg = ref('') // 审批结果（成功·持久·reload 不清·别一闪而过）
const decideErr = ref('') // 同意/拒绝失败原因（抽屉内红条·不被 reload 的"加载中"吞·P2·根因#14）

// 列表页脚分母＝当前标签计数（换皮恒用 counts.all·在「待审核」栏也显全量总数·误导）
const tabTotal = computed(() => counts.value[tab.value || 'all'])
const canApprove = computed(() => !!decideRow.value?.canDecide && checkPkg.value && checkCard.value && !busy.value)
// 判据文案绑本单订单行（P2·根因#8 不失真）：以 lineRefundable 为准，不被课程级激活误导
const verdictVM = computed<RefundVerdictVM | null>(() =>
  verdict.value && !verdict.value.loading
    ? refundVerdict({ lineRefundable: verdict.value.lineRefundable, entered: verdict.value.entered, refundableQty: verdict.value.refundableQty })
    : null
)

const listGen = useLatest() // 列表乱序守卫（P2·快切标签/搜索时旧结果别覆盖新标签·根因#8）
const reloading = ref(false) // reload 专属在途标志（迭代G·单写布尔·more 加载闸不再靠脆弱 message 文案）
async function reload() {
  message.value = '加载中…'
  reloading.value = true
  const my = listGen.begin()
  const [r, c] = await Promise.all([listRefunds(tab.value, undefined, 20, activeQ.value), refundCounts()])
  if (listGen.isStale(my)) return // 已切别标签/搜索·丢弃过期列表（由更新的 reload 负责复位 reloading）
  reloading.value = false // 本次是最新·加载完成
  if ((r as any).error === 'SESSION_LOST') return
  rows.value = r.ok ? mapRefundRows((r as any).list) : []
  cursor.value = r.ok ? (r as any).nextCursor : null
  hasMore.value = !!(r.ok && (r as any).hasMore)
  if (c.ok && c.counts) counts.value = c.counts as Record<string, number>
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

// 加载更多（游标分页·根因#7·换皮丢了这个·退款首页 20 条封顶·第 21 单起翻不到）
async function more() {
  if (!hasMore.value || cursor.value == null) return
  if (reloading.value) return // reload 在途时不翻页（cursor 还是旧的·会跳页）——覆盖 reload 先于 more 的序（单写布尔）
  const gen = listGen.peek() // 绑定当前 reload 代际·不递增（不反噬在途 reload）·任何新 reload 会作废本页（迭代F 逮出）
  const r = await listRefunds(tab.value, cursor.value, 20, activeQ.value)
  if (listGen.isStale(gen)) return // 期间发生过 reload·放弃本页（防混排 + 游标跳页）
  if (!r.ok) return
  const seen = new Set(rows.value.map((x) => x.id))
  rows.value = [...rows.value, ...mapRefundRows((r as any).list).filter((x) => !seen.has(x.id))]
  cursor.value = (r as any).nextCursor
  hasMore.value = !!(r as any).hasMore
}

function pickTab(k: string) {
  tab.value = k
  search.value = ''
  activeQ.value = '' // 切标签退出搜索
  void reload()
}
function doSearch() {
  const t = search.value.trim()
  if (t === activeQ.value) return
  activeQ.value = t
  void reload()
}
function clearSearch() {
  if (!activeQ.value && !search.value) return
  search.value = ''
  activeQ.value = ''
  void reload()
}

const detailGen = useLatest() // 退货权判据乱序守卫（P1·A 单在途详情别盖到 B 单抽屉·根因#8）
async function openDecide(row: RefundRowVM) {
  decideRow.value = row
  checkPkg.value = false
  checkCard.value = false
  rejecting.value = false
  rejectReason.value = ''
  decideErr.value = ''
  verdict.value = { loading: true, activated: false, entered: false, code: '', courseId: '', lineRefundable: true, refundableQty: null, lineFound: false }
  const my = detailGen.begin()
  const r = await getRefundDetail(row.id)
  if (detailGen.isStale(my) || decideRow.value?.id !== row.id) return // 抽屉已切别单·丢弃过期详情（防判据错配）
  const a = (r as any)?.activation || {}
  verdict.value = {
    loading: false,
    activated: !!a.activated,
    entered: !!a.entered,
    code: String(a.code || ''),
    courseId: String(a.courseId || ''),
    lineRefundable: (r as any)?.lineRefundable !== false, // 缺字段/老后端默认可退（不误判会拦）
    refundableQty: (r as any)?.refundableQty ?? null,
    lineFound: !!(r as any)?.lineFound,
  }
}
function closeDecide() {
  decideRow.value = null
}

async function doApprove() {
  const row = decideRow.value
  if (!row || !canApprove.value || busy.value) return // 在途禁再发·防双击重复触发退款（同 doReject）
  const targetId = row.id // 请求发起时捕获目标单号（P2·根因#8）：回包迟到时抽屉可能已被管理员切到别单
  busy.value = true
  decideErr.value = ''
  const r = await approveRefund(row.id)
  busy.value = false
  const stillHere = decideRow.value?.id === targetId // 回包只在「当前抽屉仍是该单」时才动它——避免关掉管理员已另开的抽屉、把错误挂错单
  if (r.ok) {
    actionMsg.value = `✓ 已受理退款 ${row.orderId}，等微信回调确认到账`
    if (stillHere) closeDecide()
    void reload() // 列表真值刷新与抽屉是否仍是该单无关·恒执行
  } else if (stillHere) {
    // 失败：不关抽屉、不刷新——真实原因留在眼前（P2·根因#14 admin 侧·别被 reload 的"加载中…"盖掉）；
    // 若抽屉已切别单则不挂错误（P2·根因#8）
    decideErr.value = `退款触发失败：${String(r.error || '未知错误')}`
  }
}

async function doReject() {
  const row = decideRow.value
  if (!row || busy.value) return
  if (!rejectReason.value.trim()) {
    decideErr.value = '拒绝必须写原因（会展示给买家）'
    return
  }
  const targetId = row.id // 请求发起时捕获目标单号（P2·根因#8）：回包迟到时抽屉可能已被管理员切到别单
  busy.value = true
  decideErr.value = ''
  const r = await rejectRefund(row.id, rejectReason.value.trim())
  busy.value = false
  const stillHere = decideRow.value?.id === targetId
  if (r.ok) {
    actionMsg.value = `已拒绝退款 ${row.orderId}`
    if (stillHere) closeDecide()
    void reload()
  } else if (stillHere) {
    // 失败：留抽屉 + 红条（同 doApprove·不被刷新吞）；若抽屉已切别单则不挂错误
    decideErr.value = '拒绝没成功：' + String(r.error || '')
  }
}

onMounted(reload)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="售后退款" sub="先收到寄回包装并验收（激活卡未拆用）再同意 · 同意后原路退回微信支付">
      <UiButton variant="ghost" size="sm" :disabled="message === '加载中…'" @click="reload">
        <RefreshCw :size="14" :stroke-width="1.8" /><span>刷新</span>
      </UiButton>
    </PageHeader>

    <!-- 状态 tab（云端实时计数徽章·沿用 TABS/pickTab） -->
    <div class="tabs-wrap">
      <div class="ld-toolbar">
        <button v-for="t in TABS" :key="t.key" class="ld-chip" :class="{ on: tab === t.key }" @click="pickTab(t.key)">
          <span>{{ t.label }}</span>
          <span v-if="counts[t.key || 'all'] != null" class="chip-n">{{ counts[t.key || 'all'] }}</span>
        </button>
      </div>
      <p class="note">状态计数为云端实时总数、切换状态走服务端筛选、搜索按订单号跨全部状态精确命中——都不受当前分页影响。</p>
    </div>

    <!-- 审批结果横幅（成功·持久·root gap 内独立行） -->
    <p v-if="actionMsg" class="action-msg">{{ actionMsg }}<button class="link" @click="actionMsg = ''">知道了</button></p>
    <p v-if="message" class="ld-status">{{ message }}</p>

    <Card flush>
      <div class="bar">
        <div class="ld-search">
          <Search :size="15" :stroke-width="1.8" />
          <input v-model="search" placeholder="搜索订单号（精确·跨全部状态）" @keyup.enter="doSearch" />
        </div>
        <UiButton size="sm" @click="doSearch">搜索</UiButton>
      </div>
      <div v-if="activeQ" class="searching">
        搜索订单号「<b>{{ activeQ }}</b>」的结果（跨全部状态）
        <button class="link" @click="clearSearch">清除搜索</button>
      </div>

      <template v-if="rows.length">
        <div class="ld-thead">
          <div class="ld-th" :style="{ width: '176px' }">订单</div>
          <div class="ld-th" :style="{ width: '120px' }">申请时间</div>
          <div class="ld-th grow">退款商品 / 原因</div>
          <div class="ld-th r" :style="{ width: '116px' }">退款额</div>
          <div class="ld-th" :style="{ width: '112px' }">状态</div>
          <div class="ld-th r" :style="{ width: '144px' }">操作</div>
        </div>
        <div class="ld-tbody">
          <div v-for="row in rows" :key="row.id" class="ld-tr">
            <div class="ld-td" :style="{ width: '176px' }">
              <div class="oid-cell">
                <span class="oid">{{ row.orderId }}</span>
                <small v-if="row.buyerName || row.buyerMasked" class="buyer">{{ row.buyerName }} {{ row.buyerMasked }}</small>
              </div>
            </div>
            <div class="ld-td time" :style="{ width: '120px' }">{{ row.timeLabel }}</div>
            <div class="ld-td grow">
              <div class="what">
                <div class="what-goods">{{ row.what }}</div>
                <div class="what-reason">原因：{{ row.reason || '—' }}</div>
              </div>
            </div>
            <div class="ld-td r amount" :style="{ width: '116px' }">退 {{ row.refundAmountLabel }}</div>
            <div class="ld-td" :style="{ width: '112px' }">
              <Badge :tone="row.status === 'refunded' ? 'green' : row.status === 'rejected' ? 'red' : row.status === 'approved' ? 'brand' : row.status === 'applied' ? 'amber' : 'neutral'">
                {{ row.statusLabel }}
              </Badge>
            </div>
            <div class="ld-td r ops" :style="{ width: '144px' }">
              <UiButton v-if="row.canDecide" size="sm" @click="openDecide(row)">
                <Check :size="14" :stroke-width="2" /><span>审核</span>
              </UiButton>
              <UiButton v-else variant="ghost" size="sm" @click="openDecide(row)">查看</UiButton>
            </div>
          </div>
        </div>
        <div class="tfoot">
          <span>已加载 {{ rows.length }} 单{{ !activeQ && tabTotal != null ? ' / ' + tabTotal + ' 单（本栏）' : '' }}</span>
          <UiButton v-if="hasMore" variant="ghost" size="sm" @click="more">加载更多</UiButton>
        </div>
      </template>
      <EmptyState v-else-if="!message" :text="activeQ ? '没有匹配该订单号的售后单' : '这一栏没有售后单'" />
    </Card>

    <div v-if="decideRow" class="drawer-mask" @click.self="closeDecide">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">{{ decideRow.canDecide ? '退款审核' : '退款详情' }}</div>
            <div class="drawer-oid">订单 {{ decideRow.orderId }}</div>
          </div>
          <button class="drawer-close" @click="closeDecide"><X :size="16" :stroke-width="1.8" /></button>
        </div>

        <div class="summary">
          <div class="srow"><span>退款商品</span><strong>{{ decideRow.what }}</strong></div>
          <div class="srow"><span>退款金额</span><strong>{{ decideRow.refundAmountLabel }}</strong></div>
          <!-- 收货人（换皮丢·联系买家核对寄回/退货）：抽屉给全号 -->
          <div v-if="decideRow.buyerName || decideRow.buyerPhone" class="srow"><span>收货人</span><span class="sval">{{ decideRow.buyerName || '—' }} · {{ decideRow.buyerPhone || '（无电话）' }}</span></div>
          <div class="srow"><span>买家原因</span><span class="sval">{{ decideRow.reason || '—' }}</span></div>
        </div>

        <!-- 结果区（已退款/已拒绝单·换皮丢了这块）：到账时间 / 拒绝原因 -->
        <div v-if="decideRow.refundedAtLabel || decideRow.rejectReason" class="result" :class="decideRow.status">
          <template v-if="decideRow.refundedAtLabel">✓ 已原路退回微信 · 到账 {{ decideRow.refundedAtLabel }}</template>
          <template v-else>✕ 已拒绝 · 原因：{{ decideRow.rejectReason }}</template>
        </div>

        <div v-if="verdictVM" class="verdict" :class="verdictVM.tone">
          <CircleCheck :size="20" :stroke-width="1.8" />
          <div>
            <div class="verdict-t">{{ verdictVM.title }}</div>
            <div class="verdict-s">{{ verdictVM.sub }}</div>
          </div>
        </div>
        <p v-else-if="verdict" class="verdict-loading">判据加载中…</p>

        <div class="crit-label">退货权判据（云端真数据）</div>
        <div v-if="verdict && !verdict.loading" class="crits">
          <div class="crit">
            <div class="crit-l">
              <div class="crit-ib"><Ticket :size="15" :stroke-width="1.8" /></div>
              <div>
                <div class="crit-a">激活码</div>
                <div class="crit-b">{{ verdict.code || '未绑定' }}</div>
              </div>
            </div>
            <span class="crit-chip" :class="verdict.activated ? 'bad' : 'good'">{{ verdict.activated ? '已激活' : '未使用' }}</span>
          </div>
          <div class="crit">
            <div class="crit-l">
              <div class="crit-ib"><GraduationCap :size="15" :stroke-width="1.8" /></div>
              <div>
                <div class="crit-a">这门课进课（课程级）</div>
                <div class="crit-b">{{ verdict.courseId || '—' }} · 是否拦本单看上方判据</div>
              </div>
            </div>
            <span class="crit-chip" :class="verdict.entered ? 'note' : 'good'">{{ verdict.entered ? '已进课' : '未进课' }}</span>
          </div>
        </div>

        <!-- 同意/拒绝失败原因（P2·不被刷新的"加载中"吞·留在眼前直到重试或关抽屉） -->
        <p v-if="decideErr" class="decide-err">{{ decideErr }}</p>

        <template v-if="decideRow.canDecide && !rejecting">
          <div class="crit-label">人工验收（勾选后才可同意）</div>
          <label class="ck"><input v-model="checkPkg" type="checkbox" /><span>已收到买家寄回包装并验收</span></label>
          <label class="ck"><input v-model="checkCard" type="checkbox" /><span>激活卡未拆封 / 未使用</span></label>
          <div class="drawer-foot">
            <UiButton variant="primary" size="lg" block :disabled="!canApprove" @click="doApprove">
              <CircleCheck :size="16" :stroke-width="1.8" /><span>{{ busy ? '受理中…' : '同意退款 · 原路退回 ' + decideRow.refundAmountLabel }}</span>
            </UiButton>
            <UiButton variant="ghost" size="lg" block @click="rejecting = true">拒绝退款（需填原因）</UiButton>
          </div>
        </template>

        <template v-else-if="decideRow.canDecide && rejecting">
          <div class="crit-label">拒绝原因（买家可见·必填）</div>
          <textarea v-model="rejectReason" maxlength="100" rows="3" placeholder="如：激活卡已拆用，不符合退货规则" />
          <div class="drawer-foot">
            <UiButton variant="danger" size="lg" block :disabled="busy" @click="doReject">确认拒绝</UiButton>
            <UiButton variant="ghost" size="lg" block @click="rejecting = false">返回</UiButton>
          </div>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* 状态 tab 组：chips + 说明行（间距小于 root gap·成一组） */
.tabs-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
/* chip 内嵌数字徽章（design：bg-grey·激活时 brand·圆角99·小字） */
.chip-n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
  font-size: 11px;
  font-weight: 600;
}
.ld-chip.on .chip-n {
  background: var(--ld-brand);
  color: #fff;
}

/* 审批结果横幅（成功·绿底） */
.action-msg {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 13px;
  color: var(--ld-green);
  background: var(--ld-bg-green-soft);
  padding: 10px 14px;
  border-radius: var(--ld-radius);
}
.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--ld-brand);
  cursor: pointer;
  font-size: 12px;
}
.searching .link {
  margin-left: 10px;
}

/* 表格卡内：搜索条 + 搜索结果说明（flush 卡自管内边距） */
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
}
.searching {
  padding: 0 16px 12px;
  font-size: 12.5px;
  color: var(--ld-content);
}

/* 表格 cell 内容（容器/表头/行走 console.css 的 ld-table 系） */
.r {
  justify-content: flex-end;
  text-align: right;
}
.oid-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.oid {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
  color: var(--ld-ink);
}
.buyer {
  font-size: 11px;
  color: var(--ld-content-2);
}
.time {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.what {
  min-width: 0;
}
.what-goods {
  color: var(--ld-content);
}
.what-reason {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.amount {
  font-weight: 700;
  color: var(--ld-ink);
}
.ops {
  gap: 6px;
}
.tfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}

/* 决策抽屉（本页独有浮层·web 端无需 touchmove 锁） */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 15, 30, 0.28);
  display: flex;
  justify-content: flex-end;
  z-index: 40;
}
.drawer {
  width: 420px;
  max-width: 94vw;
  height: 100%;
  background: var(--ld-bg);
  border-left: 1px solid var(--ld-line);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  animation: slidein 0.18s ease;
}
@keyframes slidein {
  from {
    transform: translateX(24px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.drawer-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--ld-ink);
}
.drawer-oid {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.drawer-close {
  display: flex;
  padding: 6px;
  border: none;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-grey);
  color: var(--ld-content-2);
  cursor: pointer;
}
.summary {
  padding: 14px;
  background: var(--ld-bg-lilac);
  border-radius: var(--ld-radius);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.srow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
.srow > span:first-child {
  color: var(--ld-content-2);
  flex: none;
}
.srow strong {
  color: var(--ld-ink);
}
.sval {
  color: var(--ld-content);
  text-align: right;
}
.result {
  padding: 11px 14px;
  border-radius: var(--ld-radius);
  font-size: 12.5px;
  font-weight: 600;
}
.result.refunded {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.result.rejected {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.verdict {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--ld-radius);
  border: 1px solid transparent;
}
.verdict.ok {
  background: var(--ld-bg-green-soft);
  border-color: var(--ld-green);
  color: var(--ld-green);
}
.verdict.lost {
  background: var(--ld-bg-red-soft);
  border-color: var(--ld-red-line);
  color: var(--ld-red);
}
.verdict-t {
  font-size: 13.5px;
  font-weight: 700;
}
.verdict-s {
  margin-top: 2px;
  font-size: 11.5px;
  opacity: 0.85;
}
.verdict-loading {
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.crit-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--ld-purple-meta);
  margin-top: 2px;
}
.crits {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.crit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
}
.crit-l {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.crit-ib {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-lilac);
  color: var(--ld-brand);
}
.crit-a {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-ink);
}
.crit-b {
  font-size: 10.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.crit-chip {
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}
.crit-chip.good {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.crit-chip.bad {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.crit-chip.note {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.decide-err {
  padding: 10px 12px;
  border-radius: var(--ld-radius);
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 12.5px;
  font-weight: 600;
  border: 1px solid var(--ld-red-line);
}
.ck {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  color: var(--ld-content);
  cursor: pointer;
}
.ck input {
  width: 16px;
  height: 16px;
  accent-color: var(--ld-brand);
}
.drawer-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}
textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius);
  font-size: 13px;
  font-family: var(--ld-font);
  resize: vertical;
  color: var(--ld-ink);
}
</style>
