<script setup>
/**
 * 第 6 步 · 码批次与印刷包（规格 §七，设计稿 S9）。
 * 前置：卡面已定稿（第 5 步）。生成批次复用云端 genQrcodes（一码一用唯一性既有）；
 * 印刷包 = ZIP（卡面.svg 矢量设计图 + 二维码地址.csv），交印刷厂一地址一码。
 */
import { ref, computed, watch } from 'vue'
import JSZip from 'jszip'
import QRCode from 'qrcode'
import { useProductsStore } from '@/store/products.js'
import {
  cloudMode,
  getCard,
  listBatches,
  createBatch,
  listBatchCodes,
  getSettings,
  saveSettings,
} from '@/api/cloud.js'
import { buildFrontSvg, buildBackSvg } from '@/utils/cardSvg.js'
import { confirmDialog, toast } from '@/utils/ui.js'

const props = defineProps({ product: { type: Object, required: true } })
const store = useProductsStore()

const card = ref(null)
const artUrl = ref('')
const batches = ref([])
const urlPrefix = ref('')
const count = ref(500)
const loading = ref(true)
const loadErr = ref('')
const busy = ref('')

const courseId = computed(() => props.product.courseId || 'course-' + props.product.id)
// 测试二维码弹层（手机微信扫屏幕即可走通：扫码 → 落地页显示激活码与指引）
const qrShow = ref(false)
const qrImg = ref('')
const qrUrl = ref('')
async function showTestQr(batchId) {
  try {
    const codes = await listBatchCodes(batchId)
    if (!codes.length) return toast('该批次没有码', 'err')
    qrUrl.value = `${urlPrefix.value}?code=${codes[0]}`
    qrImg.value = await QRCode.toDataURL(qrUrl.value, { width: 360, margin: 2, color: { dark: '#241733' } })
    qrShow.value = true
  } catch (e) {
    toast('生成测试二维码失败：' + e.message, 'err')
  }
}
const cardFinal = computed(() => card.value?.status === 'final')
const prefixOk = computed(() => /^https:\/\/.+\/$/.test(urlPrefix.value))

// 激活进度 + 三态（增强第6步·原独立批次页能力并入此处·仅该商品）
const STATUS = { new: ['全新', 'grey'], using: ['使用中', ''], done: ['已用尽', 'green'] }
const statusOf = (b) => (b.activated === 0 ? 'new' : b.activated >= b.total ? 'done' : 'using')
const pct = (b) => (b.total ? Math.round((b.activated / b.total) * 100) : 0)

// 批次筛选 + 分页（用户反馈：批次多了扁平一页管不过来）——按使用状态 + 时间快捷区间筛，分页翻看
const STATUS_TABS = [['all', '全部'], ['using', '使用中'], ['done', '已用尽'], ['new', '全新']]
const TIME_OPTS = [[0, '全部时间'], [7, '近 7 天'], [30, '近 30 天'], [90, '近 90 天']]
const fStatus = ref('all')
const fTime = ref(0)
const bpage = ref(1)
const PAGE_SIZE = 8
const statusCounts = computed(() => {
  const c = { all: batches.value.length, new: 0, using: 0, done: 0 }
  for (const b of batches.value) c[statusOf(b)]++
  return c
})
const filteredBatches = computed(() => {
  const cutoff = fTime.value ? Date.now() - fTime.value * 86400000 : 0
  return batches.value.filter((b) => {
    if (fStatus.value !== 'all' && statusOf(b) !== fStatus.value) return false
    if (cutoff && (b.createdAt || 0) < cutoff) return false
    return true
  })
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredBatches.value.length / PAGE_SIZE)))
const pagedBatches = computed(() => filteredBatches.value.slice((Math.min(bpage.value, totalPages.value) - 1) * PAGE_SIZE, Math.min(bpage.value, totalPages.value) * PAGE_SIZE))
watch([fStatus, fTime, batches], () => (bpage.value = 1))

// 默认折叠仅显最近 3 条（批次最新在前·listBatches 已按 createdAt 倒序）；查看更多展开后才出筛选+分页
const expanded = ref(false)
const displayed = computed(() => (expanded.value ? pagedBatches.value : batches.value.slice(0, 3)))
function collapse() {
  expanded.value = false
  fStatus.value = 'all'
  fTime.value = 0
  bpage.value = 1
}
// 查看码弹层（列码 + 复制全部导出）
const codesShow = ref(false)
const codesBatch = ref('')
const codesList = ref([])
const codesCopied = ref(false)
const codesLoading = ref(false)
async function showCodes(batchId) {
  codesBatch.value = batchId
  codesList.value = []
  codesCopied.value = false
  codesShow.value = true
  codesLoading.value = true
  try {
    codesList.value = await listBatchCodes(batchId)
  } catch (e) {
    toast('加载码失败：' + e.message, 'err')
    codesShow.value = false
  } finally {
    codesLoading.value = false
  }
}
function copyCodes() {
  if (!codesList.value.length) return
  navigator.clipboard?.writeText(codesList.value.join('\n')).then(() => {
    codesCopied.value = true
    setTimeout(() => (codesCopied.value = false), 1500)
  })
}

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  try {
    const [c, b, s] = await Promise.all([getCard(props.product.id), listBatches(courseId.value), getSettings()])
    card.value = c.card
    artUrl.value = c.artUrl
    batches.value = b
    // 默认用自有域名 www（决策 §13·已备案接入 CloudBase 静态托管·扫码落地页验证通过）；
    // 真值仍以 adminConfig/settings 保存的为准，此处仅首次无配置时的默认。
    urlPrefix.value = s.urlPrefix || 'https://www.luckyducky.cn/q/'
    await store.update(props.product.id, { batchCount: b.length })
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

async function persistPrefix() {
  await saveSettings({ urlPrefix: urlPrefix.value })
}

// 图案转 dataURL 内嵌 SVG（取不到则远程引用）
async function artDataUrl() {
  if (!artUrl.value) return ''
  try {
    const blob = await (await fetch(artUrl.value)).blob()
    return await new Promise((res) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.onerror = () => res(artUrl.value)
      fr.readAsDataURL(blob)
    })
  } catch {
    return artUrl.value
  }
}

async function downloadPack(batchId, codes) {
  busy.value = batchId
  try {
    if (!codes) codes = await listBatchCodes(batchId)
    const art = await artDataUrl()
    const csv = '激活码,网址\n' + codes.map((c) => `${c},${urlPrefix.value}?code=${c}`).join('\n')
    const zip = new JSZip()
    zip.file('卡面-正面-插画.svg', buildFrontSvg(card.value, art))
    zip.file('卡面-反面-二维码.svg', buildBackSvg(card.value))
    zip.file('二维码地址.csv', '﻿' + csv) // BOM：Excel 打开不乱码
    zip.file('说明.txt', `Lucky Ducky 印刷包 · 批次 ${batchId}\n共 ${codes.length} 码。\n\n给印刷厂：\n1. 卡片双面印刷（${card.value.sizeMM.w}×${card.value.sizeMM.h}mm，矢量可缩放）：正面.svg = 满版插画面，反面.svg = 二维码面（中间虚线框为二维码位置）；\n2. 二维码地址.csv 每行一个网址——一个地址生成一张卡反面的二维码（其余部分相同，正面统一）。\n`)
    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `印刷包-${batchId}.zip`
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e) {
    toast('打包失败：' + e.message, 'err')
  } finally {
    busy.value = ''
  }
}

async function generate() {
  if (busy.value) return
  if (!cardFinal.value) return toast('请先在第 5 步定稿卡面', 'err')
  if (!prefixOk.value) return toast('请先填好网址前缀（https:// 开头、/ 结尾），它决定印刷出的二维码指向哪里', 'err')
  if (!(await confirmDialog({ title: '生成码批次', message: `生成 ${count.value} 个激活码并打包下载印刷包？\n（码一经生成即有效，请按备货量填写）`, confirmText: '生成' }))) return
  busy.value = 'gen'
  try {
    const r = await createBatch(courseId.value, count.value)
    batches.value = await listBatches(courseId.value)
    await store.update(props.product.id, { batchCount: batches.value.length })
    await downloadPack(r.batchId, r.codes)
  } catch (e) {
    toast('生成失败：' + e.message, 'err')
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div>
    <h2>第 6 步 · 码批次与印刷包</h2>
    <p class="desc">按备货量生成激活码，打包下载交给印刷厂——卡面 SVG + 二维码地址清单，一个地址印刷一个二维码</p>

    <p v-if="!cloudMode" class="hint warn">码批次需云端模式。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">加载中…</p>

    <template v-else>
      <p class="pre" :class="cardFinal ? 'ok' : 'warn'">
        {{ cardFinal ? `✓ 卡面「${card.name}」已定稿（${card.sizeMM.w}×${card.sizeMM.h}mm）—— 可以生成批次` : '⚠ 卡面未定稿：先到第 5 步完成卡面并点「定稿并启用」' }}
      </p>

      <div class="sec">
        <div class="sec-t">二维码网址前缀（印刷的码指向哪里）</div>
        <div class="prefixrow">
          <input v-model="urlPrefix" class="input" placeholder="https://你的域名/q/" @blur="persistPrefix" />
          <span class="prefixdemo">示例：{{ urlPrefix }}?code=LD2M67QXDDR6</span>
        </div>
        <p class="mini">需先在微信后台配好「扫普通链接二维码打开小程序」规则（决策 §13）；前缀保存后全局通用。</p>
      </div>

      <div class="sec">
        <div class="sec-t">已有批次<span v-if="batches.length" class="bcount"> · 共 {{ batches.length }}</span></div>
        <p v-if="!batches.length" class="mini">还没有批次</p>
        <template v-else>
          <div v-if="expanded" class="bfilter">
            <div class="bpills">
              <button v-for="[k, label] in STATUS_TABS" :key="k" class="pill" :class="{ on: fStatus === k }" @click="fStatus = k">
                {{ label }}<span class="pn">{{ statusCounts[k] }}</span>
              </button>
            </div>
            <select v-model.number="fTime" class="input tsel">
              <option v-for="[d, label] in TIME_OPTS" :key="d" :value="d">{{ label }}</option>
            </select>
          </div>

          <p v-if="expanded && !filteredBatches.length" class="mini">这个筛选下没有批次</p>
          <div v-for="b in displayed" :key="b.batchId" class="batchrow">
            <span class="bicon">▦</span>
            <b class="bid">{{ b.batchId }}</b>
            <span class="chip" :class="STATUS[statusOf(b)][1]">{{ STATUS[statusOf(b)][0] }}</span>
            <span class="bprog">
              <span class="pbar"><i :class="statusOf(b)" :style="{ width: Math.max(pct(b), 2) + '%' }" /></span>
              <em>{{ b.activated }}/{{ b.total }} 激活 · {{ pct(b) }}%</em>
            </span>
            <button class="btn ghost sm" @click="showCodes(b.batchId)">查看码</button>
            <button class="btn ghost sm" @click="showTestQr(b.batchId)">📱 测试</button>
            <button class="btn ghost sm" :disabled="busy === b.batchId || !cardFinal" @click="downloadPack(b.batchId)">
              {{ busy === b.batchId ? '打包中…' : '⬇ 印刷包' }}
            </button>
          </div>

          <div v-if="expanded && totalPages > 1" class="bpager">
            <button class="btn ghost sm" :disabled="bpage <= 1" @click="bpage--">‹ 上一页</button>
            <span class="pginfo">第 {{ Math.min(bpage, totalPages) }} / {{ totalPages }} 页</span>
            <button class="btn ghost sm" :disabled="bpage >= totalPages" @click="bpage++">下一页 ›</button>
          </div>

          <button v-if="!expanded && batches.length > 3" class="morebtn" @click="expanded = true">
            查看更多（共 {{ batches.length }} 个批次）↓
          </button>
          <button v-else-if="expanded" class="morebtn" @click="collapse">收起 ↑</button>
        </template>
      </div>

      <div class="sec genbox">
        <div class="sec-t">生成新批次</div>
        <div class="genrow">
          <label class="qty">数量 <input v-model.number="count" type="number" min="1" max="500" class="input num" /></label>
          <button class="btn brand" :disabled="busy === 'gen' || !cardFinal" @click="generate">
            {{ busy === 'gen' ? '生成中…' : '▦ 生成批次并打包下载' }}
          </button>
        </div>
        <p class="mini">印刷包.zip ＝ 正面.svg（插画面）＋ 反面.svg（二维码面）＋ 二维码地址.csv（一行一码）＋ 给印刷厂的说明.txt</p>
      </div>
      <div v-if="qrShow" class="qrmask" @click="qrShow = false">
        <div class="qrbox" @click.stop>
          <h4>测试二维码（该批次第 1 个码）</h4>
          <img :src="qrImg" alt="测试二维码" />
          <p class="qrurl">{{ qrUrl }}</p>
          <p class="qrnote">用手机微信「扫一扫」扫屏幕：会打开落地页并显示激活码（默认域名测试模式）。自有域名 + 微信规则配好后，同样的码会直接跳进小程序激活页。</p>
          <button class="btn primary" @click="qrShow = false">关闭</button>
        </div>
      </div>

      <div v-if="codesShow" class="qrmask" @click="codesShow = false">
        <div class="codesbox" @click.stop>
          <div class="codes-head">
            <h4>批次 {{ codesBatch }} 的码</h4>
            <button class="x" @click="codesShow = false">×</button>
          </div>
          <p v-if="codesLoading" class="mini">加载码…</p>
          <template v-else>
            <div class="codes-act">
              <span class="mini">共 {{ codesList.length }} 个码（一码一用）</span>
              <button class="btn ghost sm" @click="copyCodes">{{ codesCopied ? '✓ 已复制' : '复制全部码' }}</button>
            </div>
            <div class="codes-list">
              <code v-for="c in codesList" :key="c">{{ c }}</code>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
h2 {
  font-size: 16.5px;
  color: var(--ink);
  margin: 0 0 4px;
}
.desc {
  font-size: 12px;
  color: var(--content-2);
  margin: 0 0 18px;
}
.pre {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  margin: 0 0 16px;
}
.pre.ok {
  background: var(--green-bg);
  border: 1px solid var(--green-line);
  color: var(--content);
}
.pre.warn {
  background: #fdf6ec;
  border: 1px solid #f0ddc0;
  color: #8a6420;
}
.sec {
  margin-bottom: 18px;
  max-width: 720px;
}
.sec-t {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 8px;
}
.prefixrow {
  display: flex;
  gap: 12px;
  align-items: center;
}
.prefixrow .input {
  max-width: 340px;
}
.prefixdemo {
  font-size: 11px;
  color: var(--content-2);
}
.mini {
  font-size: 11px;
  color: var(--content-2);
  margin: 6px 0 0;
}
.batchrow {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--purple-line);
  background: var(--bg-lilac);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
  font-size: 12.5px;
}
.bicon {
  color: var(--brand);
}
.bid {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
}
.chip {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  color: var(--brand-active);
}
.chip.green {
  background: var(--green-bg);
  border-color: var(--green-line);
  color: var(--green);
}
.chip.grey {
  background: var(--bg-grey);
  border-color: var(--line-strong);
  color: var(--content-2);
}
.bprog {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
}
.pbar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-grey);
  overflow: hidden;
  max-width: 160px;
}
.pbar i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--brand);
}
.pbar i.done {
  background: var(--green);
}
.pbar i.new {
  background: var(--line-strong);
}
.bprog em {
  font-style: normal;
  font-size: 11px;
  color: var(--content-2);
  white-space: nowrap;
}
.btn.sm {
  padding: 7px 13px;
  font-size: 12px;
}
.bcount {
  font-weight: 400;
  color: var(--content-2);
  font-size: 11.5px;
}
.bfilter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.bpills {
  display: flex;
  gap: 6px;
}
.pill {
  border: 1px solid var(--line-strong);
  background: var(--white);
  border-radius: var(--r-pill);
  padding: 5px 12px;
  font-size: 12px;
  color: var(--content-2);
  cursor: pointer;
}
.pill.on {
  background: var(--purple-ink);
  border-color: var(--purple-ink);
  color: var(--white);
  font-weight: 600;
}
.pn {
  margin-left: 5px;
  font-size: 10.5px;
  opacity: 0.75;
}
.tsel {
  width: 120px;
  padding: 6px 10px;
}
.bpager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 12px;
}
.pginfo {
  font-size: 12px;
  color: var(--content-2);
}
.morebtn {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 9px;
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  background: none;
  color: var(--content-2);
  font-size: 12.5px;
  cursor: pointer;
}
.morebtn:hover {
  border-color: var(--purple-line);
  background: var(--bg-lilac);
  color: var(--brand);
}
.codesbox {
  background: var(--white);
  border-radius: 16px;
  padding: 18px 22px;
  width: 460px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.codes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.codes-head h4 {
  margin: 0;
  font-size: 14px;
  color: var(--ink);
}
.codes-head .x {
  border: none;
  background: none;
  font-size: 22px;
  line-height: 1;
  color: var(--content-2);
  cursor: pointer;
}
.codes-act {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 10px;
}
.codes-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.codes-list code {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  color: var(--content);
  padding: 5px 8px;
  background: var(--bg-lilac);
  border-radius: 6px;
}
.genbox {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
}
.genrow {
  display: flex;
  gap: 12px;
  align-items: center;
}
.qty {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--content-2);
}
.input.num {
  width: 90px;
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
.qrmask {
  position: fixed;
  inset: 0;
  background: rgba(36, 23, 51, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.qrbox {
  background: var(--white);
  border-radius: 16px;
  padding: 24px 28px;
  text-align: center;
  max-width: 420px;
}
.qrbox h4 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--ink);
}
.qrbox img {
  width: 240px;
  height: 240px;
}
.qrurl {
  font-size: 11px;
  color: var(--content-2);
  word-break: break-all;
  margin: 8px 0;
}
.qrnote {
  font-size: 11.5px;
  color: var(--content);
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: 10px;
  padding: 8px 12px;
  margin: 0 0 14px;
  text-align: left;
  line-height: 1.7;
}
</style>
