<script setup>
/**
 * 第 2 步 · 商品信息：款式已由第 1 步图片定下，这一步给它名字和价格。
 * 字段与小程序商品页（catalog）对齐：name / price / was（划线价）/ tag（角标）/ brief。
 */
import { reactive, watch } from 'vue'
import { useProductsStore } from '@/store/products.js'

const props = defineProps({ product: { type: Object, required: true } })
const store = useProductsStore()

const form = reactive({
  name: props.product.name,
  price: props.product.price,
  was: props.product.was,
  tag: props.product.tag,
  brief: props.product.brief,
})
// 即输即存（每步自动保存）
watch(form, () => store.update(props.product.id, { ...form }), { deep: true })
</script>

<template>
  <div>
    <h2>第 2 步 · 商品信息</h2>
    <p class="desc">款式已由第 1 步的图片定下，这一步给它名字和价格；与小程序商品页同步显示</p>

    <label class="field-label">商品名称</label>
    <input v-model="form.name" class="input" placeholder="如：幸运小鸭礼盒 · 零基础钩织套装" />

    <div class="row3">
      <div>
        <label class="field-label">现价（￥）</label>
        <input v-model="form.price" class="input" type="number" min="0" placeholder="198" />
      </div>
      <div>
        <label class="field-label">划线价（￥，可空）</label>
        <input v-model="form.was" class="input" type="number" min="0" placeholder="258" />
      </div>
      <div>
        <label class="field-label">角标标签（可空）</label>
        <input v-model="form.tag" class="input" placeholder="如：送礼首选" />
      </div>
    </div>

    <label class="field-label">一句话简介</label>
    <textarea
      v-model="form.brief"
      class="input area"
      placeholder="如：含全部材料与工具，零基础跟视频钩出第一只幸运小鸭"
    ></textarea>

    <p class="hint">💡 详情页的图文介绍、规格、配套课程在后面的步骤里完成；这一步只填最基础的身份信息。</p>
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
.row3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin: 14px 0;
}
.area {
  min-height: 76px;
  resize: vertical;
}
.field-label {
  margin-top: 2px;
}
.hint {
  margin: 18px 0 16px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
</style>
