<script setup lang="ts">
// 课程管理（M3 批4）：章节→课时→段 树编辑 + 每段视频直传 + 发布（引用模型·老学员自动生效；
// 发布时孤儿视频 GC 在云端——旧发布不再引用的文件才删）。?courseId= 从商品页带入或手输。
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getCourseDraft, saveCourseDraft, publishCourse, uploadVideo } from '../api/content'
import { courseVideoStats } from '../lib/mapContent'

const route = useRoute()
const courseId = ref(String(route.query.courseId || ''))
const course = ref<Record<string, any> | null>(null)
const fromPublished = ref(false)
const message = ref('')
const busy = ref(false)
const progress = ref('')
const publishConfirm = ref(false)
const stats = ref({ total: 0, done: 0 })

async function load() {
  if (!courseId.value.trim()) return
  message.value = '加载中…'
  const r = await getCourseDraft(courseId.value.trim())
  if (!r.ok) {
    message.value = '加载失败：' + String(r.error || '')
    return
  }
  fromPublished.value = r.fromPublished === true
  course.value = (r.course as Record<string, any>) || { id: courseId.value.trim(), title: '', sort: 0, chapters: [] }
  refreshStats()
  message.value = ''
}

function refreshStats() {
  stats.value = courseVideoStats(course.value)
}

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
  const r = await uploadVideo(String(course.value.id), String(sg.name || 'seg'), file, (p) => (progress.value = `上传中 ${Math.round(p * 100)}%`))
  progress.value = ''
  if (r.ok) {
    sg.videoFileId = r.fileId || ''
    refreshStats()
    message.value = ''
  } else message.value = '视频上传失败：' + String(r.error || '')
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
  if (!publishConfirm.value) {
    publishConfirm.value = true // 两步确认：发布即对老学员生效 + 孤儿视频 GC
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
  <div>
    <h2>课程管理</h2>
    <div class="topbar">
      <input v-model="courseId" placeholder="course-xxx（商品页「编辑课程」会带入）" class="cid" @keyup.enter="load" />
      <button class="act" @click="load">载入</button>
      <span v-if="course" class="stat">视频 已传 {{ stats.done }}/{{ stats.total }}</span>
      <span v-if="fromPublished" class="stat warn-text">当前显示已发布版（尚无草稿·保存即建草稿）</span>
    </div>
    <p v-if="message" class="status">{{ message }}</p>
    <p v-if="progress" class="hint">{{ progress }}</p>

    <div v-if="course" class="editor">
      <label>课程标题 <input v-model="course.title" maxlength="60" /></label>
      <div v-for="(ch, ci) in course.chapters" :key="ci" class="chapter">
        <div class="chhead">
          <input v-model="ch.title" placeholder="章标题" maxlength="60" />
          <button class="act ghost" @click="course.chapters.splice(ci, 1)">删章</button>
        </div>
        <div v-for="(l, li) in ch.lessons" :key="li" class="lesson">
          <div class="lhead">
            <input v-model="l.name" placeholder="课时名" maxlength="60" />
            <input v-model="l.dur" placeholder="时长" class="dur" maxlength="10" />
            <button class="act ghost" @click="ch.lessons.splice(li, 1)">删课时</button>
          </div>
          <div v-for="(sg, si) in l.segments" :key="si" class="segrow">
            <input v-model="sg.name" placeholder="段名" maxlength="60" />
            <input v-model="sg.dur" placeholder="时长" class="dur" maxlength="10" />
            <label class="file">{{ sg.videoFileId ? '已传 ✓ 替换' : '选视频' }}<input type="file" accept="video/mp4,video/quicktime" hidden @change="(e) => pickVideo(sg, e)" /></label>
            <button class="act ghost" @click="l.segments.splice(si, 1); refreshStats()">删段</button>
          </div>
          <button class="act ghost small" @click="addSegment(l)">+ 加段</button>
        </div>
        <button class="act ghost small" @click="addLesson(ch)">+ 加课时</button>
      </div>
      <button class="act ghost" @click="addChapter">+ 加章</button>
      <div class="ops">
        <button class="act" :disabled="busy" @click="save">保存草稿</button>
        <button class="act warn" :disabled="busy" @click="publish">
          {{ publishConfirm ? '确认发布？老学员立即看到新版' : '发布上线' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
.topbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.cid {
  width: 280px;
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.stat {
  font-size: 12px;
  color: var(--ld-purple-tab);
}
.warn-text {
  color: var(--ld-amber);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.hint {
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.editor {
  max-width: 800px;
}
.editor > label {
  display: block;
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin-bottom: 12px;
}
input {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
.editor > label input {
  width: 100%;
  margin-top: 4px;
  box-sizing: border-box;
}
.chapter {
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
.chhead,
.lhead {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.chhead input,
.lhead input:first-child {
  flex: 1;
}
.dur {
  width: 90px;
}
.lesson {
  margin: 8px 0 8px 16px;
  padding: 10px 12px;
  background: var(--ld-bg-lilac);
  border-radius: 10px;
}
.segrow {
  display: grid;
  grid-template-columns: 2fr 90px auto auto;
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
  text-align: center;
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
  background: var(--ld-red);
}
.act.small {
  font-size: 11px;
  padding: 4px 12px;
}
.act:disabled {
  opacity: 0.5;
}
.ops {
  margin-top: 14px;
  display: flex;
  gap: 8px;
}
</style>
