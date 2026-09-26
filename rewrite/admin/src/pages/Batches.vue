<script setup lang="ts">
// 激活码批次：统计卡/进度条/状态 chip 由真聚合派生、
// 详情抽屉码表接 listBatchCodes 真码（cursor 分页，一页 50）+ CSV/印刷包另取齐整批。
// 诚实边界：后端 listBatches 需 courseId（无「列全量批次」action）——按课程范围查（非跨课「全部」）；
// listBatchCodes 只回码串无每码激活态——码表不标单码已激活/未用（记待办）。印刷包 ZIP 已还原（卡面SVG+地址CSV+说明·二轮批Cards-2）。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import JSZip from 'jszip'
import { Layers, QrCode, CircleCheck, TrendingUp, X, Download, Package } from 'lucide-vue-next'
import { listBatches, createBatch, listBatchCodes, getSettings } from '../api/system'
import { getCard } from '../api/products'
import { buildFrontSvg, buildBackSvg } from '../lib/cardSvg'
import { mapBatches, launchErrorText, UNKNOWN_COURSE_HINT, type BatchRow } from '../lib/mapSystem'
import { useLatest } from '../lib/latest'
import { saveBlob } from '../lib/saveBlob'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import KpiCard from '../components/ui/KpiCard.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

// 嵌入模式（上新向导第 5 步复用）+ 修独立深链 bug：换皮把 courseId 写死空 ref、不读 route.query，
// 致商品页「码批次」深链(/batches?courseId=)落地要手输课程号；改读 props(向导)||route.query(深链)||空。
const props = defineProps<{ embed?: boolean; wizardCourseId?: string; courseReady?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const route = useRoute()
const router = useRouter()
const courseId = ref(props.wizardCourseId || String(route.query.courseId || ''))
function backToLaunch() {
  const cid = courseId.value
  const pid = cid.startsWith('course-') ? cid.slice('course-'.length) : ''
  void router.push(pid ? { path: `/products/${pid}/wizard`, query: { step: '5' } } : '/launch')
}
const loadedCourse = ref('')
const rows = ref<BatchRow[]>([])
const message = ref('')
const truncated = ref(false) // 后端取码触顶：批次计数只数到上限
const busy = ref(false)
const count = ref(50)
const creating = ref(false)
const filter = ref<'all' | 'using' | 'used' | 'fresh'>('all')

const detail = ref<BatchRow | null>(null)
const codes = ref<string[]>([])
const codesLoading = ref(false)
const CODE_PAGE = 50 // 一批可有几百到几千张·一屏只看一页（根因#7）
const BATCH_PAGE = 20 // 批次表本身也翻页，避免批次多时一次铺开
const codeHasMore = ref(false)
const codeNextCursor = ref<unknown>(null)
const codePage = ref(1)
const codeCursors = ref<unknown[]>([]) // 已走过的游标栈·上一页用
const firstCode = ref('') // 本批首码（测试二维码用·不随翻页漂）
const batchPage = ref(1)
const urlPrefix = ref('') // 激活码落地网址前缀（换皮 CSV 只导码不导网址·印刷厂拿不到落地地址）
const testQr = ref('') // 测试二维码 dataURL（量产前扫码验落地页·换皮丢了这个·根因#8）
const exportBlockedMsg = ref('') // 导出 fail-closed 提示（未配网址前缀时挡导出·印刷交付物必须是完整网址）
const prefixErr = ref('') // 读设置失败≠没配前缀：导出拦截时如实说读取失败，别把操作员支去设置页（病根#14）
const codesErr = ref('')
const packing = ref(false)
const codeUrl = (code: string) => urlPrefix.value + code

onMounted(async () => {
  // 深链/向导带入了课程号即自动载入该课批次；与读设置互不依赖，先发
  if (courseId.value.trim()) void load()
  const r = await getSettings()
  if (r.ok) urlPrefix.value = String((r as any).settings?.urlPrefix || (r as any).urlPrefix || '')
  else prefixErr.value = '网址前缀读取失败（' + launchErrorText(r.error) + '），请刷新页面重试'
})

function statusOf(b: BatchRow): 'using' | 'used' | 'fresh' {
  if (b.activated <= 0) return 'fresh'
  if (b.total > 0 && b.activated >= b.total) return 'used'
  return 'using'
}
const STATUS_LABEL = { using: '使用中', used: '已用尽', fresh: '全新' }
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'using', label: '使用中' },
  { key: 'used', label: '已用尽' },
  { key: 'fresh', label: '全新' },
] as const

const stats = computed(() => {
  const totalCodes = rows.value.reduce((s, b) => s + b.total, 0)
  const activated = rows.value.reduce((s, b) => s + b.activated, 0)
  return {
    batches: rows.value.length,
    codes: totalCodes,
    activated,
    rate: totalCodes ? Math.round((activated / totalCodes) * 100) + '%' : '—',
  }
})
const counts = computed(() => ({
  all: rows.value.length,
  using: rows.value.filter((b) => statusOf(b) === 'using').length,
  used: rows.value.filter((b) => statusOf(b) === 'used').length,
  fresh: rows.value.filter((b) => statusOf(b) === 'fresh').length,
}))
const shown = computed(() => {
  return rows.value.filter((b) => filter.value === 'all' || statusOf(b) === filter.value)
})
const batchPages = computed(() => Math.max(1, Math.ceil(shown.value.length / BATCH_PAGE)))
const pagedShown = computed(() => {
  const start = (batchPage.value - 1) * BATCH_PAGE
  return shown.value.slice(start, start + BATCH_PAGE)
})
watch([filter, rows], () => {
  batchPage.value = 1
})
const pct = (b: BatchRow) => (b.total ? Math.min(100, Math.round((b.activated / b.total) * 100)) : 0)

const loadGen = useLatest() // 乱序守卫（G1·P1）：切课/连点「载入课程」时旧回包别把新课的 loadedCourse 污染成旧课——
// 是「错课量产激活码」防线的地基，doCreate 用 loadedCourse 当目标（见下 doCreate 注释）。
async function load() {
  const c = courseId.value.trim()
  if (!c) return
  message.value = '加载中…'
  const my = loadGen.begin()
  const r = await listBatches(c)
  if (loadGen.isStale(my)) return // 已发起更新的 load()·整包丢弃（rows/loadedCourse/message 全不写）
  rows.value = r.ok ? mapBatches(r.list) : []
  truncated.value = r.ok && r.truncated === true
  loadedCourse.value = r.ok ? c : ''
  message.value = r.ok ? (rows.value.length ? '' : '这门课还没有批次') : launchErrorText(r.error)
}

async function doCreate() {
  if (busy.value) return
  if (props.embed && props.courseReady === false) {
    message.value = launchErrorText('UNKNOWN_COURSE:' + (loadedCourse.value || courseId.value.trim()))
    return
  }
  if (!Number.isInteger(count.value) || count.value < 1) {
    message.value = '数量要是正整数（≤500）'
    return
  }
  busy.value = true
  // 用已载入的课程(loadedCourse)生成·非可编辑的 courseId（P1·改了选择器没重载会为错课量产激活卡）
  const target = loadedCourse.value || courseId.value.trim()
  const r = await createBatch(target, count.value)
  busy.value = false
  if (!r.ok) {
    message.value = launchErrorText(r.error) // 人话映射·不 reload 吞（病根#14）
    return
  }
  creating.value = false
  const batchId = String(r.batchId)
  const codeN = (r.codes as string[]).length
  courseId.value = target // 选择器回到刚生成的课·load() 据此刷新 target（P2·防用漂移的可编辑框值跳到别课、把刚建的批次藏掉）
  await load() // 先刷新（load 会写'加载中…'/'')，刷完再按刷新结果显——否则同步 reload 的'加载中…'当帧盖掉成功（病根#14 伪成功）
  // 只在列表刷新也成功时显纯成功；刷新失败则保留其可见性、不被成功盖掉（load 成功才把 loadedCourse 设为 target·病根#14 失败必可观测·迭代I 批7 回归修）
  message.value =
    loadedCourse.value === target
      ? `已生成批次 ${batchId}（${codeN} 张码）`
      : `已生成批次 ${batchId}（${codeN} 张码），但列表刷新失败，请点「载入课程」重试`
  emit('saved')
}

const codesGen = useLatest() // 码表乱序守卫（P1·A 的码别配到 B 的批次头·防印错卡·根因#8）
// 失败不翻页、不清已有码，返回是否成功供调用方决定游标栈进退（失败≠空态·病根#14）
function applyCodePage(r: { ok: boolean; error?: unknown; codes?: unknown; nextCursor?: unknown; hasMore?: unknown }, page: number): boolean {
  codesLoading.value = false
  if (!r.ok) {
    codesErr.value = '取码失败：' + launchErrorText(r.error)
    return false
  }
  codesErr.value = ''
  codes.value = (r.codes as string[]) || []
  codeHasMore.value = !!r.hasMore
  codeNextCursor.value = r.nextCursor
  codePage.value = page
  if (page === 1 && codes.value[0]) firstCode.value = codes.value[0]
  return true
}
async function openDetail(b: BatchRow) {
  detail.value = b
  codes.value = []
  codeHasMore.value = false
  codeNextCursor.value = null
  codePage.value = 1
  codeCursors.value = []
  firstCode.value = ''
  testQr.value = ''
  exportBlockedMsg.value = ''
  codesErr.value = ''
  codesLoading.value = true
  const my = codesGen.begin()
  const r = await listBatchCodes(b.batchId, { limit: CODE_PAGE })
  if (codesGen.isStale(my) || detail.value?.batchId !== b.batchId) return // 已切别批次·丢弃过期码表（防码/头错配印错卡）
  applyCodePage(r, 1)
}
async function nextCodes() {
  if (!detail.value || !codeHasMore.value || codeNextCursor.value == null || codesLoading.value) return
  const forBatch = detail.value.batchId
  const cursor = codeNextCursor.value
  codesLoading.value = true
  const g = codesGen.peek()
  const r = await listBatchCodes(forBatch, { cursor, limit: CODE_PAGE })
  if (codesGen.isStale(g) || detail.value?.batchId !== forBatch) return
  if (applyCodePage(r, codePage.value + 1)) codeCursors.value.push(cursor)
}
async function prevCodes() {
  if (!detail.value || codePage.value <= 1 || codesLoading.value) return
  const forBatch = detail.value.batchId
  const targetPage = codePage.value - 1
  const cursor = targetPage <= 1 ? undefined : codeCursors.value[targetPage - 2]
  codesLoading.value = true
  const g = codesGen.peek()
  const r = await listBatchCodes(forBatch, { cursor, limit: CODE_PAGE })
  if (codesGen.isStale(g) || detail.value?.batchId !== forBatch) return
  if (applyCodePage(r, targetPage)) codeCursors.value.pop()
}
async function collectAllCodes(batchId: string): Promise<string[] | null> {
  const all: string[] = []
  let cursor: unknown = undefined
  for (let i = 0; i < 50; i++) {
    const r = await listBatchCodes(batchId, { cursor, limit: 200 })
    if (!r.ok) return null
    all.push(...((r.codes as string[]) || []))
    if (!r.hasMore || r.nextCursor == null) return all
    cursor = r.nextCursor
  }
  return all
}
function closeDetail() {
  detail.value = null
  testQr.value = ''
}
// 测试二维码（量产前扫码验落地页·换皮丢·根因#8「拿到≠用通」）：取首码生成 QR，手机微信扫屏验证
async function makeTestQr() {
  const first = firstCode.value || codes.value[0]
  if (!first) return
  testQr.value = await QRCode.toDataURL(codeUrl(first), { width: 320, margin: 1 })
}
// 印刷包 ZIP（换皮丢·旧台 downloadPack·印刷厂拿不到矢量卡面与制卡说明·整条「设计→打包→交付」链断）：
// 卡面正面.svg + 卡面反面.svg（取该课产品的卡片设计·课程编号 course-<productId> 反推 productId）+ 地址清单.csv + 说明.txt。
async function downloadPack() {
  if (!detail.value || packing.value) return
  // fail-closed（用户拍板 2026-07-08）：印刷交付物必须是完整网址，未配置网址前缀不许导出——
  // 印错「仅码无址」的包给印刷厂等于交付物废掉，宁可挡下不让走、也不悄悄降级成单列码。
  if (!urlPrefix.value.trim()) {
    exportBlockedMsg.value = prefixErr.value || '先在「设置」配置扫码网址前缀，印刷交付物必须是完整网址'
    return
  }
  exportBlockedMsg.value = ''
  packing.value = true
  try {
    const all = await collectAllCodes(detail.value.batchId)
    if (!all || !all.length) {
      exportBlockedMsg.value = '取齐本批码失败，请稍后重试'
      return
    }
    const productId = loadedCourse.value.replace(/^course-/, '')
    const r = await getCard(productId)
    const zip = new JSZip()
    const csv = ['激活码,网址', ...all.map((c) => `${c},${codeUrl(c)}`)].join('\n')
    zip.file('二维码地址.csv', '﻿' + csv) // BOM 防 Excel 中文乱码
    const card = (r as any).ok ? (r as any).card : null
    if (card) {
      zip.file('卡面-正面-插画.svg', buildFrontSvg(card, String((r as any).artUrl || '')))
      zip.file('卡面-反面-二维码.svg', buildBackSvg(card))
      zip.file(
        '说明.txt',
        `批次 ${detail.value.batchId}\n课程 ${loadedCourse.value}\n数量 ${detail.value.total} 张\n卡面尺寸 ${card.sizeMM.w}×${card.sizeMM.h} mm（双面同尺寸）\n\n给印刷厂：卡面正反两张矢量 SVG；反面二维码区为占位框，按「二维码地址.csv」一码一图（每张卡一个唯一二维码，扫码即落地激活页）。`
      )
    } else {
      zip.file('说明.txt', `批次 ${detail.value.batchId}\n课程 ${loadedCourse.value}\n数量 ${detail.value.total} 张\n\n注意：该产品还没有上传卡片（去上新第 5 步上传后重新打包），本包仅含二维码地址清单。`)
    }
    saveBlob(await zip.generateAsync({ type: 'blob' }), detail.value.batchId + '-印刷包.zip')
  } finally {
    packing.value = false
  }
}

// CSV 导出：换皮只导「激活码」单列·印刷厂拿不到落地地址；补「网址」列（激活码,完整URL·Excel BOM）
async function exportCsv() {
  if (!detail.value) return
  // fail-closed（同 downloadPack）：未配网址前缀不许导出，防印刷厂拿到「仅码无址」的废交付物
  if (!urlPrefix.value.trim()) {
    exportBlockedMsg.value = prefixErr.value || '先在「设置」配置扫码网址前缀，印刷交付物必须是完整网址'
    return
  }
  exportBlockedMsg.value = ''
  const all = await collectAllCodes(detail.value.batchId)
  if (!all || !all.length) {
    exportBlockedMsg.value = '取齐本批码失败，请稍后重试'
    return
  }
  const csv = ['激活码,网址', ...all.map((c) => `${c},${codeUrl(c)}`)].join('\n')
  saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), detail.value.batchId + '-codes.csv') // BOM 防 Excel 中文乱码
}
</script>

<template>
  <div class="ld-page">
    <PageHeader
      v-if="!embed"
      title="二维码批次"
      sub="按一次生成分成一批；打开一批翻页看码，不会一次铺开整批"
    >
      <UiButton variant="ghost" size="sm" @click="backToLaunch">返回上新</UiButton>
      <UiButton :disabled="!loadedCourse" @click="creating = !creating">＋ 生成新批次</UiButton>
    </PageHeader>
    <div v-else class="embed-head">
      <span class="embed-course">课程 <b>{{ loadedCourse || courseId || '（未定稿卡片/未关联课程）' }}</b></span>
      <UiButton :disabled="!loadedCourse || courseReady === false" @click="creating = !creating">＋ 生成新批次</UiButton>
    </div>

    <div v-if="creating" class="create-bar">
      <span>为课程 <b>{{ loadedCourse }}</b> 生成</span>
      <input v-model.number="count" type="number" min="1" max="500" />
      <span>张码</span>
      <UiButton size="sm" :disabled="busy || courseReady === false" @click="doCreate">确认生成</UiButton>
      <UiButton variant="ghost" size="sm" @click="creating = false">取消</UiButton>
    </div>

    <div class="ld-kpi-grid">
      <KpiCard label="批次总数" :value="stats.batches" :icon="Layers" />
      <KpiCard label="码总量" :value="stats.codes.toLocaleString()" :icon="QrCode" />
      <KpiCard label="已激活" :value="stats.activated.toLocaleString()" :icon="CircleCheck" />
      <KpiCard label="平均激活率" :value="stats.rate" :icon="TrendingUp" />
    </div>

    <div class="filter-wrap">
      <div class="toolbar-row">
        <div class="ld-toolbar">
          <button v-for="f in FILTERS" :key="f.key" class="ld-chip" :class="{ on: filter === f.key }" @click="filter = f.key">
            <span>{{ f.label }}</span><span class="chip-n">{{ counts[f.key] }}</span>
          </button>
        </div>
        <div v-if="!embed" class="course-picker">
          <div class="ld-search"><input v-model="courseId" placeholder="course-xxx" @keyup.enter="load" /></div>
          <UiButton variant="ghost" size="sm" @click="load">载入课程</UiButton>
        </div>
      </div>
      <p v-if="!embed" class="note">后端按课程查批次（一码一地址）；先输入课程编号载入，统计卡与筛选为该课程范围。</p>
      <p v-else-if="courseReady === false" class="note">{{ UNKNOWN_COURSE_HINT }}</p>
      <p v-else class="note">本步管理这门课的二维码批次（课程已绑定，不用再输编号）。</p>
    </div>

    <p v-if="message" class="ld-status">{{ message }}</p>
    <p v-if="truncated" class="ld-status">码量超上限，计数可能不全</p>

    <Card v-if="shown.length" flush>
      <div class="ld-thead">
        <div class="ld-th grow">批次号</div>
        <div class="ld-th" :style="{ width: '140px' }">生成时间</div>
        <div class="ld-th r" :style="{ width: '72px' }">数量</div>
        <div class="ld-th" :style="{ width: '240px' }">激活进度</div>
        <div class="ld-th" :style="{ width: '104px' }">状态</div>
        <div class="ld-th r" :style="{ width: '128px' }">操作</div>
      </div>
      <div class="ld-tbody">
        <div v-for="b in pagedShown" :key="b.batchId" class="ld-tr">
          <div class="ld-td grow"><span class="bid">{{ b.batchId }}</span></div>
          <div class="ld-td time" :style="{ width: '140px' }">{{ b.createdAt }}</div>
          <div class="ld-td r qty" :style="{ width: '72px' }">{{ b.total }}</div>
          <div class="ld-td" :style="{ width: '240px' }">
            <div class="prog">
              <div class="prog-text">{{ b.activated }} / {{ b.total }} · {{ b.rateLabel }}</div>
              <div class="prog-track"><div class="prog-bar" :class="statusOf(b)" :style="{ width: pct(b) + '%' }" /></div>
            </div>
          </div>
          <div class="ld-td" :style="{ width: '104px' }">
            <Badge :tone="statusOf(b) === 'used' ? 'green' : statusOf(b) === 'using' ? 'brand' : 'neutral'">{{ STATUS_LABEL[statusOf(b)] }}</Badge>
          </div>
          <div class="ld-td r" :style="{ width: '128px' }">
            <UiButton variant="ghost" size="sm" @click="openDetail(b)">打开这批</UiButton>
          </div>
        </div>
      </div>
      <div class="tfoot">
        <span>第 {{ (batchPage - 1) * BATCH_PAGE + 1 }}–{{ Math.min(batchPage * BATCH_PAGE, shown.length) }} 批 · 共 {{ shown.length }} 批（课程 {{ loadedCourse }}）</span>
        <span v-if="batchPages > 1" class="pager">
          <UiButton variant="ghost" size="sm" :disabled="batchPage <= 1" @click="batchPage--">上一页</UiButton>
          <UiButton variant="ghost" size="sm" :disabled="batchPage >= batchPages" @click="batchPage++">下一页</UiButton>
        </span>
      </div>
    </Card>
    <Card v-else-if="!message && loadedCourse"><EmptyState :icon="Layers" text="没有符合筛选的批次" /></Card>
    <Card v-else-if="!loadedCourse"><EmptyState :icon="QrCode" :text="embed ? '课程还没绑上，先完成前面步骤' : '输入课程编号（course-xxx）载入其激活码批次'" /></Card>

    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">批次详情</div>
            <div class="drawer-bid">{{ detail.batchId }}</div>
          </div>
          <button class="drawer-close" @click="closeDetail"><X :size="16" :stroke-width="1.8" /></button>
        </div>

        <div class="info">
          <div class="irow"><span>所属课程</span><strong>{{ loadedCourse }}</strong></div>
          <div class="irow"><span>生成时间</span><strong>{{ detail.createdAt }}</strong></div>
          <div class="irow"><span>数量</span><strong>{{ detail.total }} 个</strong></div>
          <div class="prog-block">
            <div class="irow"><span>已激活</span><strong class="rate">{{ detail.activated }} / {{ detail.total }} · {{ detail.rateLabel }}</strong></div>
            <div class="prog-track"><div class="prog-bar using" :style="{ width: pct(detail) + '%' }" /></div>
          </div>
        </div>

        <div class="codes-head">
          <span class="codes-title">激活码 · 这批共 {{ detail.total }} 个</span>
          <div class="codes-ops">
            <button class="export" :disabled="!firstCode && !codes.length" @click="makeTestQr"><QrCode :size="13" :stroke-width="1.8" /><span>测试二维码</span></button>
            <button class="export" :disabled="!detail.total || packing" @click="exportCsv"><Download :size="13" :stroke-width="1.8" /><span>导出 CSV</span></button>
            <button class="export" :disabled="!detail.total || packing" @click="downloadPack"><Package :size="13" :stroke-width="1.8" /><span>{{ packing ? '打包中…' : '印刷包 ZIP' }}</span></button>
          </div>
        </div>
        <p v-if="exportBlockedMsg" class="export-blocked">{{ exportBlockedMsg }}</p>
        <div v-if="testQr" class="testqr">
          <img :src="testQr" alt="测试二维码" />
          <p>手机微信扫这个码，量产前验证激活落地页正常（首码 <b>{{ firstCode || codes[0] }}</b>）<br /><code>{{ codeUrl(firstCode || codes[0]) }}</code></p>
        </div>
        <p class="codes-note">每次只看一页（{{ CODE_PAGE }} 个），不会一次铺开整批。导出 CSV / 印刷包仍是这一批的全部码。单码「已激活/未用」后端暂未随码返回，看上面整体激活率。</p>
        <div class="code-list">
          <p v-if="codesLoading" class="code-loading">取码中…</p>
          <p v-else-if="codesErr" class="code-loading">{{ codesErr }}</p>
          <p v-else-if="!codes.length" class="code-loading">无码</p>
          <div v-for="c in codes" :key="c" class="code-row">{{ c }}</div>
        </div>
        <div class="code-pager">
          <UiButton variant="ghost" size="sm" :disabled="codePage <= 1 || codesLoading" @click="prevCodes">上一页</UiButton>
          <span>第 {{ codePage }} 页 · 本页 {{ codes.length }} 个 · 这批共 {{ detail.total }} 个</span>
          <UiButton variant="ghost" size="sm" :disabled="!codeHasMore || codesLoading" @click="nextCodes">下一页</UiButton>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* 嵌入模式页头（向导第 5 步·换课程 chip·右侧仍留生成钮·独立路由走 PageHeader） */
.embed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.embed-course {
  font-size: 13px;
  color: var(--ld-content-2);
}
.embed-course b {
  color: var(--ld-ink);
  font-family: var(--ld-font-mono);
}
/* 生成新批次内联条（本页独有·bg-lilac 圆角块） */
.create-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--ld-bg-lilac);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  font-size: 13px;
  color: var(--ld-content);
}
.create-bar input {
  width: 90px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
}
/* 筛选行：chips（ld-toolbar）+ 课程选择器分列两端 */
.filter-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.course-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* chip 内嵌计数徽章（design：bg-grey·激活时 brand） */
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
.note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
/* 表格 cell 内容（容器/表头/行走 console.css 的 ld-table 系） */
.r {
  justify-content: flex-end;
  text-align: right;
}
.bid {
  font-family: var(--ld-font-mono);
  font-size: 12.5px;
  color: var(--ld-ink);
}
.time {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.qty {
  color: var(--ld-content);
}
.prog {
  width: 100%;
  min-width: 0;
}
.prog-text {
  font-size: 11.5px;
  color: var(--ld-content-2);
  margin-bottom: 5px;
}
.prog-track {
  height: 7px;
  background: var(--ld-bg-faint);
  border-radius: 999px;
  overflow: hidden;
}
.prog-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--ld-brand);
}
.prog-bar.used {
  background: var(--ld-green);
}
.prog-bar.fresh {
  background: var(--ld-line-strong);
}
.tfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-top: 1px solid var(--ld-line);
  font-size: 12px;
  color: var(--ld-content-2);
}
.pager,
.code-pager {
  display: flex;
  align-items: center;
  gap: 8px;
}
.code-pager {
  justify-content: space-between;
  font-size: 12px;
  color: var(--ld-content-2);
}
/* 批次详情抽屉（本页独有浮层·web 端无需 touchmove 锁；壳层公共段单源在 styles/console.css·病根#5） */
.drawer {
  width: 400px;
  max-width: 94vw;
  height: 100%;
  background: var(--ld-bg);
  border-left: 1px solid var(--ld-line);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  animation: slidein 0.18s ease;
}
.drawer-bid {
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
.info {
  padding: 14px;
  background: var(--ld-bg-lilac);
  border-radius: var(--ld-radius);
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.irow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
}
.irow > span {
  color: var(--ld-content-2);
}
.irow strong {
  color: var(--ld-ink);
}
.irow strong.rate {
  color: var(--ld-brand-active);
}
.prog-block {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.codes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.codes-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-ink);
}
.codes-ops {
  display: flex;
  gap: 8px;
}
.testqr {
  display: flex;
  gap: 14px;
  align-items: center;
  margin: 10px 0;
  padding: 12px;
  background: var(--ld-bg-lilac);
  border-radius: var(--ld-radius);
}
.testqr img {
  width: 120px;
  height: 120px;
  flex: none;
  background: #fff;
  border-radius: var(--ld-radius-sm);
}
.testqr p {
  margin: 0;
  font-size: 12px;
  color: var(--ld-content);
  line-height: 1.6;
}
.testqr code {
  font-family: var(--ld-font-mono);
  font-size: 11px;
  color: var(--ld-content-2);
  word-break: break-all;
}
.export {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--ld-brand);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.export:disabled {
  opacity: 0.5;
}
.codes-note {
  margin: 0;
  font-size: 11px;
  color: var(--ld-content-2);
}
.export-blocked {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-red-soft);
  border: 1px solid var(--ld-red-line);
  font-size: 12px;
  color: var(--ld-red);
}
.code-list {
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
}
.code-loading {
  margin: 0;
  padding: 14px;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.code-row {
  padding: 9px 13px;
  font-family: var(--ld-font-mono);
  font-size: 12px;
  color: var(--ld-ink);
  border-top: 1px solid var(--ld-line);
}
.code-row:first-child {
  border-top: none;
}
</style>
