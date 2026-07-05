<script setup lang="ts">
// 节点诊断策展（设计语言一致性·M3 UI 批15）：为某门课维护「关键节点 + 挽回办法」（学员卡壳时坐席据此精准指导）。
// 整课覆盖式保存——只动定义、绝不碰学员拍照提交（云端保证）。逻辑未动，仅套设计语言。
import { ref } from 'vue'
import { RotateCcw, Trash2, Plus } from 'lucide-vue-next'
import { listCheckpoints, saveCheckpoints } from '../api/cs'

interface NodeRow {
  nodeId: string
  title: string
  remedy: string
  order: number
}

const courseId = ref('')
const nodes = ref<NodeRow[]>([])
const loaded = ref(false)
const message = ref('')
const busy = ref(false)

async function load() {
  if (!courseId.value.trim()) return
  const r = await listCheckpoints(courseId.value.trim())
  nodes.value = r.ok
    ? ((r.list as Record<string, any>[]) || []).map((n) => ({ nodeId: String(n.nodeId || ''), title: String(n.title || ''), remedy: String(n.remedy || ''), order: Number(n.order) || 0 }))
    : []
  loaded.value = r.ok
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function addNode() {
  nodes.value.push({ nodeId: 'n' + (nodes.value.length + 1), title: '', remedy: '', order: nodes.value.length })
}

async function save() {
  if (busy.value || !courseId.value.trim()) return
  busy.value = true
  const r = await saveCheckpoints(courseId.value.trim(), nodes.value)
  busy.value = false
  message.value = r.ok ? `已保存 ${Number(r.count) || 0} 个节点（整课覆盖·学员提交不受影响）` : '保存失败：' + String(r.error || '')
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>节点诊断（关键节点策展）</h1>
        <p class="sub">为某门课维护「关键节点 + 挽回办法」，学员卡壳时坐席照此精准指导。整课覆盖保存，不碰学员提交。</p>
      </div>
      <button v-if="loaded" class="btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存整课' }}</button>
    </header>

    <div class="toolbar">
      <input v-model="courseId" placeholder="course-xxx" class="cid" @keyup.enter="load" />
      <button class="act ghost" @click="load"><RotateCcw :size="14" :stroke-width="1.8" /><span>载入</span></button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>

    <template v-if="loaded">
      <div v-for="(n, i) in nodes" :key="i" class="node-card">
        <div class="node-head">
          <input v-model="n.nodeId" placeholder="节点 id（如 n1）" class="nid" />
          <input v-model="n.title" placeholder="节点名（如 第二段收口）" maxlength="100" class="ntitle" />
          <button class="icon-btn" title="删节点" @click="nodes.splice(i, 1)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>
        <textarea v-model="n.remedy" placeholder="挽回办法（学员卡这里时坐席照此指导·≤2000 字）" maxlength="2000" />
      </div>
      <button class="add-btn" @click="addNode"><Plus :size="14" :stroke-width="2" /><span>加节点</span></button>
    </template>
    <p v-else-if="!message" class="status-soft">输入课程编号（course-xxx）载入其关键节点</p>
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
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  max-width: 420px;
}
.cid {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  font-size: 13px;
}
.status {
  font-size: 13px;
  color: var(--ld-content-2);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.node-card {
  padding: 14px 16px;
  margin-bottom: 10px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.node-head {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.nid {
  flex: none;
  width: 120px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--ld-font-mono);
}
.ntitle {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
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
