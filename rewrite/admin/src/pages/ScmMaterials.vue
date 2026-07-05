<script setup lang="ts">
// 物料与供应商（设计语言一致性·M3 UI 批16）：主档（毛线按 色×档×形态 推导料号·计量建档锁死）+ 供应商/织女
// + 库存调整（必留原因·扣超整单拒）+ 流水查账。逻辑未动，仅套设计语言（页头/表单卡/grid 表/token）。
import { ref, onMounted } from 'vue'
import { listMaterials, saveMaterial, listSuppliers, saveSupplier, adjustStock, listLedger } from '../api/scm'
import { materialHuman, uomLabel, scmErrorText, mapLedger, type LedgerRow } from '../lib/mapScm'
import { dateTime } from '../lib/format'

const mats = ref<Array<Record<string, any>>>([])
const sups = ref<Array<Record<string, any>>>([])
const ledger = ref<LedgerRow[]>([])
const message = ref('')

const matForm = ref({ category: 'yarn', name: '', uom: 'count', color: '', tier: 'L', form: 'raw', productId: '', slug: '', supplierId: '', threshold: 0 })
const supForm = ref({ name: '', type: 'factory', contact: '' })
const adj = ref({ materialId: '', delta: 0, reason: '' })

async function reload() {
  const [m, s, l] = await Promise.all([listMaterials(), listSuppliers(), listLedger()])
  mats.value = m.ok ? (m.list as Record<string, any>[]) : []
  sups.value = s.ok ? (s.list as Record<string, any>[]) : []
  ledger.value = l.ok ? mapLedger(l.list) : []
  message.value = m.ok ? '' : '加载失败：' + String(m.error || '')
}

async function doSaveMaterial() {
  const r = await saveMaterial({ ...matForm.value })
  message.value = r.ok ? `已建档：${String(r.materialId)}` : scmErrorText(r.error)
  void reload()
}

async function doSaveSupplier() {
  const r = await saveSupplier({ ...supForm.value })
  message.value = r.ok ? '供应商已保存' : scmErrorText(r.error)
  void reload()
}

async function doAdjust() {
  const r = await adjustStock(adj.value.materialId, Number(adj.value.delta), adj.value.reason.trim())
  message.value = r.ok ? '已调整并留流水' : scmErrorText(r.error)
  void reload()
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>物料与供应商</h1>
      <p class="sub">物料主档（毛线料号按 色×档×形态 推导·计量建档后锁死）+ 供应商/织女 + 库存调整（必留原因）。</p>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <div class="cols">
      <section class="card">
        <h2>建物料档</h2>
        <select v-model="matForm.category">
          <option value="yarn">毛线</option>
          <option value="packaging">包装（挂产品）</option>
          <option value="card">卡片（挂产品）</option>
          <option value="accessory">辅料</option>
        </select>
        <input v-model="matForm.name" placeholder="名称" maxlength="60" />
        <select v-model="matForm.uom"><option value="count">按件</option><option value="gram">按克</option></select>
        <template v-if="matForm.category === 'yarn'">
          <input v-model="matForm.color" placeholder="颜色（小写英文如 pink）" />
          <select v-model="matForm.tier"><option value="L">大团</option><option value="M">中团</option><option value="S">小团</option></select>
          <select v-model="matForm.form"><option value="raw">原团</option><option value="knotted">带结（仅大团）</option></select>
        </template>
        <input v-else-if="matForm.category !== 'accessory'" v-model="matForm.productId" placeholder="所属产品 id" />
        <input v-else v-model="matForm.slug" placeholder="辅料名（小写英文）" />
        <select v-model="matForm.supplierId">
          <option value="">（不挂供应商）</option>
          <option v-for="s in sups" :key="s._id" :value="s._id">{{ s.name }}</option>
        </select>
        <input v-model.number="matForm.threshold" type="number" min="0" placeholder="安全库存阈值（低于报警·0=不报警）" />
        <button class="btn-primary" @click="doSaveMaterial">建档 / 更新</button>
        <p class="hint">计量方式建档后锁死；毛线料号按 颜色×档位×形态 自动生成。安全库存阈值＝低于此值列表标红报警（B4：换皮漏了这个输入·恒 0 致低库存告警失效）。</p>
      </section>

      <section class="card">
        <h2>供应商 / 织女</h2>
        <input v-model="supForm.name" placeholder="名称" maxlength="60" />
        <select v-model="supForm.type"><option value="factory">厂家（可下采购单）</option><option value="outworker">织女（走外协单）</option></select>
        <input v-model="supForm.contact" placeholder="联系方式" maxlength="120" />
        <button class="btn-primary" @click="doSaveSupplier">保存</button>
        <div class="sup-list">
          <div v-for="s in sups" :key="s._id" class="sup-line">
            <span>{{ s.name }}</span>
            <span class="tag">{{ s.type === 'factory' ? '厂家' : '织女' }}</span>
          </div>
        </div>
      </section>

      <section class="card">
        <h2>库存调整（必留原因）</h2>
        <select v-model="adj.materialId">
          <option value="">选料号…</option>
          <option v-for="m in mats" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（现 {{ m.stock }}）</option>
        </select>
        <input v-model.number="adj.delta" type="number" placeholder="±整数（克/件）" />
        <input v-model="adj.reason" placeholder="原因（如 期初盘点）" maxlength="200" />
        <button class="btn-primary" @click="doAdjust">调整</button>
      </section>
    </div>

    <section class="table-card">
      <h2>物料主档（{{ mats.length }}）</h2>
      <div class="table">
        <div class="thead thead-mat"><span>料号</span><span>名称</span><span>计量</span><span class="r">库存</span><span>供应商</span></div>
        <div v-for="m in mats" :key="m._id" class="trow trow-mat">
          <div><div class="human">{{ materialHuman(m._id) }}</div><div class="mono">{{ m._id }}</div></div>
          <span>{{ m.name }}</span>
          <span class="muted">{{ uomLabel(m.uom) }}</span>
          <span class="r" :class="{ low: m.threshold && m.stock <= m.threshold }">{{ m.stock }}</span>
          <span class="muted">{{ (sups.find((s) => s._id === m.supplierId) || {}).name || '—' }}</span>
        </div>
      </div>
    </section>

    <section class="table-card">
      <h2>最近流水</h2>
      <div class="table">
        <div class="thead thead-led"><span>时间</span><span>类型</span><span>料</span><span class="r">±</span><span>操作者</span><span>原因</span></div>
        <div v-for="l in ledger" :key="l.id" class="trow trow-led">
          <span class="muted mono">{{ dateTime(l.at) }}</span>
          <span>{{ l.docType }}</span>
          <span>{{ l.material }}</span>
          <span class="r" :class="l.delta > 0 ? 'pos' : 'neg'">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</span>
          <span class="muted">{{ l.operator }}</span>
          <span class="muted">{{ l.reason || '—' }}</span>
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
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
  margin-bottom: 16px;
}
@media (max-width: 900px) {
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
.table-card {
  margin-bottom: 14px;
}
h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
.card input,
.card select {
  display: block;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
  background: var(--ld-bg);
}
.btn-primary {
  padding: 8px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--ld-content-2);
}
.sup-list {
  margin-top: 10px;
}
.sup-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
  color: var(--ld-content);
}
.tag {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 11px;
}
.table {
  border: 1px solid var(--ld-line);
  border-radius: 10px;
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
.thead-mat,
.trow-mat {
  grid-template-columns: 1.6fr 1.4fr 0.8fr 0.8fr 1.2fr;
}
.thead-led,
.trow-led {
  grid-template-columns: 1.4fr 0.9fr 1.2fr 0.7fr 1fr 1.4fr;
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
.human {
  color: var(--ld-ink);
  font-weight: 600;
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 11px;
  color: var(--ld-content-2);
}
.muted {
  color: var(--ld-content-2);
}
.low {
  color: var(--ld-red);
  font-weight: 700;
}
.pos {
  color: var(--ld-green);
  font-weight: 600;
}
.neg {
  color: var(--ld-red);
  font-weight: 600;
}
</style>
