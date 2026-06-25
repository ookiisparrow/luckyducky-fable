<script setup>
/**
 * 帮助视频（求助面板「辅助视频」管理·全局共用·所有课程同一份）。
 * 对应小程序播放页：求助按钮 →「遇到问题了」→ 辅助视频列表（如「如何起手结」「拆线重来」「排查卡点」）。
 * 这些是通用钩织求助短视频，与具体课程无关，故一份全局共用（用户拍板）。
 * - 增删改 + 拖拽排序；每条一条视频（≤10MB·复用上新第4步的直传通道）。
 * - 改动随存（防抖自动保存）；存进 content 集合 doc 'helpVideos'，小程序求助面板立即可见。
 */
import { ref } from 'vue'
import { useAutosave } from '@/composables/useAutosave.js'
import { cloudMode, listHelpVideos, saveHelpVideos, uploadVideo } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'

const items = ref(null)
const loading = ref(true)
const loadErr = ref('')
const uploads = ref({}) // itemId -> 0~1 进度

const rid = () => 'h' + Math.random().toString(36).slice(2, 8)

async function init() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  try {
    items.value = await listHelpVideos()
  } catch (e) {
    loadErr.value = '帮助视频加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
init()

// 防抖自动保存：整列表存进 content/helpVideos（小程序求助面板立即生效）
const { saveState } = useAutosave(items, (snap) => saveHelpVideos(snap), {
  delay: 800,
  ready: () => !loading.value,
})

function addItem() {
  items.value.push({ id: rid(), title: '', sub: '', desc: '', dur: '', videoFileId: '' })
}
async function removeAt(i) {
  if (
    await confirmDialog({ title: '删除', message: '删除这条帮助视频？', confirmText: '删除', danger: true })
  )
    items.value.splice(i, 1)
}

// 拖拽排序（单列表：目标位置显紫色落点线）
const drag = ref(null)
const over = ref(null)
function dragStart(i) {
  drag.value = i
}
function dragOver(i, e) {
  e.preventDefault()
  if (drag.value !== null) over.value = i
}
function dragEnd() {
  drag.value = null
  over.value = null
}
function isOver(i) {
  return over.value === i && drag.value !== null && drag.value !== i
}
function drop(i) {
  const d = drag.value
  dragEnd()
  if (d === null || d === i) return
  const [moved] = items.value.splice(d, 1)
  items.value.splice(i, 0, moved)
}

// 视频上传：置进度 → 读时长自动填 dur → 直传云存储 → 写 videoFileId → 清进度
async function pickVideo(e, it) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    uploads.value = { ...uploads.value, [it.id]: 0 }
    readDuration(file).then((d) => {
      if (d) it.dur = d
    })
    const { ref: fileId } = await uploadVideo(file, 'help', it.id, (p) => {
      uploads.value = { ...uploads.value, [it.id]: p }
    })
    it.videoFileId = fileId
  } catch (err) {
    toast('视频上传失败：' + err.message, 'err')
  } finally {
    const u = { ...uploads.value }
    delete u[it.id]
    uploads.value = u
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
</script>

<template>
  <div>
    <div class="headrow">
      <div>
        <h2>帮助视频</h2>
        <p class="desc">
          小程序播放页「求助 →遇到问题了」里的辅助视频，全部课程共用一份（如起手结、拆线重来、排查卡点等通用技法）
        </p>
      </div>
      <span class="save" :class="saveState">
        {{ { saving: '保存中…', saved: '已保存 ✓', error: '保存失败，检查网络' }[saveState] || '' }}
      </span>
    </div>

    <p v-if="!cloudMode" class="hint warn">
      帮助视频管理需云端模式（配置 admin/.env.local 的 VITE_ADMIN_API）。
    </p>
    <p v-else-if="loadErr" class="hint warn">{{ loadErr }}</p>
    <p v-else-if="loading" class="hint">帮助视频加载中…</p>

    <template v-else-if="items">
      <p v-if="!items.length" class="hint">还没有帮助视频。点下面「＋ 添加帮助视频」新增一条，传上视频即可。</p>

      <div
        v-for="(it, i) in items"
        :key="it.id"
        class="card"
        :class="{ 'drop-before': isOver(i), dragging: drag === i }"
        draggable="true"
        @dragstart="dragStart(i)"
        @dragover="dragOver(i, $event)"
        @dragend="dragEnd"
        @drop="drop(i)"
      >
        <div class="card-head">
          <span class="grip" title="拖动排序">⠿</span>
          <span class="num">{{ i + 1 }}</span>
          <input v-model="it.title" class="name title" placeholder="标题（如「如何制作一个开始结」）" />
          <span class="meta">{{ it.dur || '--:--' }}</span>

          <span v-if="uploads[it.id] !== undefined" class="upstate">
            <span class="bar small"><span class="fill" :style="{ width: Math.round(uploads[it.id] * 100) + '%' }"></span></span>
            {{ Math.round(uploads[it.id] * 100) }}%
          </span>
          <label v-else-if="!it.videoFileId" class="upbtn">
            <input type="file" accept="video/mp4,video/quicktime" hidden @change="pickVideo($event, it)" />
            ⬆ 传视频
          </label>
          <span v-else class="done">
            ✓ 已传
            <label class="relink">
              <input type="file" accept="video/mp4,video/quicktime" hidden @change="pickVideo($event, it)" />替换
            </label>
          </span>

          <button class="mini del" @click="removeAt(i)">删除</button>
        </div>
        <input v-model="it.sub" class="name sub" placeholder="一句话副标题（如「第一针的滑结，跟着做就会」）" />
        <textarea v-model="it.desc" class="name descbox" rows="2" placeholder="详细说明（视频下方展示，选填）"></textarea>
      </div>

      <button class="addline" @click="addItem">＋ 添加帮助视频</button>

      <p class="hint">
        💡 标题/说明直接在框里改；拖住 ⠿ 调顺序；每条传一个视频（≤10MB）。改动随改随存，小程序求助面板即刻可见。
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
.card {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--white);
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
.card-head {
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
.num {
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
.name {
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 13px;
  background: transparent;
  outline: none;
  font-family: inherit;
}
.name:hover {
  border-color: var(--line-strong);
}
.name:focus {
  border-color: var(--brand);
  background: var(--white);
}
.title {
  flex: 1;
  font-weight: 700;
  font-size: 14px;
}
.sub {
  display: block;
  width: 100%;
  margin-top: 6px;
  box-sizing: border-box;
}
.descbox {
  display: block;
  width: 100%;
  margin-top: 6px;
  box-sizing: border-box;
  resize: vertical;
  line-height: 1.5;
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
.bar.small {
  width: 90px;
  flex: 0 0 auto;
  height: 5px;
  display: inline-block;
  background: var(--bg-grey);
  border-radius: 99px;
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: var(--brand);
  border-radius: 99px;
  transition: width 0.2s;
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
