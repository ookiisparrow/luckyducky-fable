<script setup lang="ts">
// 帮助视频（设计语言一致性·M3 UI 批12）：播放页「遇到问题了」求助面板内容源（主题→小段两级·全课程共用一份）。
// 逻辑未动，仅套设计语言（页头/主题卡/段上传 chip/token）。
import { ref, onMounted } from 'vue'
import { Upload, Check, Trash2, Plus } from 'lucide-vue-next'
import { listHelpVideos, saveHelpVideos, uploadVideo } from '../api/content'
import { normalizeHelpItems, type HelpItem } from '../lib/mapContent'

const items = ref<HelpItem[]>([])
const message = ref('')
const busy = ref(false)
const progress = ref('')
const confirmKey = ref('') // no-alert 两步删除确认（换皮改直接 splice·误删即丢）

async function reload() {
  const r = await listHelpVideos()
  items.value = r.ok ? normalizeHelpItems(r.items) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function twoStep(key: string, run: () => void) {
  if (confirmKey.value !== key) {
    confirmKey.value = key
    return
  }
  confirmKey.value = ''
  run()
}
// ↑↓ 重排（换皮丢了重排·主题/小段顺序有意义·嵌套结构 ↑↓ 比拖拽稳）
function move<T>(arr: T[], i: number, dir: number) {
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  const t = arr[i]
  arr[i] = arr[j]
  arr[j] = t
}

function addTopic() {
  items.value.push({ id: '', title: '', sub: '', desc: '', segments: [] })
}
function delTopic(i: number) {
  twoStep('t:' + i, () => items.value.splice(i, 1))
}
function addSeg(t: HelpItem) {
  t.segments.push({ id: '', name: '', dur: '', videoFileId: '' })
}
function delSeg(t: HelpItem, ti: number, i: number) {
  twoStep('s:' + ti + ':' + i, () => t.segments.splice(i, 1))
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
  <div class="page">
    <header class="page-head">
      <div>
        <h1>帮助视频</h1>
        <p class="sub">小程序播放页「遇到问题了」面板的内容；主题下每个小段挂一条视频，全课程共用一份。</p>
      </div>
      <button class="btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存全部' }}</button>
    </header>

    <p v-if="message" class="status">{{ message }}</p>
    <p v-if="progress" class="uploading">{{ progress }}</p>

    <div v-for="(t, ti) in items" :key="ti" class="topic-card">
      <div class="topic-head">
        <input v-model="t.title" placeholder="主题（如 起针总松？）" maxlength="40" class="t-title" />
        <input v-model="t.sub" placeholder="副题" maxlength="40" class="t-sub" />
        <button class="icon-btn" title="上移" :disabled="ti === 0" @click="move(items, ti, -1)">↑</button>
        <button class="icon-btn" title="下移" :disabled="ti === items.length - 1" @click="move(items, ti, 1)">↓</button>
        <button class="icon-btn" :class="{ warn: confirmKey === 't:' + ti }" :title="confirmKey === 't:' + ti ? '再点确认删除' : '删主题'" @click="delTopic(ti)"><Trash2 :size="14" :stroke-width="1.8" /></button>
      </div>
      <textarea v-model="t.desc" placeholder="描述（≤150 字）" maxlength="150" />
      <div v-for="(sg, si) in t.segments" :key="si" class="seg">
        <input v-model="sg.name" placeholder="小段名" maxlength="40" class="seg-name" />
        <input v-model="sg.dur" placeholder="时长（如 1:30）" maxlength="10" class="dur" />
        <label class="upload" :class="{ done: sg.videoFileId }">
          <component :is="sg.videoFileId ? Check : Upload" :size="13" :stroke-width="2" />
          <span>{{ sg.videoFileId ? '已传 · 替换' : '选视频' }}</span>
          <input type="file" accept="video/mp4,video/quicktime" hidden @change="(e) => pickVideo(t, si, e)" />
        </label>
        <button class="icon-btn" title="上移" :disabled="si === 0" @click="move(t.segments, si, -1)">↑</button>
        <button class="icon-btn" title="下移" :disabled="si === t.segments.length - 1" @click="move(t.segments, si, 1)">↓</button>
        <button class="icon-btn" :class="{ warn: confirmKey === 's:' + ti + ':' + si }" :title="confirmKey === 's:' + ti + ':' + si ? '再点确认删除' : '删段'" @click="delSeg(t, ti, si)"><Trash2 :size="14" :stroke-width="1.8" /></button>
      </div>
      <button class="add-btn" @click="addSeg(t)"><Plus :size="13" :stroke-width="2" /><span>加小段</span></button>
    </div>

    <button class="add-topic" @click="addTopic"><Plus :size="15" :stroke-width="2" /><span>加主题</span></button>
  </div>
</template>

<style scoped>
.page {
  max-width: 820px;
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
.uploading {
  font-size: 12.5px;
  color: var(--ld-brand-active);
  font-weight: 600;
}
.topic-card {
  padding: 16px 18px;
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.topic-head {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.t-title {
  flex: 2;
  min-width: 0;
}
.t-sub {
  flex: 1;
  min-width: 0;
}
input,
textarea {
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--ld-font);
}
textarea {
  width: 100%;
  min-height: 42px;
  box-sizing: border-box;
  margin-bottom: 10px;
  resize: vertical;
}
.seg {
  display: grid;
  grid-template-columns: 1fr 100px auto auto auto auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.icon-btn.warn {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
.upload {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-brand-active);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.upload.done {
  border-color: var(--ld-green);
  color: var(--ld-green);
  background: var(--ld-bg-green-soft);
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
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  padding: 6px 14px;
  border: 1px dashed var(--ld-purple-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-brand-active);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.add-topic {
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
