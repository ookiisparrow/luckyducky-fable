<script setup lang="ts">
// 课程管理（design/console.pen S2 课程编排视觉·M3 UI 批10）：章→课时→段 树编辑 + 每段视频直传 + 发布
// （引用模型·老学员自动生效；孤儿视频云端 GC）。逻辑批10 未动，仅套设计语言（页头/视频进度条/章节卡/段上传 chip）。
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { RotateCcw, Plus, Trash2, Upload, Check } from 'lucide-vue-next'
import { getCourseDraft, saveCourseDraft, publishCourse, uploadVideo } from '../api/content'
import { courseVideoStats } from '../lib/mapContent'
import { planLessonBatch } from '../lib/videoBatch'

const route = useRoute()
const courseId = ref(String(route.query.courseId || ''))
const course = ref<Record<string, any> | null>(null)
const fromPublished = ref(false)
const message = ref('')
const busy = ref(false)
const progress = ref('')
const publishConfirm = ref(false)
const stats = ref({ total: 0, done: 0 })
const confirmKey = ref('') // no-alert 两步删除确认（换皮改直接 splice·误删即丢）

const pct = computed(() => (stats.value.total ? Math.round((stats.value.done / stats.value.total) * 100) : 0))

function twoStep(key: string, run: () => void) {
  if (confirmKey.value !== key) {
    confirmKey.value = key
    return
  }
  confirmKey.value = ''
  run()
}
// ↑↓ 重排（换皮丢·章/课时/段顺序＝内容语义·嵌套 ↑↓ 比拖拽稳）
function move<T>(arr: T[], i: number, dir: number) {
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  const t = arr[i]
  arr[i] = arr[j]
  arr[j] = t
}
function delChapter(ci: number) {
  twoStep('ch:' + ci, () => course.value!.chapters.splice(ci, 1))
}
function delLesson(ch: Record<string, any>, ci: number, li: number) {
  twoStep('l:' + ci + ':' + li, () => ch.lessons.splice(li, 1))
}
function delSegment(l: Record<string, any>, ci: number, li: number, si: number) {
  twoStep('s:' + ci + ':' + li + ':' + si, () => {
    l.segments.splice(si, 1)
    refreshStats()
  })
}
// 发布前护栏（换皮退成可静默发布残课）：空结构硬拦、缺视频软提醒
const publishIssues = computed(() => {
  const c = course.value
  if (!c) return [] as string[]
  const chs = (c.chapters || []) as Record<string, any>[]
  const issues: string[] = []
  if (!chs.length || !chs.some((ch) => (ch.lessons || []).length)) issues.push('课程还没有章节/课时')
  let missing = 0
  for (const ch of chs) for (const l of ch.lessons || []) for (const s of l.segments || []) if (!s.videoFileId) missing++
  if (missing) issues.push(`还有 ${missing} 段没传视频`)
  return issues
})

async function load() {
  if (!courseId.value.trim()) return
  message.value = '加载中…'
  const r = await getCourseDraft(courseId.value.trim())
  if (!r.ok) {
    message.value = '加载失败：' + String(r.error || '')
    return
  }
  loaded = false // 载入期不触发自动保存
  fromPublished.value = r.fromPublished === true
  course.value = (r.course as Record<string, any>) || { id: courseId.value.trim(), title: '', sort: 0, chapters: [] }
  refreshStats()
  message.value = ''
  saveState.value = ''
  void nextTick(() => (loaded = true)) // 载入后的用户编辑才自动保存
}

function refreshStats() {
  stats.value = courseVideoStats(course.value)
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

// 防抖自动保存（换皮退成手动按钮·编视频编排忘点即丢）：900ms + 离页补存·load 期不触发
const saveState = ref<'' | 'saving' | 'saved' | 'error'>('')
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
function autosave() {
  if (!course.value) return
  saveState.value = 'saving'
  fromPublished.value = false
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const r = await saveCourseDraft(course.value!)
    saveState.value = r.ok ? 'saved' : 'error'
  }, 900)
}
watch(course, () => { if (loaded && course.value) autosave() }, { deep: true })
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  if (saveState.value === 'saving' && course.value) void saveCourseDraft(course.value)
})

function addChapter() {
  course.value?.chapters.push({ id: '', title: '', lessons: [] })
}
function addLesson(ch: Record<string, any>) {
  ch.lessons.push({ id: '', name: '', dur: '', segments: [] })
}
function addSegment(l: Record<string, any>) {
  l.segments.push({ id: '', name: '', dur: '', videoFileId: '' })
}

async function pickVideo(sg: Record<string, any>, ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || !course.value) return
  progress.value = '上传中 0%'
  if (!sg.dur) sg.dur = await readDuration(file) // 时长自动读取（未填才读·不覆盖手填）
  const r = await uploadVideo(String(course.value.id), String(sg.name || 'seg'), file, (p) => (progress.value = `上传中 ${Math.round(p * 100)}%`))
  progress.value = ''
  if (r.ok) {
    sg.videoFileId = r.fileId || ''
    refreshStats()
    message.value = ''
  } else message.value = '视频上传失败：' + String(r.error || '')
}

// 课时级批量传视频（换皮丢·多选按文件名 numeric 顺序灌入/自动新建段·串行 fail-soft·课时级进度）
async function batchUpload(l: Record<string, any>, ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length || !course.value) return
  const plan = planLessonBatch(files, (l.segments as any[]).length)
  for (const item of plan) {
    if (item.isNew) l.segments.push({ id: '', name: item.segName, dur: '', videoFileId: '' })
    const sg = l.segments[item.segIndex]
    if (!sg.name) sg.name = item.segName
    if (!sg.dur) sg.dur = await readDuration(item.file) // 时长自动读取（未填才读）
    const r = await uploadVideo(String(course.value.id), sg.name || 'seg', item.file, (p) => (progress.value = `课时批量传 ${item.segIndex + 1}/${plan.length} · ${Math.round(p * 100)}%`))
    if (r.ok) sg.videoFileId = r.fileId || ''
    else message.value = '有视频上传失败：' + String(r.error || '') // fail-soft·一段失败不拖累其余
  }
  progress.value = ''
  refreshStats()
  input.value = ''
}

async function save() {
  if (!course.value || busy.value) return
  busy.value = true
  const r = await saveCourseDraft(course.value)
  busy.value = false
  message.value = r.ok ? '草稿已保存（学员不可见·发布后生效）' : '保存失败：' + String(r.error || '')
  fromPublished.value = false
}

async function publish() {
  if (!course.value || busy.value) return
  // 空结构硬拦截（发布无意义）
  if (publishIssues.value.some((i) => i.includes('章节'))) {
    message.value = '课程还没有章节/课时，先加内容再发布'
    return
  }
  if (!publishConfirm.value) {
    publishConfirm.value = true // 两步确认：发布即对老学员生效 + 孤儿视频 GC（缺视频软提醒见 banner）
    return
  }
  publishConfirm.value = false
  busy.value = true
  const r = await publishCourse(String(course.value.id))
  busy.value = false
  message.value = r.ok ? '已发布，学员立即看到新版' : '发布失败：' + String(r.error || '')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>课程编排</h1>
        <p class="sub">一门课 = 章 → 课时 → 段；每段挂一条视频。保存＝存草稿（学员不可见），发布＝老学员立即看到新版。</p>
      </div>
    </header>

    <div class="toolbar">
      <input v-model="courseId" placeholder="course-xxx（商品页「编辑课程」会带入）" class="cid" @keyup.enter="load" />
      <button class="act ghost" @click="load"><RotateCcw :size="14" :stroke-width="1.8" /><span>载入</span></button>
    </div>
    <p v-if="message" class="status">{{ message }}</p>
    <p v-if="progress" class="uploading">{{ progress }}</p>

    <template v-if="course">
      <div class="course-head">
        <input v-model="course.title" maxlength="60" placeholder="课程标题" class="title-in" />
        <div class="head-right">
          <div class="vstat">
            <span class="vstat-num">视频 {{ stats.done }}/{{ stats.total }}</span>
            <div class="vbar"><div class="vbar-fill" :style="{ width: pct + '%' }" /></div>
          </div>
          <span v-if="saveState" class="autosave" :class="saveState">{{ saveState === 'saving' ? '自动保存中…' : saveState === 'saved' ? '已自动存草稿' : '自动保存失败·点保存重试' }}</span>
          <button class="act ghost" :disabled="busy" @click="save">保存草稿</button>
          <button class="act primary" :disabled="busy" @click="publish">
            {{ publishConfirm ? '确认发布？老学员立即生效' : '发布上线' }}
          </button>
        </div>
      </div>
      <p v-if="fromPublished" class="from-pub">当前显示已发布版（尚无草稿·保存即建草稿）</p>
      <p v-if="publishConfirm && publishIssues.length" class="pub-warn">发布提醒：{{ publishIssues.join('；') }}——确认无碍请再点一次「确认发布」</p>

      <div v-for="(ch, ci) in course.chapters" :key="ci" class="chapter">
        <div class="ch-head">
          <span class="ch-badge">第 {{ ci + 1 }} 章</span>
          <input v-model="ch.title" placeholder="章标题" maxlength="60" class="ch-title" />
          <button class="icon-btn" title="上移" :disabled="ci === 0" @click="move(course.chapters, ci, -1)">↑</button>
          <button class="icon-btn" title="下移" :disabled="ci === course.chapters.length - 1" @click="move(course.chapters, ci, 1)">↓</button>
          <button class="icon-btn" :class="{ warn: confirmKey === 'ch:' + ci }" :title="confirmKey === 'ch:' + ci ? '再点确认删章' : '删章'" @click="delChapter(ci)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>

        <div v-for="(l, li) in ch.lessons" :key="li" class="lesson">
          <div class="l-head">
            <input v-model="l.name" placeholder="课时名" maxlength="60" class="l-name" />
            <input v-model="l.dur" placeholder="时长" class="dur" maxlength="10" />
            <button class="icon-btn" title="上移" :disabled="li === 0" @click="move(ch.lessons, li, -1)">↑</button>
            <button class="icon-btn" title="下移" :disabled="li === ch.lessons.length - 1" @click="move(ch.lessons, li, 1)">↓</button>
            <button class="icon-btn" :class="{ warn: confirmKey === 'l:' + ci + ':' + li }" :title="confirmKey === 'l:' + ci + ':' + li ? '再点确认删课时' : '删课时'" @click="delLesson(ch, ci, li)"><Trash2 :size="14" :stroke-width="1.8" /></button>
          </div>
          <div v-for="(sg, si) in l.segments" :key="si" class="seg">
            <input v-model="sg.name" placeholder="段名" maxlength="60" class="seg-name" />
            <input v-model="sg.dur" placeholder="时长" class="dur" maxlength="10" />
            <label class="upload" :class="{ done: sg.videoFileId }">
              <component :is="sg.videoFileId ? Check : Upload" :size="13" :stroke-width="2" />
              <span>{{ sg.videoFileId ? '已传 · 替换' : '选视频' }}</span>
              <input type="file" accept="video/mp4,video/quicktime" hidden @change="(e) => pickVideo(sg, e)" />
            </label>
            <button class="icon-btn" title="上移" :disabled="si === 0" @click="move(l.segments, si, -1)">↑</button>
            <button class="icon-btn" title="下移" :disabled="si === l.segments.length - 1" @click="move(l.segments, si, 1)">↓</button>
            <button class="icon-btn" :class="{ warn: confirmKey === 's:' + ci + ':' + li + ':' + si }" title="删段" @click="delSegment(l, ci, li, si)"><Trash2 :size="14" :stroke-width="1.8" /></button>
          </div>
          <div class="seg-adds">
            <button class="add-btn" @click="addSegment(l)"><Plus :size="13" :stroke-width="2" /><span>加段</span></button>
            <label class="add-btn batch-up" title="多选视频·按文件名顺序自动灌入/新建小段"><Upload :size="13" :stroke-width="2" /><span>批量传视频</span><input type="file" accept="video/mp4,video/quicktime" multiple hidden @change="(e) => batchUpload(l, e)" /></label>
          </div>
        </div>
        <button class="add-btn" @click="addLesson(ch)"><Plus :size="13" :stroke-width="2" /><span>加课时</span></button>
      </div>

      <button class="add-chapter" @click="addChapter"><Plus :size="15" :stroke-width="2" /><span>加章</span></button>
    </template>
    <p v-else-if="!message" class="status-soft">输入课程编号（course-xxx）载入其章节结构</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
}
.page-head {
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
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.cid {
  width: 320px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  font-size: 13px;
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.uploading {
  font-size: 12.5px;
  color: var(--ld-brand-active);
  font-weight: 600;
}
.course-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  margin-bottom: 8px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.title-in {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ld-ink);
}
.head-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.vstat {
  min-width: 120px;
}
.vstat-num {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.vbar {
  margin-top: 5px;
  height: 6px;
  background: var(--ld-bg-faint);
  border-radius: 999px;
  overflow: hidden;
}
.vbar-fill {
  height: 100%;
  background: var(--ld-brand);
  border-radius: 999px;
}
.from-pub {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--ld-amber);
}
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
.chapter {
  padding: 14px 16px;
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.ch-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.ch-badge {
  flex: none;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 11.5px;
  font-weight: 600;
}
.ch-title {
  flex: 1;
  min-width: 0;
  padding: 7px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
}
.lesson {
  margin: 10px 0 10px 20px;
  padding: 12px 14px;
  background: var(--ld-bg-lilac);
  border-radius: 12px;
}
.l-head {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.l-name {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  background: var(--ld-bg);
}
.dur {
  width: 84px;
  flex: none;
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  background: var(--ld-bg);
}
.seg {
  display: grid;
  grid-template-columns: 1fr 84px auto auto auto auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.icon-btn.warn {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
.pub-warn {
  margin: 0 0 12px;
  padding: 9px 13px;
  border-radius: 9px;
  font-size: 12px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
}
.seg-name {
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  background: var(--ld-bg);
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
.seg-adds {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.batch-up {
  border-style: solid;
  background: var(--ld-bg-lilac);
}
.add-chapter {
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
.act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.act.primary {
  background: var(--ld-purple-ink);
  color: #fff;
}
.act.ghost {
  background: var(--ld-bg);
  color: var(--ld-content-2);
  border: 1px solid var(--ld-line);
}
.act:disabled {
  opacity: 0.5;
}
</style>
