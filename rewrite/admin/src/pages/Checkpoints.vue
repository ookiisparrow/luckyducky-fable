<script setup lang="ts">
// 节点诊断策展（M3 批5）：为某门课维护「关键节点 + 挽回办法」（学员卡壳时坐席据此精准指导）。
// 整课覆盖式保存——只动定义、绝不碰学员拍照提交（云端保证）。
import { ref } from 'vue'
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
  <div>
    <h2>节点诊断（关键节点策展）</h2>
    <div class="searchrow">
      <input v-model="courseId" placeholder="course-xxx" @keyup.enter="load" />
      <button class="act" @click="load">载入</button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>

    <template v-if="loaded">
      <div v-for="(n, i) in nodes" :key="i" class="noderow">
        <input v-model="n.nodeId" placeholder="节点 id（如 n1）" class="nid" />
        <input v-model="n.title" placeholder="节点名（如 第二段收口）" maxlength="100" />
        <textarea v-model="n.remedy" placeholder="挽回办法（学员卡这里时坐席照此指导·≤2000 字）" maxlength="2000" />
        <button class="act ghost" @click="nodes.splice(i, 1)">删</button>
      </div>
      <div class="ops">
        <button class="act ghost" @click="addNode">+ 加节点</button>
        <button class="act" :disabled="busy" @click="save">保存整课</button>
      </div>
    </template>
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
  max-width: 420px;
}
.searchrow input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
.noderow {
  display: grid;
  grid-template-columns: 110px 1fr 2fr auto;
  gap: 8px;
  align-items: start;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 900px;
}
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
}
</style>
