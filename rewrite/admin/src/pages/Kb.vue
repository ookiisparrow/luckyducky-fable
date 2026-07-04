<script setup lang="ts">
// 知识库（M3 批5）：FAQ 整册编辑（客服 bot 与坐席快捷回复读同一份·整体覆盖式保存——删行即真删）。
import { ref, onMounted } from 'vue'
import { listKb, saveKb } from '../api/cs'
import { normalizeKb, type KbRow } from '../lib/mapCs'

const CATS = [
  { key: 'logistics', label: '物流' },
  { key: 'activation', label: '激活' },
  { key: 'aftersale', label: '售后' },
  { key: 'tutorial', label: '教程' },
  { key: 'other', label: '其他' },
]

const rows = ref<KbRow[]>([])
const message = ref('')
const busy = ref(false)

async function reload() {
  const r = await listKb()
  rows.value = r.ok ? normalizeKb(r.list) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function addRow() {
  rows.value.push({ key: 'faq-' + Date.now().toString(36), question: '', answer: '', category: 'other', enabled: true, order: rows.value.length })
}

async function save() {
  if (busy.value) return
  busy.value = true
  const r = await saveKb(rows.value)
  busy.value = false
  message.value = r.ok ? `已保存 ${Number(r.count) || 0} 条（整册覆盖·被删的行已真删）` : '保存失败：' + String(r.error || '')
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>知识库（FAQ）</h2>
    <p class="hint">客服机器人和坐席快捷回复读的是同一份；保存是整册覆盖——删掉的行即真删。</p>
    <p v-if="message" class="status">{{ message }}</p>

    <div v-for="(row, i) in rows" :key="row.key" class="kbrow">
      <select v-model="row.category">
        <option v-for="c in CATS" :key="c.key" :value="c.key">{{ c.label }}</option>
      </select>
      <input v-model="row.question" placeholder="问题（≤200 字）" maxlength="200" />
      <textarea v-model="row.answer" placeholder="答案（≤2000 字·bot 原样发给顾客）" maxlength="2000" />
      <label class="en"><input v-model="row.enabled" type="checkbox" />启用</label>
      <button class="act ghost" @click="rows.splice(i, 1)">删行</button>
    </div>

    <div class="ops">
      <button class="act ghost" @click="addRow">+ 加一条</button>
      <button class="act" :disabled="busy" @click="save">保存整册</button>
    </div>
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
  margin: 0 0 12px;
}
.status {
  font-size: 13px;
  color: #c0392b;
}
.kbrow {
  display: grid;
  grid-template-columns: 90px 1fr 2fr auto auto;
  gap: 8px;
  align-items: start;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 900px;
}
select,
input,
textarea {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
textarea {
  min-height: 40px;
}
.en {
  font-size: 12px;
  color: var(--ld-purple-meta);
  display: flex;
  align-items: center;
  gap: 4px;
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
.act:disabled {
  opacity: 0.5;
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
