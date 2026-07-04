<script setup lang="ts">
// 帮助视频（M3 批4）：播放页「遇到问题了」求助面板的内容源（主题→小段两级·全课程共用一份）。
import { ref, onMounted } from 'vue'
import { listHelpVideos, saveHelpVideos, uploadVideo } from '../api/content'
import { normalizeHelpItems, type HelpItem } from '../lib/mapContent'

const items = ref<HelpItem[]>([])
const message = ref('')
const busy = ref(false)
const progress = ref('')

async function reload() {
  const r = await listHelpVideos()
  items.value = r.ok ? normalizeHelpItems(r.items) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function addTopic() {
  items.value.push({ id: '', title: '', sub: '', desc: '', segments: [] })
}
function delTopic(i: number) {
  items.value.splice(i, 1)
}
function addSeg(t: HelpItem) {
  t.segments.push({ id: '', name: '', dur: '', videoFileId: '' })
}
function delSeg(t: HelpItem, i: number) {
  t.segments.splice(i, 1)
}

async function pickVideo(t: HelpItem, i: number, ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  progress.value = '上传中 0%'
  const r = await uploadVideo('help', t.segments[i].name || 'seg', file, (p) => (progress.value = `上传中 ${Math.round(p * 100)}%`))
  progress.value = ''
  if (r.ok) {
    t.segments[i].videoFileId = r.fileId || ''
    message.value = ''
  } else message.value = '视频上传失败：' + String(r.error || '')
}

async function save() {
  if (busy.value) return
  busy.value = true
  const r = await saveHelpVideos(items.value)
  busy.value = false
  message.value = r.ok ? '已保存（无视频的小段会被云端剔除）' : '保存失败：' + String(r.error || '')
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>帮助视频</h2>
    <p class="hint">小程序播放页「遇到问题了」面板的内容；主题下每个小段一条视频。</p>
    <p v-if="message" class="status">{{ message }}</p>
    <p v-if="progress" class="hint">{{ progress }}</p>

    <div v-for="(t, ti) in items" :key="ti" class="panel">
      <div class="topic">
        <input v-model="t.title" placeholder="主题（如 起针总松？）" maxlength="40" />
        <input v-model="t.sub" placeholder="副题" maxlength="40" />
        <button class="act warn" @click="delTopic(ti)">删主题</button>
      </div>
      <textarea v-model="t.desc" placeholder="描述（≤150 字）" maxlength="150" />
      <div v-for="(sg, si) in t.segments" :key="si" class="segrow">
        <input v-model="sg.name" placeholder="小段名" maxlength="40" />
        <input v-model="sg.dur" placeholder="时长（如 1:30）" maxlength="10" />
        <label class="file">{{ sg.videoFileId ? '已传 ✓ 替换' : '选视频' }}<input type="file" accept="video/mp4,video/quicktime" hidden @change="(e) => pickVideo(t, si, e)" /></label>
        <button class="act ghost" @click="delSeg(t, si)">删</button>
      </div>
      <button class="act ghost" @click="addSeg(t)">+ 加小段</button>
    </div>

    <div class="ops">
      <button class="act ghost" @click="addTopic">+ 加主题</button>
      <button class="act" :disabled="busy" @click="save">保存全部</button>
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
.panel {
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 760px;
}
.topic {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  margin-bottom: 8px;
}
textarea {
  width: 100%;
  min-height: 40px;
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
  margin-bottom: 8px;
}
input {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.segrow {
  display: grid;
  grid-template-columns: 2fr 1fr auto auto;
  gap: 8px;
  margin-bottom: 6px;
  align-items: center;
}
.file {
  font-size: 12px;
  color: var(--ld-purple-tab);
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  padding: 6px 14px;
  cursor: pointer;
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
  background: #c0392b;
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
