<script setup lang="ts">
// 售后退款（design/console.pen S10 视觉 + 退款决策抽屉·M3 UI 批4）：chip 计数走云端 refundCounts、
// grid 列表、右滑决策抽屉——把「退货权判据」摆到决策位（激活码/进课状态取 getRefundDetail 真判据·
// 根因#8 不伪造徽章）。同意由「人工验收」勾选闸放行，服务端 approveRefund 仍权威复核（进课即拒/降级）。
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { RefreshCw, Search, X, CircleCheck, Ticket, GraduationCap, Check, ShieldAlert } from 'lucide-vue-next'
import { listRefunds, refundCounts, approveRefund, rejectRefund, getRefundDetail, listOrders, overrideRefund } from '../api/money'
import UiButton from '../components/ui/Button.vue'
import { mapRefundRows, refundVerdict, mapOverrideOrder, canOverrideRefund, type RefundRowVM, type RefundVerdictVM, type OverrideOrderVM } from '../lib/mapMoney'
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

// 深链预填（债目·全局清零bug战役残余 2026-07-13）：Dashboard 退款类告警「去处理」按钮
// router.push({path:'/refunds', query:{q}}) 跳转过来——挂载时读 route.query.q 预填搜索框并自动检索一次
// （服务端 q 搜索按订单号精确命中已有·同 Conversations.vue/Batches.vue 既有深链范式）。
const route = useRoute()
const tab = ref('applied')
const counts = ref<Record<string, number>>({})
const countsPartial = ref(false) // P2·bug sweep Round2 item14：某状态 .count() 失败时角标别把占位 0 当真值显示（同 Dashboard todoPartial 风格）
const rows = ref<RefundRowVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const message = ref('')
const busy = ref(false)
const search = ref(String(route.query.q || '')) // 搜索框输入（深链预填初值）
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
// 空栏提示（UX 体检批·死循环修复）：本栏空但别的栏有货时明说去处——曾让「已退款 4 单」的场景
// 落在初始「待审核 0」空白页、以为无事可做；counts 就在手边，不用额外请求
const emptyText = computed(() => {
  if (activeQ.value) return '没有匹配该订单号的售后单'
  // 计数不可信时不引用数字（终审 P1·病根#14）：countsPartial 时 counts 是上次成功加载的陈旧值，
  // 同屏 tab chip 已显「?」——这里再自信报「有 N 单」就是同屏自相矛盾的假话
  if (countsPartial.value) return '这一栏没有售后单（其他栏计数暂不可用，刷新后再看）'
  const others = TABS.filter((t) => t.key && t.key !== tab.value && (counts.value[t.key] || 0) > 0)
  if (!others.length) return '这一栏没有售后单'
  return '这一栏没有售后单——' + others.map((t) => `「${t.label}」有 ${counts.value[t.key]} 单`).join('、')
})
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
  countsPartial.value = c.ok ? !!(c as any).partial : true // 计数请求本身失败也按不可信处理（不误显陈旧/占位数字）
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
  if (!r.ok) {
    // 判据加载失败（网络/服务端）：r.ok=false 时无 activation/lineRefundable 字段，若照组 verdict 会渲成
    // 确定的绿色「未使用·可退」误导审核放行（P2·根因#14 失败必可观测/#8 不失真）。红条同 doApprove/doReject 范式。
    verdict.value = null // 判据区留空（模板据此显示「重新加载判据」重试入口）
    decideErr.value = '判据加载失败：' + String((r as any).error || '')
    return
  }
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

// —— 越规退款入口（决策§26·钱链后端零改动·cap refund:manage）——
// 后台工具区独立入口：按订单号查找 → 选行 → 必填原因 + 勾选知晓 → 提交 overrideRefund。
// 退货资格/退款金额一律服务端裁决（overrideRefund 只收 orderId/lineId/reason·前端不发明金额参数）。
const showOverride = ref(false)
const overrideOrderId = ref('') // 查找框输入
const overrideOrder = ref<OverrideOrderVM | null>(null) // 查到的目标订单（含可选行）
const overrideLineId = ref('') // 选中的商品行
const overrideReason = ref('') // 越规原因（必填·买家可见同 rejectRefund 口径）
const overrideAck = ref(false) // 「我已知晓此操作越过常规售后流程」勾选
const overrideBusy = ref(false)
const overrideFindMsg = ref('') // 查找态提示（查找中/未找到/查找失败）
const overrideResultMsg = ref('') // 提交结果（成功/失败）

// 按钮门控纯函数复用（mapMoney.canOverrideRefund）：与单测同一判据，不在页面另写一份易漂移的条件
const overrideReady = computed(() =>
  canOverrideRefund({ orderFound: !!overrideOrder.value, lineId: overrideLineId.value, reason: overrideReason.value, ack: overrideAck.value, busy: overrideBusy.value })
)

function openOverride() {
  showOverride.value = true
  overrideOrderId.value = ''
  overrideOrder.value = null
  overrideLineId.value = ''
  overrideReason.value = ''
  overrideAck.value = false
  overrideFindMsg.value = ''
  overrideResultMsg.value = ''
}
function closeOverride() {
  showOverride.value = false
}
async function findOverrideOrder() {
  const id = overrideOrderId.value.trim()
  if (!id) return
  overrideOrder.value = null
  overrideLineId.value = ''
  overrideResultMsg.value = ''
  overrideFindMsg.value = '查找中…'
  const r = await listOrders(undefined, undefined, 1, id)
  if (!r.ok) {
    overrideFindMsg.value = '查找失败：' + String(r.error || '')
    return
  }
  const vm = mapOverrideOrder((r as any).list, id)
  if (!vm) {
    overrideFindMsg.value = '没有找到该订单号'
    return
  }
  overrideOrder.value = vm
  overrideFindMsg.value = ''
}
async function submitOverride() {
  if (!overrideReady.value || !overrideOrder.value) return
  overrideBusy.value = true
  overrideResultMsg.value = ''
  const r = await overrideRefund(overrideOrder.value.id, overrideLineId.value, overrideReason.value.trim())
  overrideBusy.value = false
  if (r.ok) {
    overrideResultMsg.value = `✓ 已发起越规退款（售后单 ${String((r as any).id || '')}），等微信回调确认到账`
    void reload() // 列表/计数刷新——本单可能已出现在「退款处理中」栏
    // 提交成功后复位选择态（防误再次对同一行重复提交），保留结果横幅可见
    overrideOrder.value = null
    overrideLineId.value = ''
    overrideReason.value = ''
    overrideAck.value = false
  } else {
    overrideResultMsg.value = '越规退款触发失败：' + String(r.error || '未知错误')
  }
}

onMounted(() => {
  if (search.value) void doSearch() // 深链预填带值即自动检索一次（省一次手点·省去 pickTab 切标签的动作）
  else void reload()
})
</script>

<template>
  <div class="ld-page">
    <PageHeader title="售后退款" sub="先收到寄回包装并验收（激活卡未拆用）再同意 · 同意后原路退回微信支付">
      <UiButton variant="ghost" size="sm" title="越过常规售后资格规则直接发起退款——仅限特殊情况" @click="openOverride">
        <ShieldAlert :size="14" :stroke-width="1.8" /><span>越规退款</span>
      </UiButton>
      <UiButton variant="ghost" size="sm" :disabled="message === '加载中…'" @click="reload">
        <RefreshCw :size="14" :stroke-width="1.8" /><span>刷新</span>
      </UiButton>
    </PageHeader>

    <!-- 状态 tab（云端实时计数徽章·沿用 TABS/pickTab） -->
    <div class="tabs-wrap">
      <div class="ld-toolbar">
        <!-- 搜索态（跨全部状态命中）不点亮任何 tab（同 Orders 既有 !activeQ 范式·防「待审核」高亮误导） -->
        <button v-for="t in TABS" :key="t.key" class="ld-chip" :class="{ on: !activeQ && tab === t.key }" @click="pickTab(t.key)">
          <span>{{ t.label }}</span>
          <span v-if="countsPartial" class="chip-n warn" title="计数不可用（部分统计加载失败·数字可能不实）">?</span>
          <span v-else-if="counts[t.key || 'all'] != null" class="chip-n">{{ counts[t.key || 'all'] }}</span>
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
      <EmptyState v-else-if="!message" :text="emptyText" />
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
        <!-- 判据加载失败（verdict=null·仅 openDecide 失败会置）：不渲判据、给重试入口（原因在下方 decideErr 红条） -->
        <button v-else-if="!verdict" class="link" @click="openDecide(decideRow)">重新加载判据</button>

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

    <!-- 越规退款入口（决策§26·工具区独立弹层·非依附某条售后单）：查订单→选行→必填原因+勾选→提交 -->
    <div v-if="showOverride" class="drawer-mask ov-center" @click.self="closeOverride">
      <div class="ov-dialog">
        <div class="drawer-head">
          <div class="drawer-title">越规退款</div>
          <button class="drawer-close" @click="closeOverride"><X :size="16" :stroke-width="1.8" /></button>
        </div>
        <p class="ov-warn">越过常规售后资格规则（一行一售后锁 / 已拒 / 已进课不可退）直接发起退款——仅限特殊情况人工核实。退款金额与是否可退仍由服务端按钱守恒规则裁定，前端不可指定金额。</p>

        <div class="ov-find">
          <input v-model="overrideOrderId" placeholder="输入订单号" @keyup.enter="findOverrideOrder" />
          <UiButton size="sm" @click="findOverrideOrder">查找</UiButton>
        </div>
        <p v-if="overrideFindMsg" class="ov-msg">{{ overrideFindMsg }}</p>

        <template v-if="overrideOrder">
          <div class="summary">
            <div class="srow"><span>订单号</span><strong>{{ overrideOrder.id }}</strong></div>
            <div class="srow"><span>状态</span><span class="sval">{{ overrideOrder.statusLabel }}</span></div>
            <div class="srow"><span>买家</span><span class="sval">{{ overrideOrder.buyerName || '—' }} · {{ overrideOrder.buyerPhone || '（无电话）' }}</span></div>
            <div class="srow"><span>实付 / 商品价（只读）</span><span class="sval">{{ overrideOrder.amountLabel }} / {{ overrideOrder.goodsLabel || '—' }}</span></div>
          </div>

          <div class="crit-label">选择要退款的商品行</div>
          <label v-for="l in overrideOrder.lines" :key="l.lineId" class="ov-line">
            <input v-model="overrideLineId" type="radio" name="ov-line" :value="l.lineId" />
            <span>{{ l.label }}</span>
          </label>
          <p v-if="!overrideOrder.lines.length" class="ov-msg">这单没有可选商品行</p>

          <div class="crit-label">越规原因（必填·会记入售后单）</div>
          <textarea v-model="overrideReason" maxlength="100" rows="3" placeholder="如：客服特批 / 特殊情况人工核实" />

          <label class="ck"><input v-model="overrideAck" type="checkbox" /><span>我已知晓此操作越过常规售后流程</span></label>

          <div class="drawer-foot">
            <UiButton variant="danger" size="lg" block :disabled="!overrideReady" @click="submitOverride">
              <ShieldAlert :size="16" :stroke-width="1.8" /><span>{{ overrideBusy ? '发起中…' : '发起越规退款' }}</span>
            </UiButton>
          </div>
        </template>

        <p v-if="overrideResultMsg" class="ov-msg" :class="{ err: overrideResultMsg.includes('失败') }">{{ overrideResultMsg }}</p>
      </div>
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
.chip-n.warn {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
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

/* 决策抽屉（本页独有浮层·web 端无需 touchmove 锁；壳层公共段单源在 styles/console.css·病根#5） */
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

/* 越规退款弹层（决策§26·独立入口·非依附售后行的居中弹窗——沿用 drawer-mask 遮罩但覆盖 justify/align 为居中） */
.ov-center {
  justify-content: center;
  align-items: center;
}
.ov-dialog {
  width: 460px;
  max-width: 92vw;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--ld-bg);
  border-radius: var(--ld-radius);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: slidein 0.18s ease;
}
.ov-warn {
  margin: 0;
  padding: 11px 14px;
  border-radius: var(--ld-radius);
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
  font-size: 12px;
  line-height: 1.5;
}
.ov-find {
  display: flex;
  gap: 8px;
}
.ov-find input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  color: var(--ld-ink);
  background: var(--ld-bg);
}
.ov-msg {
  margin: 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.ov-msg.err {
  color: var(--ld-red);
  font-weight: 600;
}
.ov-line {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 12.5px;
  color: var(--ld-content);
  cursor: pointer;
}
</style>
