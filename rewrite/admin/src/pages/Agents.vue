<script setup lang="ts">
// 外包账号（M3 批6）：建号（口令只在建号请求用一次·库存哈希）/停启/企微 userid 绑定（免登用·全局唯一）。
import { ref, onMounted } from 'vue'
import { listAgents, createAgent, disableAgent, setAgentWecomUserId } from '../api/system'
import { mapAgents, type AgentRow } from '../lib/mapSystem'

const rows = ref<AgentRow[]>([])
const message = ref('')
const busy = ref(false)
const form = ref({ name: '', key: '', wecomUserId: '' })
const confirmId = ref('')

async function reload() {
  const r = await listAgents()
  rows.value = r.ok ? mapAgents(r.agents) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

async function doCreate() {
  if (busy.value) return
  if (!form.value.name.trim() || form.value.key.length < 6) {
    message.value = '名字必填，口令至少 6 位'
    return
  }
  busy.value = true
  const r = await createAgent(form.value.name.trim(), form.value.key, form.value.wecomUserId.trim() || undefined)
  busy.value = false
  if (r.ok) {
    form.value = { name: '', key: '', wecomUserId: '' }
    message.value = '已建号——把口令告诉对方（系统只存哈希·这里不再显示）'
    void reload()
  } else {
    const e = String(r.error || '')
    message.value = e === 'KEY_TAKEN' ? '这个口令已被占用（撞口令会串号）' : e === 'WECOM_ID_TAKEN' ? '这个企微 userid 已绑在别的账号' : '建号失败：' + e
  }
}

async function toggle(row: AgentRow) {
  if (!row.disabled && confirmId.value !== row.id) {
    confirmId.value = row.id // 停用两步确认（即时生效·对方连登录都不行）
    return
  }
  confirmId.value = ''
  const r = await disableAgent(row.id, !row.disabled)
  message.value = r.ok ? '' : '操作失败：' + String(r.error || '')
  void reload()
}

async function bindWecom(row: AgentRow) {
  const v = prompt2(row)
  if (v === null) return
  const r = await setAgentWecomUserId(row.id, v)
  message.value = r.ok ? '' : String(r.error) === 'WECOM_ID_TAKEN' ? '这个 userid 已绑在别的账号' : '绑定失败：' + String(r.error || '')
  void reload()
}
// 简易输入（no-alert 纪律下用内联输入更好·此处低频操作用行内编辑）
const editingId = ref('')
const editingVal = ref('')
function prompt2(row: AgentRow): string | null {
  if (editingId.value !== row.id) {
    editingId.value = row.id
    editingVal.value = row.wecomUserId
    return null
  }
  editingId.value = ''
  return editingVal.value.trim()
}

onMounted(reload)
</script>

<template>
  <div>
    <h2>外包账号</h2>
    <p class="hint">外包坐席只有「接待」最小权限：能接会话、按已认领会话看客户资料（需客户同意），碰不到钱和商品。</p>
    <p v-if="message" class="status">{{ message }}</p>

    <div class="panel form">
      <input v-model="form.name" placeholder="名字（如 外包一号）" maxlength="40" />
      <input v-model="form.key" type="password" placeholder="登录口令（≥6 位）" />
      <input v-model="form.wecomUserId" placeholder="企微 userid（选填·免登用）" maxlength="64" />
      <button class="act" :disabled="busy" @click="doCreate">建号</button>
    </div>

    <table v-if="rows.length">
      <thead><tr><th>名字</th><th>账号</th><th>企微绑定</th><th>建号时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ off: row.disabled }">
          <td>{{ row.name }}</td>
          <td class="mono">{{ row.id }}</td>
          <td>
            <template v-if="editingId === row.id">
              <input v-model="editingVal" class="inline" placeholder="userid（空=解绑）" />
              <button class="act small" @click="bindWecom(row)">存</button>
            </template>
            <template v-else>
              {{ row.wecomUserId || '—' }}
              <button class="act ghost small" @click="bindWecom(row)">改绑</button>
            </template>
          </td>
          <td>{{ row.createdAt }}</td>
          <td>{{ row.disabled ? '已停用' : '正常' }}</td>
          <td>
            <button class="act" :class="{ warn: !row.disabled }" @click="toggle(row)">
              {{ row.disabled ? '恢复' : confirmId === row.id ? '确认停用？即时生效' : '停用' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!message" class="hint">还没有外包账号</p>
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
  margin: 0 0 12px;
}
.status {
  font-size: 13px;
  color: #c0392b;
  margin-bottom: 10px;
}
.panel.form {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 8px;
  padding: 14px 16px;
  margin-bottom: 14px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  max-width: 760px;
}
input {
  padding: 7px 10px;
  border: 1px solid var(--ld-purple-line);
  border-radius: 8px;
  font-size: 13px;
}
input.inline {
  width: 160px;
}
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--ld-bg);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  overflow: hidden;
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
tr.off {
  opacity: 0.55;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.act {
  padding: 5px 14px;
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
  background: #c0392b;
}
.act.small {
  padding: 3px 10px;
  font-size: 11px;
}
.act:disabled {
  opacity: 0.5;
}
</style>
