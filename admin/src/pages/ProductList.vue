<script setup>
import { useRouter } from 'vue-router'
import { useProductsStore, stepDone, STEP_NAMES } from '@/store/products.js'

const router = useRouter()
const store = useProductsStore()
store.load()

async function createProduct() {
  const p = await store.create()
  router.push(`/product/${p.id}/step/1`) // 新建从第 1 步（产品图片）开始：图片款式驱动
}
function open(p) {
  // 进入第一个未完成的步骤；全完成则进第 1 步查看
  const n = [1, 2, 3, 4, 5, 6].find((i) => !stepDone(p, i)) || 1
  router.push(`/product/${p.id}/step/${n}`)
}
async function removeProduct(p) {
  if (confirm(`删除「${p.name || '未命名商品'}」？此操作不可撤销。`)) await store.remove(p.id)
}
</script>

<template>
  <div>
    <p v-if="store.error" class="errbar">{{ store.error }}</p>
    <header class="head">
      <div>
        <h1>商品与上新</h1>
        <p class="sub">
          一款商品一条流水线：产品图片 → 商品信息 → SKU → 教学视频 → 二维码卡片 → 码批次与印刷包
        </p>
      </div>
      <button class="btn primary" @click="createProduct">＋ 新建商品</button>
    </header>

    <div class="grid">
      <div v-for="p in store.list" :key="p.id" class="card prod">
        <div class="cover" @click="open(p)">
          <img v-if="store.imgUrl(p.cover)" :src="store.imgUrl(p.cover)" alt="" />
          <span v-else class="cover-ph">尚无封面图</span>
        </div>
        <div class="body">
          <div class="name-row">
            <span class="name">{{ p.name || '未命名商品' }}</span>
            <span class="chip" :class="store.doneCount(p) >= 6 ? 'green' : 'grey'">
              {{ store.doneCount(p) >= 6 ? '可投产' : '筹备中' }}
            </span>
          </div>
          <div class="meta">
            {{ p.price ? `￥${p.price}` : '未定价' }} · {{ p.skus.length }} 个规格 ·
            {{ p.images.length + (p.cover ? 1 : 0) }} 张图
          </div>
          <div class="steps">
            <span
              v-for="n in 6"
              :key="n"
              class="dot"
              :class="{ done: stepDone(p, n) }"
              :title="`${n} · ${STEP_NAMES[n - 1]}`"
              @click="router.push(`/product/${p.id}/step/${n}`)"
              >{{ stepDone(p, n) ? '✓' : n }}</span
            >
            <span class="steps-text">{{ store.doneCount(p) }}/6</span>
          </div>
          <div class="foot">
            <button class="del" @click="removeProduct(p)">删除</button>
            <button class="btn brand" @click="open(p)">{{ store.doneCount(p) ? '继续上新 →' : '开始上新 →' }}</button>
          </div>
        </div>
      </div>

      <button class="newcard" @click="createProduct">
        <span class="plus">＋</span>
        <span class="nc-t">新建商品</span>
        <span class="nc-s">从第 1 步「产品图片」开始走上新向导</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.errbar {
  background: #fdf0ef;
  border: 1px solid #f0c8c5;
  color: var(--red);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12.5px;
  margin: 0 0 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 26px;
}
h1 {
  font-size: 24px;
  color: var(--ink);
  margin: 0 0 6px;
}
.sub {
  margin: 0;
  font-size: 13px;
  color: var(--content-2);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 24px;
}
.prod {
  overflow: hidden;
  border-radius: 16px;
}
.cover {
  height: 150px;
  background: var(--bg-sage);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-ph {
  font-size: 12px;
  color: var(--content-2);
}
.body {
  padding: 16px 20px 18px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.name {
  flex: 1;
  font-size: 15.5px;
  font-weight: 700;
  color: var(--ink);
}
.meta {
  font-size: 12px;
  color: var(--content-2);
  margin: 8px 0 10px;
}
.steps {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  background: var(--bg-grey);
  color: var(--content-2);
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.dot.done {
  background: var(--green-bg);
  border-color: var(--green-line);
  color: var(--green);
}
.steps-text {
  font-size: 11.5px;
  color: var(--content-2);
  margin-left: 4px;
}
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
}
.del {
  border: none;
  background: none;
  color: var(--content-2);
  font-size: 12px;
  cursor: pointer;
}
.del:hover {
  color: var(--red);
}
.newcard {
  border: 1px dashed var(--line-strong);
  border-radius: 16px;
  background: none;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}
.newcard:hover {
  border-color: var(--purple-line);
  background: var(--bg-lilac);
}
.plus {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  color: var(--brand);
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nc-t {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--content);
}
.nc-s {
  font-size: 11.5px;
  color: var(--content-2);
}
</style>
