<script setup lang="ts">
// 知识库（设计语言一致性·M3 UI 批14）：FAQ 整册编辑（客服 bot 与坐席快捷回复读同一份·整体覆盖式保存——删行即真删）。
// 逻辑未动，仅套设计语言（页头/FAQ 行卡/分类 select/启用勾选/token）。
import { ref, onMounted } from 'vue'
import { Trash2, Plus } from 'lucide-vue-next'
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
  <div class="page">
    <header class="page-head">
      <div>
        <h1>知识库（FAQ）</h1>
        <p class="sub">客服机器人和坐席快捷回复读的是同一份；保存是整册覆盖——删掉的行即真删。</p>
      </div>
      <button class="btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存整册' }}</button>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-for="(row, i) in rows" :key="row.key" class="kb-card">
      <div class="kb-head">
        <select v-model="row.category" class="cat">
          <option v-for="c in CATS" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <input v-model="row.question" placeholder="问题（≤200 字）" maxlength="200" class="q" />
        <label class="en"><input v-model="row.enabled" type="checkbox" /><span>启用</span></label>
        <button class="icon-btn" title="删行" @click="rows.splice(i, 1)"><Trash2 :size="14" :stroke-width="1.8" /></button>
      </div>
      <textarea v-model="row.answer" placeholder="答案（≤2000 字·bot 原样发给顾客）" maxlength="2000" />
    </div>

    <button class="add-btn" @click="addRow"><Plus :size="14" :stroke-width="2" /><span>加一条 FAQ</span></button>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
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
.kb-card {
  padding: 14px 16px;
  margin-bottom: 10px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.kb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.cat {
  flex: none;
  width: 90px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  background: var(--ld-bg);
}
.q {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
}
.en {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: 12px;
  color: var(--ld-content-2);
  cursor: pointer;
}
.en input {
  width: 15px;
  height: 15px;
  accent-color: var(--ld-brand);
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
textarea {
  width: 100%;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--ld-font);
  box-sizing: border-box;
  resize: vertical;
}
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border: 1px dashed var(--ld-purple-line);
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
</style>
