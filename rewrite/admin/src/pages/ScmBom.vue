<script setup lang="ts">
// 配方与组装（M3 批7）：全局模板（共用料+毛线槽）+ 每产品差异位（三色+专属件）→
// 预演（只读看短缺）→ 执行组装（快照冻结·同单不双扣）。
import { ref, onMounted } from 'vue'
import { getBomSetup, saveBomTemplate, saveBomProfile, previewAssembly, runAssembly, listAssemblies, listMaterials } from '../api/scm'
import { materialHuman, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'

const template = ref<{ commonLines: Array<{ materialId: string; qtyPerSet: number }>; yarnSlots: Array<{ tier: string; form: string; qtyPerSet: number }> }>({ commonLines: [], yarnSlots: [] })
const profiles = ref<Array<Record<string, any>>>([])
const mats = ref<Array<Record<string, any>>>([])
const assemblies = ref<Array<Record<string, any>>>([])
const message = ref('')

const prof = ref({ productId: '', L: '', M: '', S: '', packagingMaterialId: '', cardMaterialId: '' })
const run = ref({ productId: '', spec: '', sets: 1 })
const preview = ref<Array<Record<string, any>>>([])
const runConfirm = ref(false)

async function reload() {
  const [b, m, a] = await Promise.all([getBomSetup(), listMaterials(), listAssemblies()])
  if (b.ok) {
    const t = (b.template as Record<string, any>) || {}
    template.value = { commonLines: t.commonLines || [], yarnSlots: t.yarnSlots || [] }
    profiles.value = (b.profiles as Record<string, any>[]) || []
  }
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  assemblies.value = a.ok ? (a.list as Record<string, any>[]) : []
  message.value = b.ok ? '' : '加载失败：' + String(b.error || '')
}

async function doSaveTemplate() {
  const r = await saveBomTemplate(template.value)
  message.value = r.ok ? '模板已保存（历史组装单的快照不受影响）' : scmErrorText(r.error)
}

async function doSaveProfile() {
  const p = prof.value
  const r = await saveBomProfile({ productId: p.productId, yarnColors: { L: p.L, M: p.M, S: p.S }, packagingMaterialId: p.packagingMaterialId, cardMaterialId: p.cardMaterialId })
  message.value = r.ok ? '差异位已保存' : scmErrorText(r.error)
  void reload()
}

async function doPreview() {
  const r = await previewAssembly(run.value.productId, Number(run.value.sets))
  preview.value = r.ok ? (r.lines as Record<string, any>[]) : []
  message.value = r.ok ? '' : scmErrorText(r.error)
}

async function doRun() {
  if (!runConfirm.value) {
    runConfirm.value = true // 两步确认：执行即扣原料入成品
    return
  }
  runConfirm.value = false
  const r = await runAssembly(run.value.productId, run.value.spec, Number(run.value.sets))
  message.value = r.ok ? `组装完成：扣料 ${(r.consumed as unknown[]).length} 行·入成品 ${Number(r.sets)} 套` : scmErrorText(r.error)
  preview.value = []
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>配方与组装</h2>
    <p v-if="message" class="status">{{ message }}</p>

    <div class="cols">
      <div class="panel">
        <h3>全局模板（所有产品共用）</h3>
        <h4>共用料（每套用量）</h4>
        <div v-for="(l, i) in template.commonLines" :key="i" class="linerow">
          <select v-model="l.materialId">
            <option v-for="m in mats" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
          </select>
          <input v-model.number="l.qtyPerSet" type="number" min="1" />
          <button class="act ghost" @click="template.commonLines.splice(i, 1)">删</button>
        </div>
        <button class="act ghost small" @click="template.commonLines.push({ materialId: '', qtyPerSet: 1 })">+ 加料</button>
        <h4>毛线槽（颜色按产品填）</h4>
        <div v-for="(s, i) in template.yarnSlots" :key="i" class="linerow">
          <select v-model="s.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
          <select v-model="s.form"><option value="raw">原团</option><option value="knotted">带结（仅大团）</option></select>
          <input v-model.number="s.qtyPerSet" type="number" min="1" />
          <button class="act ghost" @click="template.yarnSlots.splice(i, 1)">删</button>
        </div>
        <button class="act ghost small" @click="template.yarnSlots.push({ tier: 'L', form: 'knotted', qtyPerSet: 1 })">+ 加槽</button>
        <div class="ops"><button class="act" @click="doSaveTemplate">保存模板</button></div>
      </div>

      <div class="panel">
        <h3>产品差异位（三色 + 专属件）</h3>
        <input v-model="prof.productId" placeholder="产品 id" />
        <input v-model="prof.L" placeholder="大团颜色（如 pink）" />
        <input v-model="prof.M" placeholder="中团颜色" />
        <input v-model="prof.S" placeholder="小团颜色" />
        <input v-model="prof.packagingMaterialId" placeholder="包装料号（pkg:产品id）" />
        <input v-model="prof.cardMaterialId" placeholder="卡片料号（card:产品id）" />
        <button class="act" @click="doSaveProfile">保存差异位</button>
        <p v-for="p in profiles" :key="p._id" class="row-line">{{ p._id }}：L={{ p.yarnColors?.L }} M={{ p.yarnColors?.M }} S={{ p.yarnColors?.S }}</p>
      </div>

      <div class="panel">
        <h3>组装执行（扣原料·入成品）</h3>
        <input v-model="run.productId" placeholder="产品 id" />
        <input v-model="run.spec" placeholder="规格（可空）" />
        <input v-model.number="run.sets" type="number" min="1" placeholder="套数" />
        <div class="ops">
          <button class="act ghost" @click="doPreview">预演（只看不扣）</button>
          <button class="act warn" @click="doRun">{{ runConfirm ? '确认扣料入成品？' : '执行组装' }}</button>
        </div>
        <table v-if="preview.length">
          <thead><tr><th>料</th><th>需</th><th>存</th><th>缺</th></tr></thead>
          <tbody>
            <tr v-for="l in preview" :key="l.materialId" :class="{ short: l.short > 0 || l.missing }">
              <td>{{ materialHuman(l.materialId) }}{{ l.missing ? '（未建档）' : '' }}</td>
              <td>{{ l.need }}</td><td>{{ l.stock }}</td><td>{{ l.short }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>组装记录</h3>
      <table>
        <thead><tr><th>单号</th><th>产品</th><th>套数</th><th>操作者</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="a in assemblies" :key="a._id">
            <td class="mono">{{ a._id }}</td><td>{{ a.productId }}{{ a.spec ? '（' + a.spec + '）' : '' }}</td>
            <td>{{ a.sets }}</td><td>{{ a.operator }}</td><td>{{ dateTime(a.at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 14px;
  color: var(--ld-purple-ink);
}
h3 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--ld-purple-ink);
}
h4 {
  margin: 10px 0 6px;
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
.panel {
  padding: 14px 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  margin-bottom: 12px;
}
select,
input {
  padding: 6px 9px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 6px;
  width: 100%;
  box-sizing: border-box;
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 70px auto;
  gap: 6px;
}
.linerow select + select {
  grid-column: auto;
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.row-line {
  font-size: 12px;
  margin: 4px 0;
  font-family: ui-monospace, monospace;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}
th,
td {
  padding: 7px 9px;
  font-size: 12px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  color: var(--ld-purple-meta);
}
tr.short td {
  color: var(--ld-red);
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.act {
  padding: 6px 14px;
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
  padding: 4px 10px;
}
</style>
