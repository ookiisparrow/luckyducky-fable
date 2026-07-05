<script setup lang="ts">
// 激活码批次（M3 批6）：按课列批次（总数/激活数/激活率）+ 建批次 + 看码/复制。
// 二维码图片生成与打印导出（旧台 qrcode+jszip）随印刷批补——记待办·此处先文本码可复制。
import { ref } from 'vue'
import { listBatches, createBatch, listBatchCodes } from '../api/system'
import { mapBatches, type BatchRow } from '../lib/mapSystem'

const courseId = ref('')
const rows = ref<BatchRow[]>([])
const message = ref('')
const busy = ref(false)
const count = ref(50)
const codes = ref<string[]>([])
const codesOf = ref('')

async function load() {
  if (!courseId.value.trim()) return
  const r = await listBatches(courseId.value.trim())
  rows.value = r.ok ? mapBatches(r.list) : []
  message.value = r.ok ? (rows.value.length ? '' : '这门课还没有批次') : '加载失败：' + String(r.error || '')
}

async function doCreate() {
  if (busy.value) return
  if (!Number.isInteger(count.value) || count.value < 1) {
    message.value = '数量要是正整数'
    return
  }
  busy.value = true
  const r = await createBatch(courseId.value.trim(), count.value)
  busy.value = false
  message.value = r.ok ? `已生成批次 ${String(r.batchId)}（${(r.codes as string[]).length} 张码）` : '生成失败：' + String(r.error || '')
  void load()
}

async function showCodes(batchId: string) {
  const r = await listBatchCodes(batchId)
  codes.value = r.ok ? (r.codes as string[]) : []
  codesOf.value = batchId
  message.value = r.ok ? '' : '取码失败：' + String(r.error || '')
}

async function copyCodes() {
  await navigator.clipboard.writeText(codes.value.join('\n'))
  message.value = `已复制 ${codes.value.length} 张码`
}
</script>

<template>
  <div>
    <h2>激活码批次</h2>
    <div class="searchrow">
      <input v-model="courseId" placeholder="course-xxx" @keyup.enter="load" />
      <button class="act" @click="load">载入</button>
      <input v-model.number="count" type="number" class="cnt" min="1" max="500" />
      <button class="act warn" :disabled="busy || !courseId.trim()" @click="doCreate">生成新批次</button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>

    <table v-if="rows.length">
      <thead><tr><th>批次</th><th>总数</th><th>已激活</th><th>激活率</th><th>生成时间</th><th></th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.batchId">
          <td class="mono">{{ row.batchId }}</td>
          <td>{{ row.total }}</td>
          <td>{{ row.activated }}</td>
          <td>{{ row.rateLabel }}</td>
          <td>{{ row.createdAt }}</td>
          <td><button class="act ghost" @click="showCodes(row.batchId)">看码</button></td>
        </tr>
      </tbody>
    </table>

    <div v-if="codes.length" class="codesbox">
      <h3>{{ codesOf }} · {{ codes.length }} 张 <button class="act small" @click="copyCodes">全部复制</button></h3>
      <code v-for="c in codes" :key="c">{{ c }}</code>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
.searchrow {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
.searchrow input {
  padding: 8px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.cnt {
  width: 90px;
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
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
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.codesbox {
  margin-top: 14px;
  padding: 14px 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
.codesbox h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--ld-purple-ink);
}
.codesbox code {
  display: inline-block;
  margin: 2px 6px 2px 0;
  padding: 2px 8px;
  background: var(--ld-bg-faint);
  border-radius: 4px;
  font-size: 12px;
}
.act {
  padding: 6px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
.act.warn {
  background: var(--ld-red);
}
.act.small {
  padding: 3px 12px;
  font-size: 11px;
}
.act:disabled {
  opacity: 0.4;
}
</style>
