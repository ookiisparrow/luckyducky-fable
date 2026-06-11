<script setup>
/**
 * 第 3 步 · 商品 SKU：规格名称 + 价格，行内编辑，与小程序详情页规格选择一一对应。
 */
import { useProductsStore } from '@/store/products.js'

const props = defineProps({ product: { type: Object, required: true } })
const store = useProductsStore()

function patchSkus(skus) {
  store.update(props.product.id, { skus })
}
function addSku() {
  patchSkus([...props.product.skus, { name: '', price: props.product.price || '' }])
}
function editSku(i, key, val) {
  const skus = props.product.skus.map((s, idx) => (idx === i ? { ...s, [key]: val } : s))
  patchSkus(skus)
}
function removeSku(i) {
  patchSkus(props.product.skus.filter((_, idx) => idx !== i))
}
</script>

<template>
  <div>
    <h2>第 3 步 · 商品 SKU</h2>
    <p class="desc">填写这款商品的规格与价格，与小程序详情页的规格选择一一对应</p>

    <div class="table">
      <div class="thead">
        <span class="c-name">规格名称</span>
        <span class="c-price">价格（￥）</span>
        <span class="c-op">操作</span>
      </div>
      <div v-for="(s, i) in product.skus" :key="i" class="trow">
        <input
          class="input c-name"
          :value="s.name"
          placeholder="如：经典暖黄"
          @input="editSku(i, 'name', $event.target.value)"
        />
        <input
          class="input c-price"
          type="number"
          min="0"
          :value="s.price"
          placeholder="198"
          @input="editSku(i, 'price', $event.target.value)"
        />
        <button class="del c-op" @click="removeSku(i)">删除</button>
      </div>
      <button class="addrow" @click="addSku">＋ 添加规格</button>
    </div>

    <p v-if="!product.skus.length" class="hint">💡 至少添加一个规格（单一款式也建一条，如「默认款」），价格默认带入商品现价。</p>
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
.table {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  max-width: 720px;
}
.thead {
  display: flex;
  gap: 10px;
  background: var(--bg-lilac);
  padding: 9px 14px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--content-2);
}
.trow {
  display: flex;
  gap: 10px;
  padding: 8px 14px;
  border-top: 1px solid var(--line);
  align-items: center;
}
.c-name {
  flex: 1;
}
.c-price {
  width: 140px;
  flex: 0 0 auto;
}
.c-op {
  width: 60px;
  flex: 0 0 auto;
  text-align: right;
}
.del {
  border: none;
  background: none;
  color: var(--red);
  font-size: 11.5px;
  cursor: pointer;
}
.addrow {
  display: block;
  width: 100%;
  border: none;
  border-top: 1px solid var(--line);
  background: var(--bg-lilac);
  color: var(--brand-active);
  font-size: 12px;
  font-weight: 600;
  padding: 10px;
  cursor: pointer;
}
.hint {
  margin: 18px 0 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  max-width: 720px;
}
</style>
