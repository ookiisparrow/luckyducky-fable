<script setup lang="ts">
// 物料与供应商（M3 批7）：主档（毛线按 色×档×形态 推导料号·计量建档锁死）+ 供应商/织女 +
// 库存调整（必留原因·扣超整单拒）+ 流水查账。
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
  <div>
    <h2>物料与供应商</h2>
    <p v-if="message" class="status">{{ message }}</p>

    <div class="cols">
      <div class="panel">
        <h3>建物料档</h3>
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
        <button class="act" @click="doSaveMaterial">建档/更新</button>
        <p class="hint">计量方式建档后锁死；毛线料号按 颜色×档位×形态 自动生成。</p>
      </div>

      <div class="panel">
        <h3>供应商 / 织女</h3>
        <input v-model="supForm.name" placeholder="名称" maxlength="60" />
        <select v-model="supForm.type"><option value="factory">厂家（可下采购单）</option><option value="outworker">织女（走外协单）</option></select>
        <input v-model="supForm.contact" placeholder="联系方式" maxlength="120" />
        <button class="act" @click="doSaveSupplier">保存</button>
        <p v-for="s in sups" :key="s._id" class="row-line">{{ s.name }} · {{ s.type === 'factory' ? '厂家' : '织女' }}</p>
      </div>

      <div class="panel">
        <h3>库存调整（必留原因）</h3>
        <select v-model="adj.materialId">
          <option value="">选料号…</option>
          <option v-for="m in mats" :key="m._id" :value="m._id">{{ materialHuman(m._id) }}（现 {{ m.stock }}）</option>
        </select>
        <input v-model.number="adj.delta" type="number" placeholder="±整数（克/件）" />
        <input v-model="adj.reason" placeholder="原因（如 期初盘点）" maxlength="200" />
        <button class="act" @click="doAdjust">调整</button>
      </div>
    </div>

    <div class="panel">
      <h3>物料主档（{{ mats.length }}）</h3>
      <table>
        <thead><tr><th>料号</th><th>名称</th><th>计量</th><th>库存</th><th>供应商</th></tr></thead>
        <tbody>
          <tr v-for="m in mats" :key="m._id">
            <td>{{ materialHuman(m._id) }}<div class="mono">{{ m._id }}</div></td>
            <td>{{ m.name }}</td>
            <td>{{ uomLabel(m.uom) }}</td>
            <td :class="{ low: m.threshold && m.stock <= m.threshold }">{{ m.stock }}</td>
            <td>{{ (sups.find((s) => s._id === m.supplierId) || {}).name || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h3>最近流水</h3>
      <table>
        <thead><tr><th>时间</th><th>类型</th><th>料</th><th>±</th><th>操作者</th><th>原因</th></tr></thead>
        <tbody>
          <tr v-for="l in ledger" :key="l.id">
            <td>{{ dateTime(l.at) }}</td><td>{{ l.docType }}</td><td>{{ l.material }}</td>
            <td :class="l.delta > 0 ? 'pos' : 'neg'">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</td>
            <td>{{ l.operator }}</td><td>{{ l.reason || '—' }}</td>
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
  margin-bottom: 12px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
}
.panel input,
.panel select {
  display: block;
  width: 100%;
  padding: 7px 10px;
  margin-bottom: 8px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
  box-sizing: border-box;
}
.hint {
  font-size: 11px;
  color: var(--ld-purple-meta);
  margin-top: 8px;
}
.row-line {
  font-size: 13px;
  margin: 4px 0;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 8px 10px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  color: var(--ld-purple-meta);
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--ld-purple-meta);
}
.low {
  color: var(--ld-red);
  font-weight: 700;
}
.pos {
  color: var(--ld-green);
}
.neg {
  color: var(--ld-red);
}
.act {
  padding: 7px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
</style>
