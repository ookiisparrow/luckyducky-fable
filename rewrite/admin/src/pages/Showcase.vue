<script setup lang="ts">
// 小程序橱窗（M3 批3）：首页排序 + 推荐位勾选，改完一键保存（与小程序 getProducts 排序同源）。
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
  <div>
    <h2>小程序橱窗</h2>
    <p class="hint">sort 越小越靠前；「推荐」对应首页推荐位。已下架商品不会出现在小程序里，但保留排序。</p>
    <p v-if="message" class="status">{{ message }}</p>
    <table v-if="rows.length">
      <thead>
        <tr><th>封面</th><th>商品</th><th>排序 sort</th><th>推荐位</th><th>在售</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td><img v-if="row.coverUrl" :src="row.coverUrl" class="thumb" /><span v-else class="thumb empty">无图</span></td>
          <td>{{ row.name }}<div class="pid">{{ row.id }}</div></td>
          <td><input v-model.number="row.sort" type="number" class="sortin" /></td>
          <td><input v-model="row.featured" type="checkbox" /></td>
          <td>{{ row.listed ? '✓' : '已下架' }}</td>
        </tr>
      </tbody>
    </table>
    <button v-if="rows.length" class="act" :disabled="busy" @click="save">保存橱窗</button>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 8px;
  color: var(--ld-purple-ink);
}
.hint {
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin: 0 0 14px;
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
  margin-bottom: 14px;
}
th,
td {
  padding: 10px 12px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-meta);
}
.thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 8px;
  background: var(--ld-bg-faint);
  display: inline-block;
}
.thumb.empty {
  font-size: 11px;
  color: var(--ld-purple-meta);
  text-align: center;
  line-height: 48px;
}
.pid {
  font-size: 11px;
  color: var(--ld-purple-meta);
  font-family: ui-monospace, monospace;
}
.sortin {
  width: 80px;
  padding: 6px 8px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
}
.act {
  padding: 8px 24px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.act:disabled {
  opacity: 0.5;
}
</style>
