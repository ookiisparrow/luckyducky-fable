<script setup>
/**
 * 第 4 步 · 教学视频（三层编排：章节 → 课时 → 小段；规格 §二/§七，设计稿 S2）。
 * - 结构与小程序 courses 同形；草稿存云端 coursesDraft，「发布更新」覆盖 courses（学员才可见）。
 * - 名称即输即存（方便命名）；三层各自可拖拽排序；小段三态视频位（未传/上传中/已传）。
 * - 视频 ≤10MB：主路径直传云存储（秒级），凭证不可用自动回落分片通道。
 */
import { ref, computed } from 'vue'
import { useProductsStore } from '@/store/products.js'
import { useAutosave } from '@/composables/useAutosave.js'
import { cloudMode, getCourseDraft, saveCourseDraft, publishCourse, uploadVideo } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'
import { planLessonBatch } from '@/utils/videoBatch.js'

const props = defineProps({ product: { type: Object, required: true } })
const store = useProductsStore()

const course = ref(null)
const loading = ref(true)
const loadErr = ref('')
const publishing = ref(false)
const publishedAt = ref(0)
const uploads = ref({}) // segId -> 0~1 进度
const lessonBusy = ref({}) // lessonId -> { done, total } 课时级批量上传进度

const rid = () => Math.random().toString(36).slice(2, 8)

// ---------- 载入 / 自动保存 ----------

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  try {
    let courseId = props.product.courseId
    if (!courseId) {
      courseId = 'course-' + props.product.id
      await store.update(props.product.id, { courseId })
    }
    const c = await getCourseDraft(courseId)
    course.value = c || {
      id: courseId,
      title: props.product.name ? props.product.name + ' · 配套教程' : '新课程',
      sort: 100,
      chapters: [],
    }
  } catch (e) {
    loadErr.value = '课程草稿加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

const stats = computed(() => {
  let total = 0
  let done = 0
  for (const ch of course.value?.chapters || [])
    for (const l of ch.lessons || [])
      for (const sg of l.segments || []) {
        total++
        if (sg.videoFileId) done++
      }
  return { total, done }
})

// 防抖自动保存（含离开页面 flush）：草稿存 coursesDraft，存完同步商品的视频进度统计
const { saveState } = useAutosave(course, (snap) => saveCourseDraft(snap), {
  delay: 800,
  ready: () => !loading.value,
  afterSave: () => store.update(props.product.id, { videoStats: { ...stats.value } }),
})

// ---------- 结构编辑 ----------

function addChapter() {
  course.value.chapters.push({ id: 'c' + rid(), title: `第 ${course.value.chapters.length + 1} 章`, lessons: [] })
}
function addLesson(ch) {
  ch.lessons.push({ id: 'l' + rid(), name: '新课时', dur: '', segments: [] })
}
function addSegment(l) {
  l.segments.push({ id: 's' + rid(), name: `第 ${l.segments.length + 1} 段`, dur: '', videoFileId: '', free: false })
}
async function removeAt(arr, i, label) {
  if (await confirmDialog({ title: '删除', message: `删除${label}？该层级下的内容会一并移除。`, confirmText: '删除', danger: true }))
    arr.splice(i, 1)
}

// 拖拽排序（三层通用：同一列表内移动；目标位置显示紫色落点线）
const drag = ref(null) // { list, index }
const over = ref(null) // { list, index } 当前悬停落点
function dragStart(list, index, e) {
  drag.value = { list, index }
  e.stopPropagation()
}
function dragOver(list, index, e) {
  e.preventDefault()
  e.stopPropagation()
  if (drag.value && drag.value.list === list) over.value = { list, index }
}
function dragEnd() {
  drag.value = null
  over.value = null
}
function isOver(list, index) {
  return !!(
    over.value &&
    over.value.list === list &&
    over.value.index === index &&
    drag.value &&
    drag.value.index !== index
  )
}
function isDragging(list, index) {
  return !!(drag.value && drag.value.list === list && drag.value.index === index)
}
function drop(list, index, e) {
  e.stopPropagation()
  const d = drag.value
  dragEnd()
  if (!d || d.list !== list || d.index === index) return
  const [moved] = list.splice(d.index, 1)
  list.splice(index, 0, moved)
}

// ---------- 视频上传 ----------

// 单段上传核心（单传 + 批量共用）：置进度 → 读时长 → 上传 → 写 videoFileId → 清进度。
// 失败向上抛，由调用方决定提示/是否继续（批量里 fail-soft·不中断整批）。
async function uploadOne(sg, file) {
  try {
    uploads.value = { ...uploads.value, [sg.id]: 0 }
    // 读时长自动填 dur（mm:ss）
    readDuration(file).then((d) => {
      if (d) sg.dur = d
    })
    const { ref: fileId } = await uploadVideo(file, course.value.id, sg.id, (p) => {
      uploads.value = { ...uploads.value, [sg.id]: p }
    })
    sg.videoFileId = fileId
  } finally {
    const u = { ...uploads.value }
    delete u[sg.id]
    uploads.value = u
  }
}

async function pickVideo(e, l, sg) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    await uploadOne(sg, file)
  } catch (err) {
    toast('视频上传失败：' + err.message, 'err')
  }
}

// 课时级批量上传：一次选多个文件，按文件名顺序依次灌进小段（不够自动新建），串行逐个传。
// fail-soft：单个失败提示并继续其余（含 >15MB 被 uploadVideo 拒）；课时级忙碌锁防重入。
async function pickVideosBatch(e, l) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  if (!files.length || lessonBusy.value[l.id]) return
  const plan = planLessonBatch(files, l.segments.length)
  lessonBusy.value = { ...lessonBusy.value, [l.id]: { done: 0, total: plan.length } }
  try {
    for (const item of plan) {
      let sg = l.segments[item.segIndex]
      if (!sg) {
        sg = { id: 's' + rid(), name: item.segName, dur: '', videoFileId: '', free: false }
        l.segments.push(sg)
      }
      try {
        await uploadOne(sg, item.file)
      } catch (err) {
        toast(`${item.file.name} 上传失败：${err.message}`, 'err')
      }
      const b = lessonBusy.value[l.id]
      if (b) lessonBusy.value = { ...lessonBusy.value, [l.id]: { done: b.done + 1, total: b.total } }
    }
  } finally {
    const b = { ...lessonBusy.value }
    delete b[l.id]
    lessonBusy.value = b
  }
}
function readDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src)
      const s = Math.round(v.duration)
      resolve(s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')
    }
    v.onerror = () => resolve('')
    v.src = URL.createObjectURL(file)
  })
}

// ---------- 发布 ----------

async function doPublish() {
  if (publishing.value) return
  if (stats.value.total === 0) return toast('还没有任何小段，先搭好结构再发布', 'err')
  const miss = stats.value.total - stats.value.done
  const tip =
    (miss > 0 ? `还有 ${miss} 段没传视频（学员会看到无视频的段）。\n` : '') +
    '发布后小程序端立即可见（已激活学员自动看到新内容）。确认发布？'
  if (!(await confirmDialog({ title: '发布课程', message: tip, confirmText: '发布' }))) return
  publishing.value = true
  try {
    await saveCourseDraft(JSON.parse(JSON.stringify(course.value)))
    await publishCourse(course.value.id)
    publishedAt.value = Date.now()
  } catch (e) {
    toast('发布失败：' + e.message, 'err')
  } finally {
    publishing.value = false
  }
}
</script>

<template>
  <div>
    <div class="headrow">
      <div>
        <h2>第 4 步 · 教学视频</h2>
        <p class="desc">三层结构与小程序目录同构：章节 → 课时 → 小段；每个小段一条视频（≤10MB）</p>
      </div>
      <span class="save" :class="saveState">
        {{ { saving: '保存中…', saved: '草稿已保存 ✓', error: '保存失败，检查网络' }[saveState] || '' }}
      </span>
      <button class="btn primary" :disabled="publishing" @click="doPublish">
        {{ publishing ? '发布中…' : '🚀 发布更新' }}
      </button>
    </div>

    <p v-if="!cloudMode" class="hint warn">视频编排需云端模式（配置 admin/.env.local 的 VITE_ADMIN_API）。</p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">课程草稿加载中…</p>

    <template v-else-if="course">
      <div class="statbar">
        <span class="statlabel">视频素材</span>
        <span class="bar"><span class="fill" :style="{ width: stats.total ? (stats.done / stats.total) * 100 + '%' : '0%' }"></span></span>
        <b>{{ stats.done }} / {{ stats.total }} 段</b>
        <span v-if="publishedAt" class="pubok">已发布 ✓</span>
      </div>

      <div
        v-for="(ch, ci) in course.chapters"
        :key="ch.id"
        class="chapter"
        :class="{ 'drop-before': isOver(course.chapters, ci), dragging: isDragging(course.chapters, ci) }"
        draggable="true"
        @dragstart="dragStart(course.chapters, ci, $event)"
        @dragover="dragOver(course.chapters, ci, $event)"
        @dragend="dragEnd"
        @drop="drop(course.chapters, ci, $event)"
      >
        <div class="ch-head">
          <span class="grip" title="拖动排序">⠿</span>
          <span class="ch-badge">第 {{ ci + 1 }} 章</span>
          <input v-model="ch.title" class="name ch-name" placeholder="章节名称" />
          <button class="mini del" @click="removeAt(course.chapters, ci, '本章')">删除</button>
        </div>

        <div
          v-for="(l, li) in ch.lessons"
          :key="l.id"
          class="lesson"
          :class="{ 'drop-before': isOver(ch.lessons, li), dragging: isDragging(ch.lessons, li) }"
          draggable="true"
          @dragstart="dragStart(ch.lessons, li, $event)"
          @dragover="dragOver(ch.lessons, li, $event)"
          @dragend="dragEnd"
          @drop="drop(ch.lessons, li, $event)"
        >
          <div class="ls-head">
            <span class="grip" title="拖动排序">⠿</span>
            <span class="ls-num">{{ ci + 1 }}-{{ li + 1 }}</span>
            <input v-model="l.name" class="name" placeholder="课时名称" />
            <span class="meta">{{ l.segments.length }} 段</span>
            <span v-if="lessonBusy[l.id]" class="upstate">上传中 {{ lessonBusy[l.id].done }}/{{ lessonBusy[l.id].total }}…</span>
            <label v-else class="upbtn" title="一次选多个视频，按文件名顺序填进本课时的小段（不够自动新建）">
              <input type="file" accept="video/mp4,video/quicktime" multiple hidden @change="pickVideosBatch($event, l)" />
              ⬆ 批量传
            </label>
            <button class="mini del" @click="removeAt(ch.lessons, li, '本课时')">删除</button>
          </div>

          <div
            v-for="(sg, si) in l.segments"
            :key="sg.id"
            class="seg"
            :class="{ 'drop-before': isOver(l.segments, si), dragging: isDragging(l.segments, si) }"
            draggable="true"
            @dragstart="dragStart(l.segments, si, $event)"
            @dragover="dragOver(l.segments, si, $event)"
            @dragend="dragEnd"
            @drop="drop(l.segments, si, $event)"
          >
            <span class="grip" title="拖动排序">⠿</span>
            <span class="seg-num">{{ si + 1 }}</span>
            <input v-model="sg.name" class="name seg-name" placeholder="小段名称（方便学员看懂这段讲什么）" />
            <span class="meta">{{ sg.dur || '--:--' }}</span>

            <span v-if="uploads[sg.id] !== undefined" class="upstate">
              <span class="bar small"><span class="fill" :style="{ width: Math.round(uploads[sg.id] * 100) + '%' }"></span></span>
              {{ Math.round(uploads[sg.id] * 100) }}%
            </span>
            <label v-else-if="!sg.videoFileId" class="upbtn">
              <input type="file" accept="video/mp4,video/quicktime" hidden @change="pickVideo($event, l, sg)" />
              ⬆ 传视频
            </label>
            <span v-else class="done">
              ✓ 已传
              <label class="relink">
                <input type="file" accept="video/mp4,video/quicktime" hidden @change="pickVideo($event, l, sg)" />替换
              </label>
            </span>

            <label class="free" title="未激活学员可试看本段">
              <input v-model="sg.free" type="checkbox" /> 试看
            </label>
            <button class="mini del" @click="removeAt(l.segments, si, '本段')">×</button>
          </div>

          <button class="addline" @click="addSegment(l)">＋ 添加小段</button>
        </div>

        <button class="addline ls" @click="addLesson(ch)">＋ 添加课时</button>
      </div>

      <button class="addchapter" @click="addChapter">＋ 添加章节</button>

      <p class="hint">
        💡 改名直接在输入框里改；拖住 ⠿ 在同层内调顺序；视频文件名随意，传到哪段就挂哪段。
        课时右侧「⬆ 批量传」可一次选多个视频，按文件名顺序依次灌进小段（段不够自动新建·每个 ≤10MB）。
        草稿随改随存，点「发布更新」学员才能看到。
      </p>
    </template>
  </div>
</template>

<style scoped>
.headrow {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.headrow > div {
  flex: 1;
}
h2 {
  font-size: 16.5px;
  color: var(--ink);
  margin: 0 0 4px;
}
.desc {
  font-size: 12px;
  color: var(--content-2);
  margin: 0 0 16px;
}
.save {
  font-size: 12px;
  color: var(--content-2);
  align-self: center;
}
.save.error {
  color: var(--red);
}
.statbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border: 1px solid var(--line);
  border-radius: 11px;
  margin-bottom: 14px;
  font-size: 12.5px;
}
.statlabel {
  font-weight: 700;
}
.bar {
  flex: 1;
  height: 7px;
  background: var(--bg-grey);
  border-radius: 99px;
  overflow: hidden;
}
.bar.small {
  width: 90px;
  flex: 0 0 auto;
  height: 5px;
  display: inline-block;
}
.fill {
  display: block;
  height: 100%;
  background: var(--brand);
  border-radius: 99px;
  transition: width 0.2s;
}
.pubok {
  color: var(--green);
  font-weight: 700;
}
.chapter,
.lesson,
.seg {
  position: relative;
}
.drop-before::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: -5px;
  height: 3px;
  border-radius: 99px;
  background: var(--brand);
  box-shadow: 0 0 0 1px var(--white);
}
.dragging {
  opacity: 0.45;
  border-color: var(--brand) !important;
}
.chapter {
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--white);
}
.ch-head,
.ls-head,
.seg {
  display: flex;
  align-items: center;
  gap: 9px;
}
.grip {
  color: var(--line-strong);
  cursor: grab;
  font-size: 13px;
  user-select: none;
}
.ch-badge {
  flex: 0 0 auto;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-active);
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: 99px;
  padding: 3px 9px;
}
.name {
  flex: 1;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 13px;
  background: transparent;
  outline: none;
}
.name:hover {
  border-color: var(--line-strong);
}
.name:focus {
  border-color: var(--brand);
  background: var(--white);
}
.ch-name {
  font-weight: 700;
  font-size: 14px;
}
.lesson {
  background: var(--bg-lilac);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  margin: 8px 0 8px 26px;
}
.ls-num {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--purple-meta);
}
.seg {
  background: var(--white);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 6px 10px;
  margin: 6px 0 6px 24px;
}
.seg-num {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 6px;
  background: var(--bg-grey);
  color: var(--content-2);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.seg-name {
  font-size: 12.5px;
}
.meta {
  font-size: 11.5px;
  color: var(--content-2);
  flex: 0 0 auto;
}
.upbtn {
  flex: 0 0 auto;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-active);
  background: var(--bg-lilac);
  border: 1px dashed var(--purple-line);
  border-radius: 99px;
  padding: 5px 12px;
  cursor: pointer;
}
.upstate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--brand-active);
  font-weight: 600;
}
.done {
  font-size: 11.5px;
  color: var(--green);
  font-weight: 600;
}
.relink {
  color: var(--content-2);
  font-weight: 400;
  cursor: pointer;
  margin-left: 4px;
  text-decoration: underline;
}
.free {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: var(--content-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mini {
  border: none;
  background: none;
  font-size: 11.5px;
  color: var(--content-2);
  cursor: pointer;
  flex: 0 0 auto;
}
.mini.del:hover {
  color: var(--red);
}
.addline {
  display: block;
  border: none;
  background: none;
  color: var(--purple-meta);
  font-size: 12px;
  cursor: pointer;
  padding: 6px 10px;
  margin-left: 24px;
}
.addline.ls {
  margin-left: 26px;
}
.addline:hover {
  color: var(--brand-active);
}
.addchapter {
  width: 100%;
  border: 1px solid var(--purple-line);
  background: var(--bg-lilac);
  color: var(--brand-active);
  font-size: 13px;
  font-weight: 600;
  border-radius: 13px;
  padding: 12px;
  cursor: pointer;
  margin-bottom: 14px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 6px 0 14px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
