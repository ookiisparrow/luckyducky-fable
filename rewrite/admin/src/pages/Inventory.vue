<script setup lang="ts">
// 库存（M3 批6）：SKU 列表（分页取齐·触顶如实标）+ 版本校验保存（409 冲突=顾客下单占用·拒覆盖人话）。
import { ref, onMounted } from 'vue'
import { listInventory, saveStock } from '../api/system'
import { mapStock, stockErrorText, type StockRow } from '../lib/mapSystem'

const rows = ref<StockRow[]>([])
const truncNote = ref('')
const message = ref('')
const editKey = ref('')
const editVal = ref('')

async function reload() {
  const r = await listInventory()
  const m = mapStock(r.ok ? r.list : [], r.ok ? r.truncated : false)
  rows.value = m.rows
  truncNote.value = m.truncNote
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function startEdit(row: StockRow) {
  editKey.value = row.key
  editVal.value = row.stock == null ? '' : String(row.stock)
}

async function doSave(row: StockRow) {
  const v = editVal.value.trim()
  const stock = v === '' ? null : Number(v)
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
    message.value = '库存数须为非负整数，或留空表示不限量'
    return
  }
  const r = await saveStock(row.productId, row.spec, stock, row.updatedAt) // 带版本·被人先改过会 409
  if (r.ok) {
    editKey.value = ''
    message.value = ''
  } else {
    message.value = stockErrorText(r.error, r.status)
  }
  void reload()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>实物库存</h2>
    <p class="hint">留空 = 不限量（缺货前不拦下单）。下单即预留：顾客拍下就占库存，超时关单自动回补。</p>
    <p v-if="truncNote" class="warn-note">{{ truncNote }}</p>
    <p v-if="message" class="status">{{ message }}</p>

    <table v-if="rows.length">
      <thead><tr><th>商品</th><th>规格</th><th>库存</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key">
          <td class="mono">{{ row.productId }}</td>
          <td>{{ row.spec || '—' }}</td>
          <td>
            <template v-if="editKey === row.key">
              <input v-model="editVal" class="stockin" placeholder="空=不限量" />
            </template>
            <template v-else>{{ row.stockLabel }}</template>
          </td>
          <td>
            <button v-if="editKey !== row.key" class="act ghost" @click="startEdit(row)">改</button>
            <template v-else>
              <button class="act" @click="doSave(row)">保存</button>
              <button class="act ghost" @click="editKey = ''">取消</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!message" class="hint">还没有库存档（不限量商品无档是正常的）</p>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 8px;
  color: var(--ld-purple-ink);
}
.hint {
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin: 0 0 10px;
}
.warn-note {
  font-size: 12px;
  color: var(--ld-amber);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
  max-width: 720px;
}
th,
td {
  padding: 10px 12px;
  font-size: 13px;
  text-align: left;
  border-bottom: 1px solid var(--ld-bg-faint);
}
th {
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-meta);
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.stockin {
  width: 110px;
  padding: 6px 8px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
}
.act {
  padding: 5px 14px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  margin-right: 4px;
}
.act.ghost {
  background: transparent;
  color: var(--ld-purple-meta);
  border: 1px solid var(--ld-purple-line);
}
</style>
