<script setup lang="ts">
// 帮助视频（设计语言一致性·M3 UI 批12）：播放页「遇到问题了」求助面板内容源（主题→小段两级·全课程共用一份）。
// 逻辑未动，仅套设计语言（页头/主题卡/段上传 chip/token）。
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Upload, Check, Trash2, Plus, Video } from 'lucide-vue-next'
import { listHelpVideos, saveHelpVideos, uploadVideo } from '../api/content'
import { normalizeHelpItems, type HelpItem } from '../lib/mapContent'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const items = ref<HelpItem[]>([])
const message = ref('')
const busy = ref(false)
const progress = ref('')
const confirmKey = ref('') // no-alert 两步删除确认（换皮改直接 splice·误删即丢）

async function reload() {
  const r = await listHelpVideos()
  loaded = false // 载入期不触发自动保存
  items.value = r.ok ? normalizeHelpItems(r.items) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
  saveState.value = ''
  void nextTick(() => (loaded = true)) // 载入后的用户编辑才自动保存
}

// 视频时长自动读取（换皮丢·选完视频读元数据填 dur·mm:ss）
function readDuration(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      const s = Math.round(v.duration || 0)
      resolve(s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('')
    }
    v.src = url
  })
}

// 防抖自动保存（换皮退成手动按钮·编排忘点即丢）：900ms + 离页补存·load 期不触发·不 reload（免打断编辑）
const saveState = ref<'' | 'saving' | 'saved' | 'error'>('')
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
function autosave() {
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const r = await saveHelpVideos(items.value)
    saveState.value = r.ok ? 'saved' : 'error'
  }, 900)
}
watch(items, () => { if (loaded) autosave() }, { deep: true })
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (saveState.value === 'saving') void saveHelpVideos(items.value)
})

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
  if (!t.segments[i].dur) t.segments[i].dur = await readDuration(file) // 时长自动读取（未填才读）
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
  <div class="ld-page help">
    <PageHeader title="帮助视频" sub="小程序播放页「遇到问题了」面板的内容；主题下每个小段挂一条视频，全课程共用一份。">
      <span v-if="saveState" class="autosave" :class="saveState">{{ saveState === 'saving' ? '自动保存中…' : saveState === 'saved' ? '已自动保存' : '自动保存失败·点保存重试' }}</span>
      <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存全部' }}</UiButton>
    </PageHeader>

    <p v-if="message" class="status">{{ message }}</p>
    <p v-if="progress" class="uploading">{{ progress }}</p>

    <!-- 逐主题卡（外框由 Card 提供）：标题/副/描述 + 逐小段·上移下移/两步删除 -->
    <Card v-for="(t, ti) in items" :key="ti">
      <div class="topic-head">
        <Badge tone="brand">主题 {{ ti + 1 }}</Badge>
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
    </Card>

    <EmptyState v-if="!items.length" :icon="Video" text="还没有帮助主题，点下方「加主题」新建第一个" />

    <div><button class="add-topic" @click="addTopic"><Plus :size="15" :stroke-width="2" /><span>加主题</span></button></div>
  </div>
</template>

<style scoped>
/* 页级宽度（页头/卡/节奏由 kit：PageHeader·Card·ld-page gap） */
.help {
  max-width: 820px;
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
/* 自动保存 chip（页头右侧操作槽） */
.autosave {
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.autosave.saving {
  color: var(--ld-content-2);
}
.autosave.saved {
  color: var(--ld-green);
}
.autosave.error {
  color: var(--ld-red);
}
/* 主题头（外框由 Card 提供）：徽章 + 标题/副题 + ↑ ↓ 删 */
.topic-head {
  display: flex;
  align-items: center;
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
  border-radius: var(--ld-radius-sm);
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
/* 小段行：段名 / 时长 / 上传位 / ↑ ↓ 删 */
.seg {
  display: grid;
  grid-template-columns: 1fr 100px auto auto auto auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
/* 视频上传位（未传=紫描边 / 已传=绿） */
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
/* 树内 ↑ ↓ 删 图标按钮（危态转红） */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.icon-btn.warn {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
/* 加小段（树内增项·虚线药丸） */
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
/* 加主题（页级增项·虚线药丸） */
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
