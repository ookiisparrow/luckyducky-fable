<script setup lang="ts">
// 配方与组装（设计语言一致性·M3 UI 批17）：全局模板（共用料+毛线槽）+ 每产品差异位（三色+专属件）→
// 预演（只读看短缺）→ 执行组装（快照冻结·同单不双扣）。逻辑未动，仅套设计语言。
import { ref, onMounted, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import { getBomSetup, saveBomTemplate, saveBomProfile, previewAssembly, runAssembly, listAssemblies, listMaterials } from '../api/scm'
import { materialHuman, scmErrorText } from '../lib/mapScm'
import { dateTime } from '../lib/format'
import ScmFlowTabs from '../components/ScmFlowTabs.vue'

const template = ref<{ commonLines: Array<{ materialId: string; qtyPerSet: number }>; yarnSlots: Array<{ tier: string; form: string; qtyPerSet: number }> }>({ commonLines: [], yarnSlots: [] })
const profiles = ref<Array<Record<string, any>>>([])
const mats = ref<Array<Record<string, any>>>([])
const assemblies = ref<Array<Record<string, any>>>([])
const message = ref('')
const msgOk = ref(false) // 换皮 .status 恒红→成功信息显红 bug·区分成功(绿)/失败(红)
function note(ok: boolean, okText: string, errText: string) {
  message.value = ok ? okText : errText
  msgOk.value = ok
}

const prof = ref({ productId: '', L: '', M: '', S: '', packagingMaterialId: '', cardMaterialId: '' })
const run = ref({ productId: '', spec: '', sets: 1 })
const preview = ref<Array<Record<string, any>>>([])
const runConfirm = ref(false)
// B1 幂等键：每次组装意图生成一次·重试复用·成功才换新（换皮在 api 内每次现生成→双击/慢网双扣料双入库）
const pendingAsmId = ref('')

async function reload() {
  const [b, m, a] = await Promise.all([getBomSetup(), listMaterials(), listAssemblies()])
  if (b.ok) {
    const t = (b.template as Record<string, any>) || {}
    template.value = { commonLines: t.commonLines || [], yarnSlots: t.yarnSlots || [] }
    profiles.value = (b.profiles as Record<string, any>[]) || []
  }
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  assemblies.value = a.ok ? (a.list as Record<string, any>[]) : []
  note(b.ok, '', '加载失败：' + String(b.error || ''))
}

async function doSaveTemplate() {
  const r = await saveBomTemplate(template.value)
  note(r.ok, '模板已保存（历史组装单的快照不受影响）', scmErrorText(r.error))
}

async function doSaveProfile() {
  const p = prof.value
  const r = await saveBomProfile({ productId: p.productId, yarnColors: { L: p.L, M: p.M, S: p.S }, packagingMaterialId: p.packagingMaterialId, cardMaterialId: p.cardMaterialId })
  note(r.ok, '差异位已保存', scmErrorText(r.error))
  void reload()
}

async function doPreview() {
  // 新预演＝新组装意图·换新幂等键（防拿旧 id 组装改过的产品/套数）
  pendingAsmId.value = ''
  runConfirm.value = false
  const r = await previewAssembly(run.value.productId, Number(run.value.sets))
  preview.value = r.ok ? (r.lines as Record<string, any>[]) : []
  note(r.ok, '', scmErrorText(r.error))
}

async function doRun() {
  if (!runConfirm.value) {
    if (!pendingAsmId.value) pendingAsmId.value = 'asm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) // 确认时生成一次
    runConfirm.value = true // 两步确认：执行即扣原料入成品
    return
  }
  runConfirm.value = false
  const r = await runAssembly(run.value.productId, run.value.spec, Number(run.value.sets), pendingAsmId.value)
  if (r.ok) {
    note(true, `组装完成：扣料 ${(r.consumed as unknown[]).length} 行·入成品 ${Number(r.sets)} 套`, '')
    pendingAsmId.value = '' // 成功才换新 id·下次组装全新幂等键
    preview.value = []
    void reload()
  } else {
    // 失败保留 pendingAsmId：重试复用同一幂等键·撞 id 幂等闸挡双扣（B1 修·后端 _id=assemblyId 确定性 claim）
    note(false, '', scmErrorText(r.error))
  }
}

// 改组装表单（产品/规格/套数）＝新意图·重置幂等键与确认态（防拿旧 id 组装改过的入参）
watch(run, () => {
  pendingAsmId.value = ''
  runConfirm.value = false
}, { deep: true })

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>配方与组装</h1>
      <p class="sub">全局模板（共用料 + 毛线槽）+ 产品差异位（三色 + 专属件）→ 预演看短缺 → 执行组装（快照冻结·同单不双扣）。</p>
    </header>

    <ScmFlowTabs />
    <p v-if="message" class="status" :class="{ ok: msgOk }">{{ message }}</p>

    <div class="cols">
      <section class="card">
        <h2>全局模板（所有产品共用）</h2>
        <h3>共用料（每套用量）</h3>
        <div v-for="(l, i) in template.commonLines" :key="i" class="linerow">
          <select v-model="l.materialId">
            <option v-for="m in mats" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}</option>
          </select>
          <input v-model.number="l.qtyPerSet" type="number" min="1" />
          <button class="icon-x" @click="template.commonLines.splice(i, 1)">×</button>
        </div>
        <button class="add-btn" @click="template.commonLines.push({ materialId: '', qtyPerSet: 1 })"><Plus :size="12" :stroke-width="2" /><span>加料</span></button>
        <h3>毛线槽（颜色按产品填）</h3>
        <div v-for="(s, i) in template.yarnSlots" :key="i" class="linerow">
          <select v-model="s.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
          <select v-model="s.form"><option value="raw">原团</option><option value="knotted">带结（仅大团）</option></select>
          <input v-model.number="s.qtyPerSet" type="number" min="1" />
          <button class="icon-x" @click="template.yarnSlots.splice(i, 1)">×</button>
        </div>
        <button class="add-btn" @click="template.yarnSlots.push({ tier: 'L', form: 'knotted', qtyPerSet: 1 })"><Plus :size="12" :stroke-width="2" /><span>加槽</span></button>
        <div class="ops"><button class="btn-primary" @click="doSaveTemplate">保存模板</button></div>
      </section>

      <section class="card">
        <h2>产品差异位（三色 + 专属件）</h2>
        <input v-model="prof.productId" placeholder="产品 id" />
        <input v-model="prof.L" placeholder="大团颜色（如 pink）" />
        <input v-model="prof.M" placeholder="中团颜色" />
        <input v-model="prof.S" placeholder="小团颜色" />
        <input v-model="prof.packagingMaterialId" placeholder="包装料号（pkg:产品id）" />
        <input v-model="prof.cardMaterialId" placeholder="卡片料号（card:产品id）" />
        <button class="btn-primary" @click="doSaveProfile">保存差异位</button>
        <div class="prof-list">
          <div v-for="p in profiles" :key="p._id" class="prof-line">{{ p._id }}：L={{ p.yarnColors?.L }} M={{ p.yarnColors?.M }} S={{ p.yarnColors?.S }}</div>
        </div>
      </section>

      <section class="card">
        <h2>组装执行（扣原料·入成品）</h2>
        <input v-model="run.productId" placeholder="产品 id" />
        <input v-model="run.spec" placeholder="规格（可空）" />
        <input v-model.number="run.sets" type="number" min="1" placeholder="套数" />
        <div class="ops">
          <button class="btn-ghost" @click="doPreview">预演（只看不扣）</button>
          <button class="btn-warn" @click="doRun">{{ runConfirm ? '确认扣料入成品？' : '执行组装' }}</button>
        </div>
        <div v-if="preview.length" class="preview">
          <div class="pv-head"><span>料</span><span class="r">需</span><span class="r">存</span><span class="r">缺</span></div>
          <div v-for="l in preview" :key="l.materialId" class="pv-row" :class="{ short: l.short > 0 || l.missing }">
            <span>{{ materialHuman(l.materialId) }}{{ l.missing ? '（未建档）' : '' }}</span>
            <span class="r">{{ l.need }}</span><span class="r">{{ l.stock }}</span><span class="r">{{ l.short }}</span>
          </div>
        </div>
      </section>
    </div>

    <section class="table-card">
      <h2>组装记录</h2>
      <div class="table">
        <div class="thead"><span>单号</span><span>产品</span><span class="r">套数</span><span>操作者</span><span>时间</span></div>
        <div v-for="a in assemblies" :key="a._id" class="trow">
          <span class="mono">{{ a._id }}</span>
          <span>{{ a.productId }}{{ a.spec ? '（' + a.spec + '）' : '' }}</span>
          <span class="r">{{ a.sets }}</span>
          <span class="muted">{{ a.operator }}</span>
          <span class="muted mono">{{ dateTime(a.at) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1160px;
}
.page-head {
  margin-bottom: 16px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ld-ink);
}
.sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
  margin-bottom: 10px;
}
.status.ok {
  color: var(--ld-green);
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
  margin-bottom: 16px;
}
@media (max-width: 940px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
.card,
.table-card {
  padding: 16px 18px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
h3 {
  margin: 12px 0 7px;
  font-size: 12px;
  color: var(--ld-purple-meta);
}
.card input,
.card select {
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 7px;
  background: var(--ld-bg);
}
.linerow {
  display: grid;
  grid-template-columns: 2fr 68px auto;
  gap: 6px;
  align-items: center;
}
.linerow input,
.linerow select {
  margin-bottom: 0;
}
.icon-x {
  width: 28px;
  height: 30px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 15px;
  cursor: pointer;
}
.icon-x:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0 2px;
  padding: 5px 12px;
  border: 1px dashed var(--ld-purple-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-brand-active);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.ops {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.btn-primary {
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn-ghost {
  padding: 8px 14px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.btn-warn {
  padding: 8px 16px;
  border: none;
  border-radius: 999px;
  background: var(--ld-red);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.prof-list {
  margin-top: 10px;
}
.prof-line {
  padding: 5px 0;
  border-top: 1px solid var(--ld-line);
  font-size: 11.5px;
  font-family: var(--ld-font-mono);
  color: var(--ld-content-2);
}
.preview {
  margin-top: 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  overflow: hidden;
}
.pv-head,
.pv-row {
  display: grid;
  grid-template-columns: 2fr 0.7fr 0.7fr 0.7fr;
  gap: 8px;
  padding: 7px 12px;
}
.pv-head {
  background: var(--ld-bg-lilac);
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.pv-row {
  border-top: 1px solid var(--ld-line);
  font-size: 12.5px;
  color: var(--ld-content);
}
.pv-row.short {
  color: var(--ld-red);
}
.table {
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.6fr 1.6fr 0.7fr 1.1fr 1.4fr;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
  color: var(--ld-content);
}
.r {
  text-align: right;
  justify-self: end;
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
}
.muted {
  color: var(--ld-content-2);
}
</style>
