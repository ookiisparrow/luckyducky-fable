<script setup lang="ts">
// 帮助视频（设计语言一致性·M3 UI 批12）：播放页「遇到问题了」求助面板内容源（主题→小段两级·全课程共用一份）。
// 逻辑未动，仅套设计语言（页头/主题卡/段上传 chip/token）。
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Upload, Check, Trash2, Plus, Video } from 'lucide-vue-next'
import { listHelpVideos, saveHelpVideos, uploadVideo } from '../api/content'
import { normalizeHelpItems, type HelpItem } from '../lib/mapContent'
import { serialSave } from '../lib/serialSave'
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
const baseRev = ref(0) // 拉取那一刻的版本号（乐观并发基线·批A·内容域并发安全）
const conflicted = ref(false) // 冲突态：别处已改过帮助视频档——停自动保存防连环覆盖，重新载入解除

async function reload() {
  const r = await listHelpVideos()
  confirmKey.value = '' // 刷新即复位危险态（P1·防旧武装的删主题/删段残留、重进同一位一击直删·批3 规格）
  loaded = false // 载入期不触发自动保存
  items.value = r.ok ? normalizeHelpItems(r.items) : []
  if (r.ok) {
    baseRev.value = Number(r.rev) || 0 // 记下拉取那一刻的版本号
    conflicted.value = false // 重新载入即解除冲突态·恢复自动保存
  }
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
  saveState.value = ''
  // 只有载入成功才放开自动保存——载入失败(items=[]) 绝不 arm autosave，否则一次编辑就 saveHelpVideos([]) 触发后端整档覆盖 +
  // 孤儿 GC 永久删光所有帮助视频文件（P1 不可逆·同 Courses.load 早退范式）。载入失败时 loaded 恒 false，autosave 与手动 save 都拒。
  if (r.ok) void nextTick(() => (loaded = true))
  return r.ok
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
// 串行化实际保存（防慢网下两次自动保存乱序覆盖·P2·根因#8）：run 现读 items.value·补存即最新。
// P1 兜底单点：载入失败或 reload 清空后 loaded=false，任何在途 timer / 离页补存 / 手动保存路径进到这里都直接 no-op——
// 杜绝拿空/残缺 items 整档覆盖 + 孤儿 GC 删光云端帮助视频（gate loaded 已挡 watch 与 save 入口·此处收口所有写者）。
// key='help-videos'（批D·P1）：改走模块级共享槽位，快速切走再切回本页重建组件实例时，新实例接管旧实例
// 仍在途的补存链，防旧快照晚到覆盖新实例已存的编辑（全课程共用一份·本就是单一资源，泛 key 恰好对应）。
const flushSave = serialSave(async () => {
  if (!loaded || conflicted.value) return // 冲突态阻断写者（批A·不得循环重试覆盖别处的编辑）
  const r = await saveHelpVideos(items.value, baseRev.value)
  if (r.ok || r.error === 'GC_DELETE_FAIL') {
    // 保存已成功刷新基线（GC_DELETE_FAIL＝内容落库成功、仅孤儿视频删除失败·后端已 bump rev）——必须与手动 save()
    // 一致，否则漏刷会让下一次自动保存拿旧 baseRev 撞出「自造的」假 DRAFT_CONFLICT，永久锁死自动保存链（含离页补存）。
    baseRev.value = Number(r.rev) || baseRev.value + 1
    saveState.value = r.ok ? 'saved' : 'error' // GC 失败仍算保存过、但显 error 提示点保存重试删孤儿
  } else if (r.error === 'DRAFT_CONFLICT') {
    // 别处（另一页签/窗口/管理员）已保存过更新版本：停自动保存·显式提示·不自动 reload 不丢当前编辑
    conflicted.value = true
    saveState.value = 'error'
    message.value = '内容已被别处修改，请重新载入后再保存'
  } else saveState.value = 'error'
}, 'help-videos')
function autosave() {
  if (conflicted.value) return // 冲突态不再武装自动保存（等人工重新载入解除）
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null // 触发后清空·让 saveTimer 真实反映「有未落盘的待发编辑」
    void flushSave()
  }, 900)
}
watch(items, () => { if (loaded && !conflicted.value) autosave() }, { deep: true })
// 离页补存判据用 pending saveTimer 而非 saveState==='saving'：先发的自动保存完成会把 saveState 复位成 'saved'，
// 后一次编辑只活在待触发的 timer 里——按 saveState 判会漏补、离页丢这次编辑（P2·同 Showcase/HomeContent）
onBeforeUnmount(() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    void flushSave()
  }
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
  confirmKey.value = '' // 重排后清「已武装删除」·防下标编码的 confirmKey 落到换位后的另一元素→删错（P2）
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
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 重置 value：允许上传失败后重选同一文件重试（否则浏览器不再触发 change）
  if (!file) return
  // 上传前捕获段「对象引用」而非下标（P1·根因#8）：秒级上传窗口内若重排/删段，按下标回写会落到换位后的
  // 另一段（静默错位·随 autosave 落库）或越界崩溃；写对象引用则始终落到本段、删段后写孤儿也不崩。
  const seg = t.segments[i]
  if (!seg) return
  progress.value = '上传中 0%'
  if (!seg.dur) seg.dur = await readDuration(file) // 时长自动读取（未填才读）
  const r = await uploadVideo('help', seg.name || 'seg', file, (p) => (progress.value = `上传中 ${Math.round(p * 100)}%`))
  progress.value = ''
  if (r.ok) {
    seg.videoFileId = r.fileId || ''
    message.value = ''
  } else message.value = '视频上传失败：' + String(r.error || '')
}

async function save() {
  if (busy.value) return
  if (!loaded) {
    // 未成功载入即手动保存 = 拿空/残缺 items 整档覆盖 + 孤儿 GC 删光云端视频文件（P1）——拒绝并提示刷新（gate loaded 已挡 autosave·此挡手动路径）
    message.value = '内容未成功载入，暂不能保存（避免覆盖并误删已有帮助视频·请刷新重试）'
    return
  }
  if (saveTimer) {
    clearTimeout(saveTimer) // 清在途防抖 timer·防其在随后 reload 清空 items+loaded=false 后再触发（P1·同 Courses/HomeContent·flushSave run 已 gate loaded 兜底）
    saveTimer = null
  }
  busy.value = true
  await flushSave() // 先排空在途/待发自动保存·防旧快照 POST 落在手动保存之后覆盖新编辑（P2·同 HomeContent/Products.closeEditor）
  const r = await saveHelpVideos(items.value, baseRev.value)
  busy.value = false
  if (r.ok || r.error === 'GC_DELETE_FAIL') baseRev.value = Number(r.rev) || baseRev.value // 刷新基线（保存已成功·GC 失败也已 bump rev）
  if (!r.ok) {
    if (r.error === 'DRAFT_CONFLICT') {
      // 别处已保存过更新版本：拒写防互相覆盖·不 reload 不丢当前编辑（批A·迭代I 载入失败保护范式）
      conflicted.value = true
      message.value = '内容已被别处修改，请重新载入后再保存'
      return
    }
    // 失败留原文·不 reload——否则 listHelpVideos 会把编辑器换回旧数据（丢未存编辑）并抹掉本条错（病根#14·同 Kb）
    message.value = '保存失败：' + String(r.error || '')
    return
  }
  const okR = await reload() // 成功才刷（反映云端剔除无视频的小段）
  // 只在刷新也成功时显纯成功；刷新失败保留其「加载失败」可见、不被成功盖掉（病根#14 失败必可观测·迭代I 批7 回归修）
  message.value = okR ? '已保存（无视频的小段会被云端剔除）' : '已保存，但列表刷新失败，请重开本页确认'
}

onMounted(reload)
</script>

<template>
  <div class="ld-page help">
    <PageHeader title="帮助视频" sub="小程序播放页「遇到问题了」面板的内容；主题下每个小段挂一条视频，全课程共用一份。">
      <span v-if="saveState" class="autosave" :class="saveState">{{ saveState === 'saving' ? '自动保存中…' : saveState === 'saved' ? '已自动保存' : '自动保存失败·点保存重试' }}</span>
      <!-- 空态无可存内容时禁用（批6·曾在零主题时仍高亮主按钮） -->
      <UiButton :disabled="busy || !items.length" @click="save">{{ busy ? '保存中…' : '保存全部' }}</UiButton>
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
