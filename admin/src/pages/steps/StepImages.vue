<script setup>
/**
 * 第 1 步 · 产品图片（图片款式驱动，新建商品的起点）。
 * 封面图 1 张（列表卡与详情头图）+ 其余图若干（拖拽排序）；同步用于小程序商品页。
 */
import { ref } from 'vue'
import { useProductsStore } from '@/store/products.js'
import { uploadImage } from '@/api/cloud.js'

const props = defineProps({ product: { type: Object, required: true } })
const store = useProductsStore()
const busy = ref(false)
let dragFrom = -1

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
    alert('图片上传失败：' + err.message)
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
        <div class="g-title">封面图（1 张）</div>
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
        <div class="g-title">其余图（细节 / 场景，可拖动排序）</div>
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
</style>
