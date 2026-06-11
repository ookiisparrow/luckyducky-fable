<script setup>
/**
 * 第 6 步 · 码批次与印刷包（规格 §七，设计稿 S9）。
 * 前置：卡面已定稿（第 5 步）。生成批次复用云端 genQrcodes（一码一用唯一性既有）；
 * 印刷包 = ZIP（卡面.svg 矢量设计图 + 二维码地址.csv），交印刷厂一地址一码。
 */
import { ref, computed } from 'vue'
import JSZip from 'jszip'
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
const cardFinal = computed(() => card.value?.status === 'final')
const prefixOk = computed(() => /^https:\/\/.+\/$/.test(urlPrefix.value))

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
    urlPrefix.value = s.urlPrefix || 'https://你的域名/q/'
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
    const csv = '激活码,网址\n' + codes.map((c) => `${c},${urlPrefix.value}${c}`).join('\n')
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
    alert('打包失败：' + e.message)
  } finally {
    busy.value = ''
  }
}

async function generate() {
  if (busy.value) return
  if (!cardFinal.value) return alert('请先在第 5 步定稿卡面')
  if (!prefixOk.value) return alert('请先填好网址前缀（https:// 开头、/ 结尾），它决定印刷出的二维码指向哪里')
  if (!confirm(`生成 ${count.value} 个激活码并打包下载印刷包？\n（码一经生成即有效，请按备货量填写）`)) return
  busy.value = 'gen'
  try {
    const r = await createBatch(courseId.value, count.value)
    batches.value = await listBatches(courseId.value)
    await store.update(props.product.id, { batchCount: batches.value.length })
    await downloadPack(r.batchId, r.codes)
  } catch (e) {
    alert('生成失败：' + e.message)
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
          <span class="prefixdemo">示例：{{ urlPrefix }}LD2M67QXDDR6</span>
        </div>
        <p class="mini">需先在微信后台配好「扫普通链接二维码打开小程序」规则（决策 §13）；前缀保存后全局通用。</p>
      </div>

      <div class="sec">
        <div class="sec-t">已有批次</div>
        <p v-if="!batches.length" class="mini">还没有批次</p>
        <div v-for="b in batches" :key="b.batchId" class="batchrow">
          <span class="bicon">▦</span>
          <b>{{ b.batchId }}</b>
          <span class="bmeta">{{ b.total }} 码 · 已激活 {{ b.activated }}</span>
          <button class="btn ghost sm" :disabled="busy === b.batchId || !cardFinal" @click="downloadPack(b.batchId)">
            {{ busy === b.batchId ? '打包中…' : '⬇ 下载印刷包' }}
          </button>
        </div>
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
.bmeta {
  flex: 1;
  color: var(--content-2);
  font-size: 12px;
}
.btn.sm {
  padding: 7px 13px;
  font-size: 12px;
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
</style>
