<script setup lang="ts">
// 小程序橱窗（设计语言一致性·M3 UI 批11）：首页排序 + 推荐位勾选，一键保存（与小程序 getProducts 排序同源）。
// 逻辑未动，仅套设计语言（页头/grid 表/状态 chip/token）。
import { ref, onMounted } from 'vue'
import { listShowcase, saveShowcase } from '../api/products'
import { mapShowcaseRows, type ShowcaseRowVM } from '../lib/mapProducts'

const rows = ref<ShowcaseRowVM[]>([])
const message = ref('')
const busy = ref(false)

async function reload() {
  message.value = '加载中…'
  const r = await listShowcase()
  rows.value = r.ok ? mapShowcaseRows(r.list, r.urls) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

async function save() {
  if (busy.value) return
  busy.value = true
  const r = await saveShowcase(rows.value.map((x) => ({ id: x.id, sort: Number(x.sort) || 0, featured: x.featured })))
  busy.value = false
  message.value = r.ok ? '已保存，小程序首页立即生效' : '保存失败：' + String(r.error || '')
  void reload()
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>小程序橱窗</h1>
        <p class="sub">sort 越小越靠前；「推荐」对应首页推荐位。已下架商品不出现在小程序里，但保留排序。</p>
      </div>
      <button v-if="rows.length" class="btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存橱窗' }}</button>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-if="rows.length" class="table">
      <div class="thead">
        <span>商品</span><span class="r">排序 sort</span><span>推荐位</span><span>在售</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="trow">
        <div class="prod">
          <img v-if="row.coverUrl" :src="row.coverUrl" class="thumb" />
          <span v-else class="thumb empty">无图</span>
          <div class="prod-text">
            <div class="prod-name">{{ row.name }}</div>
            <div class="pid">{{ row.id }}</div>
          </div>
        </div>
        <span class="r"><input v-model.number="row.sort" type="number" class="sortin" /></span>
        <label class="feat"><input v-model="row.featured" type="checkbox" /><span>推荐</span></label>
        <span><span class="state" :class="row.listed ? 'on' : 'off'">{{ row.listed ? '在售' : '已下架' }}</span></span>
      </div>
    </div>
    <p v-else-if="!message" class="status-soft">还没有可排序的商品</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 960px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ld-ink);
}
.sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.btn-primary {
  flex: none;
  padding: 10px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.5;
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.table {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 3fr 1fr 1fr 1fr;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.r {
  text-align: right;
  justify-self: end;
}
.prod {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.thumb {
  width: 46px;
  height: 46px;
  flex: none;
  object-fit: cover;
  border-radius: 10px;
  background: var(--ld-bg-sage);
}
.thumb.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--ld-content-2);
}
.prod-name {
  font-weight: 600;
  color: var(--ld-ink);
}
.pid {
  font-size: 11px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
  margin-top: 2px;
}
.sortin {
  width: 72px;
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  text-align: right;
}
.feat {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--ld-content);
  cursor: pointer;
}
.feat input {
  width: 16px;
  height: 16px;
  accent-color: var(--ld-brand);
}
.state {
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 11.5px;
}
.state.on {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.state.off {
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
</style>
