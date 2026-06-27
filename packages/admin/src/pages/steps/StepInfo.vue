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
  params: JSON.parse(JSON.stringify(props.product.params || [])),
  detailSections: JSON.parse(JSON.stringify(props.product.detailSections || [])),
  kit: JSON.parse(JSON.stringify(props.product.kit || [])),
})

const KIT_ICONS = ['circle', 'pen-tool', 'cloud', 'eye', 'book-open', 'sparkles-purple', 'package', 'truck']
const addParam = () => form.params.length < 8 && form.params.push(['', ''])
const addSection = () => form.detailSections.length < 4 && form.detailSections.push({ lead: '', body: '' })
const addKit = () => form.kit.length < 8 && form.kit.push({ icon: 'circle', name: '', qty: '' })
// 即输即存（每步自动保存）
watch(form, () => store.update(props.product.id, { ...form }), { deep: true })
</script>

<template>
  <div>
    <h2>第 2 步 · 商品信息</h2>
    <p class="desc">款式已由第 1 步的图片定下，这一步给它名字和价格；与小程序商品页同步显示</p>

    <label class="field-label req">商品名称<span class="opt">上架必填</span></label>
    <input v-model="form.name" class="input" placeholder="如：小棉鸭礼盒 · 零基础钩织套装" />

    <div class="row3">
      <div>
        <label class="field-label req">现价（￥）</label>
        <input v-model="form.price" class="input" type="number" min="0" placeholder="198" />
      </div>
      <div>
        <label class="field-label">划线价（￥）<span class="opt">选填</span></label>
        <input v-model="form.was" class="input" type="number" min="0" placeholder="258" />
      </div>
      <div>
        <label class="field-label">角标标签<span class="opt">选填</span></label>
        <input v-model="form.tag" class="input" placeholder="如：送礼首选" />
      </div>
    </div>

    <label class="field-label">一句话简介<span class="opt">选填</span></label>
    <textarea
      v-model="form.brief"
      class="input area"
      placeholder="如：含全部材料与工具，零基础跟视频钩出第一只小棉鸭"
    ></textarea>

    <div class="group">
      <div class="g-t">详情页 · 商品参数表（如 材质 / 成品尺寸 / 产地）</div>
      <div v-for="(kv, i) in form.params" :key="i" class="rowline">
        <input v-model="kv[0]" class="input k" maxlength="10" placeholder="参数名" />
        <input v-model="kv[1]" class="input" maxlength="40" placeholder="参数值" />
        <button class="del" @click="form.params.splice(i, 1)">删除</button>
      </div>
      <button class="addline" :disabled="form.params.length >= 8" @click="addParam">＋ 添加参数（≤8）</button>
    </div>

    <div class="group">
      <div class="g-t">详情页 · 图文段落（每段配图自动取第 1 步「其余图」的第 N 张）</div>
      <div v-for="(d, i) in form.detailSections" :key="i" class="secline">
        <div class="rowline">
          <input v-model="d.lead" class="input" maxlength="30" :placeholder="'第 ' + (i + 1) + ' 段小标题'" />
          <button class="del" @click="form.detailSections.splice(i, 1)">删除</button>
        </div>
        <textarea v-model="d.body" class="input area" maxlength="200" placeholder="段落正文"></textarea>
      </div>
      <button class="addline" :disabled="form.detailSections.length >= 4" @click="addSection">＋ 添加段落（≤4）</button>
    </div>

    <div class="group">
      <div class="g-t">详情页 · 套装包含清单</div>
      <div v-for="(k, i) in form.kit" :key="i" class="rowline">
        <select v-model="k.icon" class="input icon">
          <option v-for="ic in KIT_ICONS" :key="ic" :value="ic">{{ ic }}</option>
        </select>
        <input v-model="k.name" class="input" maxlength="14" placeholder="物品名" />
        <input v-model="k.qty" class="input k" maxlength="14" placeholder="数量（如 1 包 50g）" />
        <button class="del" @click="form.kit.splice(i, 1)">删除</button>
      </div>
      <button class="addline" :disabled="form.kit.length >= 8" @click="addKit">＋ 添加物品（≤8）</button>
    </div>

    <p class="hint">💡 规格在第 3 步、配套课程在第 4 步；以上三块留空时，小程序详情页显示通用样例文案。</p>
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
.group {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 16px;
  margin-top: 14px;
}
.g-t {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 10px;
}
.rowline {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.input.k {
  max-width: 160px;
}
.input.icon {
  max-width: 150px;
}
.secline {
  border-bottom: 1px dashed var(--line);
  padding-bottom: 10px;
  margin-bottom: 10px;
}
.del {
  border: none;
  background: none;
  color: var(--content-2);
  font-size: 11.5px;
  cursor: pointer;
  flex: 0 0 auto;
}
.del:hover {
  color: var(--red);
}
.addline {
  border: none;
  background: none;
  color: var(--brand-active);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 0;
}
.addline:disabled {
  color: var(--line-strong);
  cursor: not-allowed;
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
