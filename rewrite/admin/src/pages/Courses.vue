<script setup lang="ts">
// 课程管理（design/console.pen S2 课程编排视觉·M3 UI 批10）：章→课时→段 树编辑 + 每段视频直传 + 发布
// （引用模型·老学员自动生效；孤儿视频云端 GC）。逻辑批10 未动，仅套设计语言（页头/视频进度条/章节卡/段上传 chip）。
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, onBeforeRouteLeave } from 'vue-router'
import { RotateCcw, Plus, Trash2, Upload, Check, BookOpen } from 'lucide-vue-next'
import { getCourseDraft, saveCourseDraft, publishCourse, uploadVideo, syncVodMedia } from '../api/content'
import { listDrafts } from '../api/products'
import { isVodFileId } from '@ldrw/shared'
import { courseVideoStats } from '../lib/mapContent'
import { planLessonBatch } from '../lib/videoBatch'
import { serialSave } from '../lib/serialSave'
import { useLatest } from '../lib/latest'
import { setUploadLock, clearUploadLock, isUploadLocked } from '../lib/uploadLock'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

// 嵌入模式（上新向导步 4 复用·向后兼容·独立 /courses?courseId 用法不传 props 行为不变）：
// embed=true 隐页头/手输课程号工具条·wizardCourseId 覆盖 route.query.courseId。
const props = defineProps<{ embed?: boolean; wizardCourseId?: string }>()
const route = useRoute()
const courseId = ref(props.wizardCourseId || String(route.query.courseId || ''))
const course = ref<Record<string, any> | null>(null)
const fromPublished = ref(false)
const message = ref('')
const busy = ref(false)
const progress = ref('')
const publishConfirm = ref(false)
// 视频进度＝computed 自动随课程树更新（迭代E 逮出：原 imperative ref 在 delChapter/delLesson/addSegment 后不刷新致漂移）
const stats = computed(() => courseVideoStats(course.value))
const confirmKey = ref('') // no-alert 两步删除确认（换皮改直接 splice·误删即丢）
// 死胡同改选择器（UX 体检批3）：课程无列表 API（listCourses 不存在·已核）——走「商品行 courseId」桥
// （商品档是课程唯一入口事实·商品页「编辑课程」按钮同源）；只列已关联课程的商品，未关联的从商品页补建。
// 拉不到列表就保持手输老路，不挡人
const courseOptions = ref<{ cid: string; label: string }[] | null>(null)
async function loadCourseOptions() {
  // 数据刷新必清危险武装态（守卫 rw-admin-armed-reset-on-load 规格·批3）——本函数只在无课号直入时跑，
  // 此时本就无可武装对象，复位是幂等的安全动作
  confirmKey.value = ''
  publishConfirm.value = false
  const dr = await listDrafts().catch(() => null)
  if (!(dr as any)?.ok) return
  const seen = new Map<string, string>()
  for (const p of (((dr as any).list as Record<string, any>[]) || [])) {
    const cid = String(p.courseId || '')
    if (cid && !seen.has(cid)) seen.set(cid, String(p.name || cid))
  }
  courseOptions.value = [...seen.entries()].map(([cid, label]) => ({ cid, label }))
}
function pickCourse(cid: string) {
  courseId.value = cid
  void load()
}
const batchUploading = ref(false) // 课时级批量传视频在途（P1·根因#8）：期间锁重排/删除交互入口，防结构错位与稳定标识失配（批3 规格）

const pct = computed(() => (stats.value.total ? Math.round((stats.value.done / stats.value.total) * 100) : 0))

// VOD 转码态（决策§31 批2）：段 videoFileId 为 VOD FileId（纯数字·判据单源 @ldrw/shared 与云端播放
// 分流同款）且 vodUrl 未回写 = 转码中——「传完 ≠ 可播」，发布被云端闸拦，先点「同步转码状态」。
const vodPending = (sg: Record<string, any>) => isVodFileId(String(sg.videoFileId || '')) && !sg.vodUrl
const vodPendingCount = computed(() => {
  let n = 0
  for (const ch of course.value?.chapters || []) for (const l of ch.lessons || []) for (const sg of l.segments || []) if (vodPending(sg)) n++
  return n
})
async function syncVod() {
  if (!course.value || busy.value || batchUploading.value) return
  busy.value = true
  const r = await syncVodMedia(String(course.value.id))
  busy.value = false
  if (r.ok) {
    message.value = `转码状态已同步：本次就绪 ${r.ready} 段、仍在转码 ${r.processing} 段` + (Number(r.processing) ? '——短视频通常几分钟内转完，稍后再点一次' : '，可以发布了')
    await load() // 服务端已回写 vodUrl 且 rev 递增——不重载，下次自动保存会撞 DRAFT_CONFLICT（诚实拒绝）
  } else message.value = '同步失败：' + String(r.error || '')
}

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
  if (batchUploading.value) return // 批量传视频在途锁重排（交互面·P1·同 delChapter/delLesson/delSegment）
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  const t = arr[i]
  arr[i] = arr[j]
  arr[j] = t
  confirmKey.value = '' // 重排后清「已武装删除」·防下标编码的 confirmKey 落到换位后的另一元素→删错（P2）
}
function delChapter(ci: number) {
  if (batchUploading.value) return // 批量传视频在途锁删除（交互面·P1·防结构变动使稳定引用失配）
  twoStep('ch:' + ci, () => course.value!.chapters.splice(ci, 1))
}
function delLesson(ch: Record<string, any>, ci: number, li: number) {
  if (batchUploading.value) return
  twoStep('l:' + ci + ':' + li, () => ch.lessons.splice(li, 1))
}
function delSegment(l: Record<string, any>, ci: number, li: number, si: number) {
  if (batchUploading.value) return
  twoStep('s:' + ci + ':' + li + ':' + si, () => {
    l.segments.splice(si, 1)
    refreshStats()
  })
}
// 发布前护栏（换皮退成可静默发布残课）：空结构硬拦、缺视频/空课时软提醒
const publishIssues = computed(() => {
  const c = course.value
  if (!c) return [] as string[]
  const chs = (c.chapters || []) as Record<string, any>[]
  const issues: string[] = []
  if (!chs.length || !chs.some((ch) => (ch.lessons || []).length)) issues.push('课程还没有章节/课时')
  let missing = 0
  let emptyLessons = 0 // 0 段课时（课程链路审计 2026-07-17）：内层循环不执行、missing 数不到——学员点进见空课时
  for (const ch of chs)
    for (const l of ch.lessons || []) {
      if (!(l.segments || []).length) emptyLessons++
      for (const s of l.segments || []) if (!s.videoFileId) missing++
    }
  if (emptyLessons) issues.push(`有 ${emptyLessons} 个课时还没加任何视频段`)
  if (missing) issues.push(`还有 ${missing} 段没传视频`)
  return issues
})

const loadGen = useLatest() // load() 乱序守卫（批A）：只让最后一次发起的 getCourseDraft 结果落地
async function load() {
  if (!courseId.value.trim()) return
  if (batchUploading.value) {
    // 批量传视频在途时拦截切课（P1 复审补漏·根因#8）：load() 会把 course.value 整体换成另一门课，
    // 而 batchUpload 循环持有的是旧课时对象的裸引用——一旦断链，仍在跑的上传会把 videoFileId 写回
    // 一棵不可达的树，永久丢失且无报错（云存储留孤儿文件）。交互面已锁重排/删除按钮，切课入口同锁。
    message.value = '有批量上传在进行中，请等其完成再切课'
    return
  }
  confirmKey.value = '' // 换课即复位危险态（P1·防旧武装的删章/删课时/删段残留、重进同一位一击直删·批3 规格）
  publishConfirm.value = false // 换课即复位危险态（P1·防旧武装的发布确认残留、重进一击直发·批3 规格）
  message.value = '加载中…'
  const my = loadGen.begin() // 乱序守卫（批A·同 Batches G1·根因#8）：连点载入/切课时旧回包别把 course.value 污染成错课
  const r = await getCourseDraft(courseId.value.trim())
  if (loadGen.isStale(my)) return // 已发起更新的 load()·整包丢弃（course/draftRev/message 全不写）
  if (!r.ok) {
    message.value = '加载失败：' + String(r.error || '')
    return
  }
  loaded = false // 载入期不触发自动保存
  fromPublished.value = r.fromPublished === true
  course.value = (r.course as Record<string, any>) || { id: courseId.value.trim(), title: '', sort: 0, chapters: [] }
  // 乐观并发基线（课程链路审计 2026-07-17）：记下拉草稿那一刻的版本号；重新载入即解除冲突态恢复自动保存
  draftRev.value = Number((r.course as Record<string, any>)?.rev) || 0
  conflicted.value = false
  refreshStats()
  message.value = ''
  saveState.value = ''
  void nextTick(() => (loaded = true)) // 载入后的用户编辑才自动保存
}

function refreshStats() {
  /* stats 已改 computed·自动随 course 更新；保留空函数免改各调用点（无副作用） */
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
const draftRev = ref(0) // 拉草稿那一刻的版本号（乐观并发基线·课程链路审计 2026-07-17）
const conflicted = ref(false) // 冲突态：别处已改过草稿——停自动保存防连环覆盖，「载入」解除
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
// 串行化实际保存（防慢网下两次自动保存乱序覆盖·P2·根因#8）：run 现读 course.value·补存即最新。
// key='courses:'+courseId（批D·P1，取组件构造那一刻的 courseId·同实例内后续 load() 换课不改 key——仍在
// 同一条队列里天然串行，只是槽位标签不再精确对应「当前」课程号，不影响写入正确性)：改走模块级共享槽位，
// 快速切走再切回本页重建组件实例时，新实例接管旧实例仍在途的补存链，防旧快照晚到覆盖新实例已存的编辑。
const flushSave = serialSave(async () => {
  if (!course.value || conflicted.value) return
  const r = await saveCourseDraft(course.value, draftRev.value)
  if (r.ok) {
    draftRev.value = Number(r.rev) || draftRev.value + 1
    saveState.value = 'saved'
  } else if (r.error === 'DRAFT_CONFLICT') {
    // 别处（另一页签/窗口/管理员）已保存过更新版本：本次拒写防互相覆盖，停自动保存等人工「载入」拿最新
    conflicted.value = true
    saveState.value = 'error'
    message.value = '草稿在别处被改过（另一个页签或窗口）——本次未保存以免互相覆盖；点「载入」取最新草稿后再编辑'
  } else saveState.value = 'error'
}, 'courses:' + courseId.value)
function autosave() {
  if (!course.value || conflicted.value) return
  saveState.value = 'saving'
  fromPublished.value = false
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null // 触发后清空·让 saveTimer 真实反映「有未落盘的待发编辑」
    void flushSave()
  }, 900)
}
watch(course, () => { if (loaded && course.value) autosave() }, { deep: true })
// 浏览器级离页拦截（课程链路审计 2026-07-17·根因#14）：F5 刷新/关标签页不走 Vue 生命周期与 vue-router
// 钩子，onBeforeUnmount 的补存也会随页面卸载被浏览器取消——有未落盘编辑（防抖待触发/保存在途）时弹
// 浏览器原生「离开页面？」确认，给一次挽回机会（补存本身在 unload 里保证不了送达，拦住人才是可靠的）。
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (saveTimer || saveState.value === 'saving') {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
// 离页补存判据用 pending saveTimer 而非 saveState==='saving'（先发保存完成会把 saveState 复位成 'saved'、
// 后一次编辑只在待触发 timer 里→按 saveState 判会漏补、离页丢课程编辑·P2·同 HelpVideos/Showcase·迭代I 批7 回归补 Courses）
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    if (course.value) void flushSave()
  }
})

// 新建节点当场铸 id（课程链路审计 2026-07-17·根因#1 稳定标识）：原来恒传空串、由云端 cleanCourse 每次
// 保存现生成随机 id 且从不回填——同一会话「发布→继续编辑→再保存→再发布」会让内容没变的节点 id 漂移，
// 学员进度/checkpoint 按 segmentId 关联的记录随之失联。前端铸一次（格式对齐 cleanCourse：前缀+6位36进制），
// cleanCourse 对非空 id 原样保留，id 自出生即稳定。
const mintId = (p: string) => p + Math.random().toString(36).slice(2, 8)
function addChapter() {
  course.value?.chapters.push({ id: mintId('c'), title: '', lessons: [] })
}
function addLesson(ch: Record<string, any>) {
  ch.lessons.push({ id: mintId('l'), name: '', dur: '', segments: [] })
}
function addSegment(l: Record<string, any>) {
  l.segments.push({ id: mintId('s'), name: '', dur: '', videoFileId: '' })
}

// 单段上传纳入批量传视频同一套防护（G2·P1）：换皮丢了这层——单段上传无锁，切课后仍在跑的上传把 videoFileId
// 写回一棵不可达的树，静默丢失（同 batchUpload 顶部注释的病根）。补：借用 batchUploading 共享标志（上传期间
// load() 已会拦截切课、重排/删除按钮已按此标志 disable），并在写回前按对象引用重定位——段已被删除/移出则如实
// 报告、不写回幽灵对象。
async function pickVideo(l: Record<string, any>, sg: Record<string, any>, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 重置 value：允许上传失败后重选同一文件重试（同 batchUpload/pickArt，否则浏览器不再触发 change）
  if (!file || !course.value || batchUploading.value) return
  batchUploading.value = true
  setUploadLock() // 同 batchUpload：拦截离页/切步致孤儿上传
  try {
    progress.value = '上传中 0%'
    if (!sg.dur) sg.dur = await readDuration(file) // 时长自动读取（未填才读·不覆盖手填）
    // allowVod（决策§31 批2 自纠·守卫 rw-admin-help-video-stays-cos）：课程视频线显式走 VOD——
    // 帮助视频线共用本函数但恒不传（其播放侧只认云存储 fileID）。
    const r = await uploadVideo(String(course.value.id), String(sg.name || 'seg'), file, (p) => (progress.value = `上传中 ${Math.round(p * 100)}%`), { allowVod: true })
    if (!l.segments.includes(sg)) {
      message.value = '这段已被移除，上传未关联' // 稳定引用重定位失败（段已被删）——如实跳过报告（同 batchUpload）
      return
    }
    if (r.ok) {
      sg.videoFileId = r.fileId || ''
      refreshStats()
      message.value = ''
    } else if (r.error === 'SESSION_LOST') message.value = '登录已过期，这段视频未上传成功，请重新登录后重试' // 同 batchUpload 措辞（批D·根因2）
    else message.value = '视频上传失败：' + String(r.error || '')
  } finally {
    progress.value = ''
    batchUploading.value = false
    clearUploadLock()
  }
}

// 课时级批量传视频（换皮丢·多选按文件名 numeric 顺序灌入/自动新建段·串行 fail-soft·课时级进度）：
// plan 时用当前 l.segments 下标算出的 segIndex 只是「计划那一刻」的位置——循环是逐段 await 的异步过程，
// 期间若发生重排/删段，下标会漂移到别的段（错配/越界，P1·根因#8）。修：plan 后立即深捕获目标段的
// 对象引用（existing 段直接引用当时的数组元素·JS 对象身份不随数组重排改变），每次上传前按引用重定位
// （`l.segments.includes(sg)`），引用已不在数组里（被删）即跳过并如实报告；同时上传期间锁重排/删除 UI
// （数据面按稳定引用兜底、交互面靠 batchUploading 锁入口，两层都做）。
async function batchUpload(l: Record<string, any>, ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length || !course.value || batchUploading.value) return
  const plan = planLessonBatch(files, (l.segments as any[]).length)
  // plan 时就地深捕获——existing 段捕获当时的对象引用；new 段等真正 push 那一刻才有引用可捕获（先占位 null）
  const targets: Array<Record<string, any> | null> = plan.map((item) => (item.isNew ? null : (l.segments[item.segIndex] as Record<string, any>) ?? null))
  batchUploading.value = true
  setUploadLock() // 批量上传在途锁（P1·bug sweep Round2 item12）：本组件 onBeforeRouteLeave + Wizard.go() 两处消费，拦截离页/切步致孤儿上传
  let uploaded = 0
  const fails: string[] = [] // 失败逐条累积（课程链路审计 2026-07-17）：原先互相覆盖 message，只剩最后一条——中间失败的段名/原因全丢
  try {
    for (let i = 0; i < plan.length; i++) {
      const item = plan[i]
      let sg = targets[i]
      if (item.isNew) {
        sg = { id: mintId('s'), name: item.segName, dur: '', videoFileId: '' }
        l.segments.push(sg)
      } else if (!sg || !(l.segments as any[]).includes(sg)) {
        fails.push(`「${item.segName}」对应的段已被删除/移出，已跳过`)
        continue // 稳定引用重定位失败（段已被删）——如实跳过报告（P1）
      }
      if (!sg.name) sg.name = item.segName
      if (!sg.dur) sg.dur = await readDuration(item.file) // 时长自动读取（未填才读）
      const r = await uploadVideo(String(course.value.id), sg.name || 'seg', item.file, (p) => (progress.value = `课时批量传 ${i + 1}/${plan.length} · ${Math.round(p * 100)}%`), { allowVod: true })
      if (r.ok) {
        sg.videoFileId = r.fileId || ''
        uploaded++
      } else if (r.error === 'SESSION_LOST') {
        // 会话失效清晰中止（批D·根因2）：不继续逐文件循环——令牌已被 client 清空，剩余每个文件必然同样
        // 401，逐个静默失败会把这份汇总原因冲没、用户只看到最后一条「上传失败：SESSION_LOST」摸不着头脑。
        // client.onSessionLost 已集中导登录（见 router.ts），这里只负责把「传到哪、剩多少」说清楚。
        fails.push(`登录已过期，已上传 ${uploaded}/${plan.length} 个，剩余 ${plan.length - uploaded} 个未上传，请重新登录后继续`)
        break
      } else fails.push(`「${sg.name || item.segName}」上传失败：${String(r.error || '')}`) // fail-soft·一段失败不拖累其余
    }
  } finally {
    batchUploading.value = false
    clearUploadLock()
  }
  message.value = fails.length ? `本次有 ${fails.length} 项没成功——${fails.join('；')}` : ''
  progress.value = ''
  refreshStats()
  input.value = ''
}

// 离页拦截（P1·bug sweep Round2 item12）：覆盖独立路由页离开 + 整个 Wizard 页离开（如中途点「回商品列表」）。
// Wizard 内部切步（query 变化）是路由 update 非 leave，此钩子不触发——那半由 Wizard.vue go() 前置拦截负责（c 点）。
onBeforeRouteLeave(() => {
  if (isUploadLocked()) {
    message.value = '批量上传进行中，请等其完成再离开（切走会丢失还没落库的视频关联）'
    return false
  }
})

async function save() {
  if (!course.value || busy.value) return
  busy.value = true
  // 手动保存前排空在途/待发自动保存·成为最后一次写（防旧快照 autosave POST 后落覆盖新草稿·同 publish/HomeContent·迭代I 批7 回归补 Courses.save）。
  // 单路径：只走 flushSave（serialSave 链·run 现读 course.value 即最新快照）——原先 flush 后又直发一次
  // saveCourseDraft 属双写冗余，且直发不带 baseRev 会绕过乐观并发检查（课程链路审计 2026-07-17）。
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await flushSave()
  busy.value = false
  if (saveState.value === 'saved') {
    message.value = '草稿已保存（学员不可见·发布后生效）'
    fromPublished.value = false
  } else if (!conflicted.value) message.value = '保存失败，请重试'
  // 冲突态：flushSave 已写明确提示，不覆盖
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
  // 发布前先排空在途/待发的草稿自动保存落库：publishCourse 只传 courseId、后端读 DB 草稿去发布——
  // 若最后一次编辑还在 900ms 防抖里没落库就发布，发的是改前旧内容却提示「已发布新版」（伪成功·病根#14）
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await flushSave()
  if (saveState.value === 'error') {
    busy.value = false
    message.value = '草稿未保存成功，请先重试保存再发布'
    return
  }
  const r = await publishCourse(String(course.value.id))
  busy.value = false
  message.value = r.ok
    ? '已发布，学员立即看到新版'
    : r.error === 'VOD_PROCESSING'
      ? `发布未执行：还有 ${r.pending} 段视频转码中——点「同步转码状态」，全部就绪后再发布`
      : '发布失败：' + String(r.error || '')
}

onMounted(() => {
  void load()
  // 直入无课号→加载课程选择桥（embed/带课号路径零变化）
  if (!props.embed && !courseId.value.trim()) void loadCourseOptions()
})
</script>

<template>
  <div class="ld-page courses" :class="{ embed }">
    <!-- 页头（embed 隐·向导已有步导航/面板头） -->
    <PageHeader
      v-if="!embed"
      title="课程编排"
      sub="一门课 = 章 → 课时 → 段；每段挂一条视频。保存＝存草稿（学员不可见），发布＝老学员立即看到新版。"
    />

    <!-- courseId 载入条（embed 隐·向导用 wizardCourseId 直接带入） -->
    <div v-if="!embed" class="ld-toolbar">
      <div class="ld-search cid-box">
        <input v-model="courseId" :disabled="batchUploading" placeholder="course-xxx（商品页「编辑课程」会带入）" @keyup.enter="load" />
      </div>
      <UiButton variant="ghost" :disabled="batchUploading" @click="load"><RotateCcw :size="14" :stroke-width="1.8" /><span>载入</span></UiButton>
    </div>

    <p v-if="message" class="status">{{ message }}</p>
    <p v-if="progress" class="uploading">{{ progress }}</p>

    <template v-if="course">
      <!-- 课程信息 / 视频进度 / 自动保存 / 发布 -->
      <Card>
        <div class="course-head">
          <input v-model="course.title" maxlength="60" placeholder="课程标题" class="title-in" />
          <div class="head-right">
            <div class="vstat">
              <span class="vstat-num">视频 {{ stats.done }}/{{ stats.total }}</span>
              <div class="vbar"><div class="vbar-fill" :style="{ width: pct + '%' }" /></div>
            </div>
            <span v-if="saveState" class="autosave" :class="saveState">{{ saveState === 'saving' ? '自动保存中…' : saveState === 'saved' ? '已自动存草稿' : '自动保存失败·点保存重试' }}</span>
            <UiButton v-if="vodPendingCount" variant="ghost" size="sm" :disabled="busy || batchUploading" @click="syncVod">同步转码状态（{{ vodPendingCount }} 段转码中）</UiButton>
            <UiButton variant="ghost" size="sm" :disabled="busy" @click="save">保存草稿</UiButton>
            <UiButton size="sm" :disabled="busy" @click="publish">{{ publishConfirm ? '确认发布？老学员立即生效' : '发布上线' }}</UiButton>
          </div>
        </div>
        <p v-if="fromPublished" class="from-pub">当前显示已发布版（尚无草稿·保存即建草稿）</p>
        <p v-if="publishConfirm && publishIssues.length" class="pub-warn">发布提醒：{{ publishIssues.join('；') }}——确认无碍请再点一次「确认发布」</p>
      </Card>

      <!-- 章 → 课时 → 段 三层编排树（每章一卡） -->
      <Card v-for="(ch, ci) in course.chapters" :key="ci">
        <div class="ch-head">
          <Badge tone="brand">第 {{ ci + 1 }} 章</Badge>
          <input v-model="ch.title" placeholder="章标题" maxlength="60" class="ch-title" />
          <button class="icon-btn" title="上移" :disabled="ci === 0 || batchUploading" @click="move(course.chapters, ci, -1)">↑</button>
          <button class="icon-btn" title="下移" :disabled="ci === course.chapters.length - 1 || batchUploading" @click="move(course.chapters, ci, 1)">↓</button>
          <button class="icon-btn" :disabled="batchUploading" :class="{ warn: confirmKey === 'ch:' + ci }" :title="confirmKey === 'ch:' + ci ? '再点确认删章' : '删章'" @click="delChapter(ci)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>

        <div v-for="(l, li) in ch.lessons" :key="li" class="lesson">
          <div class="l-head">
            <input v-model="l.name" placeholder="课时名" maxlength="60" class="l-name" />
            <input v-model="l.dur" placeholder="时长" class="dur" maxlength="10" />
            <button class="icon-btn" title="上移" :disabled="li === 0 || batchUploading" @click="move(ch.lessons, li, -1)">↑</button>
            <button class="icon-btn" title="下移" :disabled="li === ch.lessons.length - 1 || batchUploading" @click="move(ch.lessons, li, 1)">↓</button>
            <button class="icon-btn" :disabled="batchUploading" :class="{ warn: confirmKey === 'l:' + ci + ':' + li }" :title="confirmKey === 'l:' + ci + ':' + li ? '再点确认删课时' : '删课时'" @click="delLesson(ch, ci, li)"><Trash2 :size="14" :stroke-width="1.8" /></button>
          </div>
          <div v-for="(sg, si) in l.segments" :key="si" class="seg">
            <input v-model="sg.name" placeholder="段名" maxlength="60" class="seg-name" />
            <input v-model="sg.dur" placeholder="时长" class="dur" maxlength="10" />
            <label class="upload" :class="{ done: sg.videoFileId, disabled: batchUploading }">
              <component :is="sg.videoFileId ? Check : Upload" :size="13" :stroke-width="2" />
              <span>{{ sg.videoFileId ? '已传 · 替换' : '选视频' }}</span>
              <input type="file" accept="video/mp4,video/quicktime" hidden :disabled="batchUploading" @change="(e) => pickVideo(l, sg, e)" />
            </label>
            <span v-if="vodPending(sg)" class="vod-pending" title="视频已传到点播平台，转码完成前不可发布——点上方「同步转码状态」">转码中</span>
            <button class="icon-btn" title="上移" :disabled="si === 0 || batchUploading" @click="move(l.segments, si, -1)">↑</button>
            <button class="icon-btn" title="下移" :disabled="si === l.segments.length - 1 || batchUploading" @click="move(l.segments, si, 1)">↓</button>
            <button class="icon-btn" :disabled="batchUploading" :class="{ warn: confirmKey === 's:' + ci + ':' + li + ':' + si }" title="删段" @click="delSegment(l, ci, li, si)"><Trash2 :size="14" :stroke-width="1.8" /></button>
          </div>
          <div class="seg-adds">
            <button class="add-btn" @click="addSegment(l)"><Plus :size="13" :stroke-width="2" /><span>加段</span></button>
            <label class="add-btn batch-up" :class="{ disabled: batchUploading }" title="多选视频·按文件名顺序自动灌入/新建小段"><Upload :size="13" :stroke-width="2" /><span>批量传视频</span><input type="file" accept="video/mp4,video/quicktime" multiple hidden :disabled="batchUploading" @change="(e) => batchUpload(l, e)" /></label>
          </div>
        </div>
        <button class="add-btn" @click="addLesson(ch)"><Plus :size="13" :stroke-width="2" /><span>加课时</span></button>
      </Card>

      <div><button class="add-chapter" @click="addChapter"><Plus :size="15" :stroke-width="2" /><span>加章</span></button></div>
    </template>
    <!-- 选择器模式（批3 死胡同改造）：直入无课号时从商品桥列已关联课程点选 -->
    <Card v-else-if="!message && courseOptions && courseOptions.length" title="选择课程" sub="从已关联课程的商品选一门进入；未关联的先到商品页「编辑课程」建立关联">
      <div class="pick-list">
        <button v-for="o in courseOptions" :key="o.cid" class="pick-row" @click="pickCourse(o.cid)">
          <span class="pick-name">{{ o.label }}</span>
          <code class="pick-id">{{ o.cid }}</code>
        </button>
      </div>
    </Card>
    <EmptyState v-else-if="!message" :icon="BookOpen" text="输入课程编号（course-xxx）载入其章节结构" />
  </div>
</template>

<style scoped>
/* 页级宽度（独立路由）；嵌入向导时去约束，宽度由向导面板决定 */
.courses {
  max-width: 900px;
}
.courses.embed {
  max-width: none;
}
/* courseId 载入条：加宽输入框（ld-search 默认 min-width 偏窄） */
.cid-box input {
  min-width: 300px;
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
/* 课程信息行（外框由 Card 提供） */
.course-head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.title-in {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
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
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--ld-amber);
}
.pub-warn {
  margin: 10px 0 0;
  padding: 9px 13px;
  border-radius: var(--ld-radius-sm);
  font-size: 12px;
  background: var(--ld-bg-red-soft);
  color: var(--ld-red);
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
/* 章头（外框由 Card 提供） */
.ch-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.ch-title {
  flex: 1;
  min-width: 0;
  padding: 7px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 14px;
  font-weight: 600;
}
/* 课时块（章内缩进的淡紫盒） */
.lesson {
  margin: 10px 0 10px 20px;
  padding: 12px 14px;
  background: var(--ld-bg-lilac);
  border-radius: var(--ld-radius);
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
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  background: var(--ld-bg);
}
.dur {
  width: 84px;
  flex: none;
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  background: var(--ld-bg);
}
/* 小节行：段名 / 时长 / 上传位 / ↑ ↓ 删 */
.seg {
  display: grid;
  grid-template-columns: 1fr 84px auto auto auto auto;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.seg-name {
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  background: var(--ld-bg);
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
/* VOD 转码中 chip（决策§31 批2）：已传但转码未就绪——发布被云端闸拦的可视化对应物 */
.vod-pending {
  padding: 4px 10px;
  border: 1px solid var(--ld-amber);
  border-radius: 999px;
  color: var(--ld-amber);
  background: var(--ld-bg-amber-soft);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
/* 上传中禁用态（G2 复审补：批量传视频在途时和其余受锁控件一致给可感知反馈，防用户选完文件误以为失灵） */
.upload.disabled,
.batch-up.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
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
/* 加段 / 加课时 / 批量传（虚线药丸 = 树内增项） */
.seg-adds {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
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
.batch-up {
  border-style: solid;
  background: var(--ld-bg-lilac);
}
/* 加章（页级增项·虚线药丸） */
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

/* 选择器模式（批3 死胡同改造）：课程挑选列表（商品桥） */
.pick-list {
  display: flex;
  flex-direction: column;
}
.pick-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border: none;
  border-bottom: 1px solid var(--ld-line);
  background: none;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}
.pick-row:hover {
  background: var(--ld-bg);
}
.pick-name {
  color: var(--ld-ink);
  font-weight: 600;
}
.pick-id {
  color: var(--ld-content-2);
  font-size: 11px;
}
</style>
