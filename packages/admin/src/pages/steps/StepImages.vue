<script setup>
/**
 * 第 1 步 · 产品图片（图片款式驱动，新建商品的起点）。
 * 封面图 1 张（列表卡与详情头图）+ 其余图若干（拖拽排序）；同步用于小程序商品页。
 */
import { computed, ref, onMounted } from 'vue'
import { useProductsStore } from '@/store/products.js'
import { uploadImage, getHomeContent, saveHomeContent } from '@/api/cloud.js'
import { toast } from '@/utils/ui.js'

const props = defineProps({ product: { type: Object, required: true } })
const store = useProductsStore()
const busy = ref(false)
let dragFrom = -1

// —— 激活欢迎页背景图（按课程·按状态·同课程同图·欢迎页与产品对应）——
// 扫码激活进 welcome 时，小程序按 courseId + 屏状态取 content.home.activationBgByCourse[courseId][state]（回退全局→默认）。
// courseId 与 StepVideos/StepCards 同源派生（product.courseId 或 course-<id>），与小程序 activate 返回一致。
// 三态：welcome=欢迎页 / welcomeBack=欢迎回来 / taken=已被激活；「正在激活」是全局图（在橱窗页设，不在这）。
const courseId = computed(() => props.product.courseId || 'course-' + props.product.id)
const WEL_STATES = [
  { key: 'welcome', label: '欢迎页', note: '扫码激活成功进的欢迎屏' },
  { key: 'welcomeBack', label: '欢迎回来', note: '本人重扫已激活的码·继续学习' },
  { key: 'taken', label: '已被激活', note: '码已被他人使用的提示屏' },
]
const welBusy = ref('') // 正在忙的 state key（''＝空闲）
const welSet = ref({}) // { [stateKey]: bool } 该课该态已配（重载只显「已设置」·fileID 解 url 不值当）
const welPreview = ref({}) // { [stateKey]: url } 本次上传预览（重载不保留）
const welErr = ref('')
// 兼容旧结构（值为单字符串＝welcome 那张）→ 归一成对象
function normalizeEntry(entry) {
  if (typeof entry === 'string') return entry ? { welcome: entry } : {}
  return entry && typeof entry === 'object' ? { ...entry } : {}
}
onMounted(async () => {
  try {
    const home = await getHomeContent()
    const entry = normalizeEntry(home?.activationBgByCourse?.[courseId.value])
    welSet.value = Object.fromEntries(WEL_STATES.map((s) => [s.key, !!entry[s.key]]))
  } catch {
    /* 读不到不阻塞上传 */
  }
})
async function uploadWelcomeBg(e, stateKey) {
  const file = (e.target.files || [])[0]
  e.target.value = ''
  if (!file || welBusy.value) return
  welBusy.value = stateKey
  welErr.value = ''
  try {
    const { ref: fileID, url } = await uploadImage(file, props.product.id)
    const home = (await getHomeContent()) || {}
    const entry = normalizeEntry(home.activationBgByCourse?.[courseId.value])
    entry[stateKey] = fileID
    const map = { ...(home.activationBgByCourse || {}), [courseId.value]: entry }
    await saveHomeContent({ ...home, activationBgByCourse: map })
    welPreview.value = { ...welPreview.value, [stateKey]: url }
    welSet.value = { ...welSet.value, [stateKey]: true }
  } catch (err) {
    welErr.value = '上传失败：' + (err?.message || err)
  } finally {
    welBusy.value = ''
  }
}
async function clearWelcomeBg(stateKey) {
  welBusy.value = stateKey
  welErr.value = ''
  try {
    const home = (await getHomeContent()) || {}
    const entry = normalizeEntry(home.activationBgByCourse?.[courseId.value])
    delete entry[stateKey]
    const map = { ...(home.activationBgByCourse || {}) }
    if (Object.keys(entry).length) map[courseId.value] = entry
    else delete map[courseId.value] // 该课三态全空→剔除整条
    await saveHomeContent({ ...home, activationBgByCourse: map })
    welPreview.value = { ...welPreview.value, [stateKey]: '' }
    welSet.value = { ...welSet.value, [stateKey]: false }
  } catch (err) {
    welErr.value = '清除失败：' + (err?.message || err)
  } finally {
    welBusy.value = ''
  }
}

async function pick(e, isCover) {
  const files = [...(e.target.files || [])]
  e.target.value = ''
  if (!files.length || busy.value) return
  busy.value = true
  try {
    if (isCover) {
      const { ref: fileRef, url } = await uploadImage(files[0], props.product.id)
      store.addUrl(fileRef, url)
      await store.update(props.product.id, { cover: fileRef })
    } else {
      const refs = []
      for (const f of files) {
        const { ref: fileRef, url } = await uploadImage(f, props.product.id)
        store.addUrl(fileRef, url)
        refs.push(fileRef)
      }
      await store.update(props.product.id, { images: [...props.product.images, ...refs] })
    }
  } catch (err) {
    toast('图片上传失败：' + err.message, 'err')
  } finally {
    busy.value = false
  }
}
async function removeCover() {
  await store.update(props.product.id, { cover: '' })
}
async function removeImage(i) {
  const images = props.product.images.filter((_, idx) => idx !== i)
  await store.update(props.product.id, { images })
}
// 其余图拖拽排序
function onDrop(to) {
  if (dragFrom < 0 || dragFrom === to) return
  const images = [...props.product.images]
  const [moved] = images.splice(dragFrom, 1)
  images.splice(to, 0, moved)
  dragFrom = -1
  store.update(props.product.id, { images })
}
</script>

<template>
  <div>
    <h2>第 1 步 · 产品图片</h2>
    <p class="desc">先传图定款式——封面图是商品的「脸」（列表与详情头图），其余图补充细节；同步用于小程序商品页</p>

    <div class="groups">
      <div class="group">
        <div class="g-title req">封面图（1 张）<span class="opt">上架必填</span></div>
        <div v-if="product.cover" class="tile cover">
          <img :src="store.imgUrl(product.cover)" alt="封面图" />
          <span class="badge">封面图</span>
          <button class="x" title="删除" @click="removeCover">×</button>
        </div>
        <label v-else class="tile up">
          <input type="file" accept="image/*" hidden @change="pick($event, true)" />
          <span class="up-ico">⬆</span>
          <span class="up-t">上传封面图</span>
          <span class="up-s">PNG / JPG</span>
        </label>
      </div>

      <div class="group grow">
        <div class="g-title">其余图（细节 / 场景，可拖动排序）<span class="opt">选填</span></div>
        <div class="row">
          <div
            v-for="(img, i) in product.images"
            :key="i"
            class="tile"
            draggable="true"
            @dragstart="dragFrom = i"
            @dragover.prevent
            @drop="onDrop(i)"
          >
            <img :src="store.imgUrl(img)" alt="" />
            <button class="x" title="删除" @click="removeImage(i)">×</button>
          </div>
          <label class="tile up">
            <input type="file" accept="image/*" multiple hidden @change="pick($event, false)" />
            <span class="up-ico">⬆</span>
            <span class="up-t">{{ busy ? '处理中…' : '拖入或点击上传' }}</span>
            <span class="up-s">可多选</span>
          </label>
        </div>
      </div>
    </div>

    <div class="group welbg">
      <div class="g-title">激活欢迎页背景图（按屏分管）<span class="opt">选填 · 扫码各屏的底图·按课程绑定</span></div>
      <div class="welbg-states">
        <div v-for="s in WEL_STATES" :key="s.key" class="welbg-state">
          <div class="welbg-label">{{ s.label }}<span class="welbg-sub">{{ s.note }}</span></div>
          <div class="welbg-row">
            <div v-if="welPreview[s.key]" class="tile cover">
              <img :src="welPreview[s.key]" :alt="s.label" />
              <span class="badge">{{ s.label }}</span>
            </div>
            <div v-else-if="welSet[s.key]" class="tile welset">已设置 ✓</div>
            <label class="tile up">
              <input
                type="file"
                accept="image/*"
                :disabled="!!welBusy"
                hidden
                @change="uploadWelcomeBg($event, s.key)"
              />
              <span class="up-ico">⬆</span>
              <span class="up-t">{{
                welBusy === s.key ? '上传中…' : welSet[s.key] ? '更换' : '上传'
              }}</span>
              <span class="up-s">PNG / JPG</span>
            </label>
            <button
              v-if="welSet[s.key]"
              class="welclear"
              :disabled="!!welBusy"
              @click="clearWelcomeBg(s.key)"
            >
              恢复默认
            </button>
          </div>
        </div>
      </div>
      <div v-if="welErr" class="welerr">{{ welErr }}</div>
      <p class="welnote">
        同课程的产品共用这些图（按课程绑定）；不设则用通用默认底图。「正在激活」图是全局的，在「橱窗」页设置。
      </p>
    </div>

    <p class="hint">💡 封面图建议 1:1、1200×1200 以上；第 5 步设计二维码卡片时可直接取用这里的图。</p>
  </div>
</template>

<style scoped>
h2 {
  font-size: 16.5px;
  color: var(--ink);
  margin: 0 0 4px;
}
.desc {
  font-size: 12px;
  color: var(--content-2);
  margin: 0 0 20px;
}
.groups {
  display: flex;
  gap: 28px;
  align-items: flex-start;
}
.grow {
  flex: 1;
  min-width: 0;
}
.g-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--content);
  margin-bottom: 8px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.tile {
  position: relative;
  width: 150px;
  height: 150px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-grey);
  border: 1px solid var(--line);
}
.tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tile.cover {
  border: 1.5px solid var(--brand);
}
.badge {
  position: absolute;
  left: 0;
  bottom: 0;
  background: var(--purple-ink);
  color: var(--white);
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 0 10px 0 0;
}
.x {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.x:hover {
  color: var(--red);
}
.tile.up {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--bg-lilac);
  border: 1px dashed var(--purple-line);
  cursor: pointer;
}
.up-ico {
  color: var(--brand);
  font-size: 18px;
}
.up-t {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-active);
}
.up-s {
  font-size: 10px;
  color: var(--content-2);
}
.hint {
  margin: 20px 0 16px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
/* 激活欢迎页背景图块 */
.welbg {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.welbg-states {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.welbg-state {
  min-width: 200px;
}
.welbg-label {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--content);
  margin-bottom: 8px;
}
.welbg-sub {
  margin-left: 8px;
  font-weight: 400;
  color: var(--content-2);
}
.welbg-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.tile.welset {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-active);
}
.welclear {
  border: 1px solid var(--line);
  background: var(--white);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  cursor: pointer;
}
.welclear:hover {
  color: var(--red);
}
.welerr {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--red);
}
.welnote {
  margin: 10px 0 0;
  font-size: 11px;
  color: var(--content-2);
}
</style>
