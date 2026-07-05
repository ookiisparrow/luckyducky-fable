<script setup lang="ts">
// 外包账号（设计语言一致性·M3 UI 批11）：建号（口令只在建号请求用一次·库存哈希）/停启/企微 userid 绑定
// （免登用·全局唯一）。逻辑未动，仅套设计语言（页头/建号卡/grid 表/状态 chip/token）。
import { ref, onMounted } from 'vue'
import { listAgents, createAgent, disableAgent, setAgentWecomUserId } from '../api/system'
import { mapAgents, type AgentRow } from '../lib/mapSystem'

const rows = ref<AgentRow[]>([])
const message = ref('')
const busy = ref(false)
const form = ref({ name: '', key: '', wecomUserId: '' })
const confirmId = ref('')
const lastCreated = ref<{ name: string; key: string } | null>(null) // 建号后回显口令（换皮不回显·超管拿不到明文转交坐席）

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
    lastCreated.value = { name: form.value.name.trim(), key: form.value.key } // 回显供转交（系统只存哈希·这里回显你刚输的口令一次）
    form.value = { name: '', key: '', wecomUserId: '' }
    message.value = ''
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
  message.value = r.ok ? (row.disabled ? `已恢复 ${row.name}` : `已停用 ${row.name}（对方即刻登不了）`) : '操作失败：' + String(r.error || '')
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
  <div class="page">
    <header class="page-head">
      <h1>外包账号</h1>
      <p class="sub">外包坐席只有「接待」最小权限：能接会话、按已认领会话看客户资料（需客户同意），碰不到钱和商品。</p>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <div class="form-card">
      <input v-model="form.name" placeholder="名字（如 外包一号）" maxlength="40" />
      <input v-model="form.key" type="password" placeholder="登录口令（≥6 位）" />
      <input v-model="form.wecomUserId" placeholder="企微 userid（选填·免登用）" maxlength="64" />
      <button class="act primary" :disabled="busy" @click="doCreate">建号</button>
    </div>

    <div v-if="lastCreated" class="created-card">
      <div>已建号 <b>{{ lastCreated.name }}</b> · 登录口令（<b>只显示这一次</b>，抄给对方后关闭）：<code>{{ lastCreated.key }}</code></div>
      <button class="act small" @click="lastCreated = null">已抄下·关闭</button>
    </div>

    <div v-if="rows.length" class="table">
      <div class="thead">
        <span>名字</span><span>账号</span><span>企微绑定</span><span>建号时间</span><span>状态</span><span class="r">操作</span>
      </div>
      <div v-for="row in rows" :key="row.id" class="trow" :class="{ off: row.disabled }">
        <span class="name">{{ row.name }}</span>
        <span class="mono">{{ row.id }}</span>
        <div class="bind">
          <template v-if="editingId === row.id">
            <input v-model="editingVal" class="inline" placeholder="userid（空=解绑）" />
            <button class="act small" @click="bindWecom(row)">存</button>
          </template>
          <template v-else>
            <span class="bind-val">{{ row.wecomUserId || '—' }}</span>
            <button class="act ghost small" @click="bindWecom(row)">改绑</button>
          </template>
        </div>
        <span class="time">{{ row.createdAt }}</span>
        <span><span class="state" :class="row.disabled ? 'off' : 'on'">{{ row.disabled ? '已停用' : '正常' }}</span></span>
        <div class="r">
          <button class="act" :class="row.disabled ? 'ghost' : 'warn'" @click="toggle(row)">
            {{ row.disabled ? '恢复' : confirmId === row.id ? '确认停用？即时生效' : '停用' }}
          </button>
        </div>
      </div>
    </div>
    <p v-else-if="!message" class="status-soft">还没有外包账号</p>
  </div>
</template>

<style scoped>
.page {
  max-width: 1080px;
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
.status-soft {
  font-size: 13px;
  color: var(--ld-content-2);
}
.form-card {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 8px;
  padding: 16px;
  margin-bottom: 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  max-width: 820px;
}
.created-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  max-width: 820px;
  background: var(--ld-bg-green-soft);
  border: 1px solid var(--ld-green);
  border-radius: var(--ld-radius-l);
  font-size: 12.5px;
  color: var(--ld-content);
}
.created-card code {
  font-family: var(--ld-font-mono);
  font-weight: 700;
  color: var(--ld-ink);
  background: var(--ld-bg);
  padding: 2px 8px;
  border-radius: 6px;
}
.form-card input {
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
}
.table {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  overflow: hidden;
}
.thead,
.trow {
  display: grid;
  grid-template-columns: 1.2fr 1.4fr 1.6fr 1.2fr 0.9fr 1.4fr;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
}
.thead {
  background: var(--ld-bg-lilac);
  font-size: 12px;
  color: var(--ld-content-2);
}
.trow {
  border-top: 1px solid var(--ld-line);
  font-size: 13px;
}
.trow.off {
  opacity: 0.55;
}
.r {
  text-align: right;
  justify-self: end;
}
.name {
  font-weight: 600;
  color: var(--ld-ink);
}
.mono {
  font-family: var(--ld-font-mono);
  font-size: 12px;
  color: var(--ld-content-2);
}
.bind {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.bind-val {
  color: var(--ld-content);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline {
  width: 150px;
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 12.5px;
}
.time {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.state {
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 11.5px;
  white-space: nowrap;
}
.state.on {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.state.off {
  background: var(--ld-bg-faint);
  color: var(--ld-content-2);
}
.act {
  padding: 6px 13px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.act.primary {
  background: var(--ld-purple-ink);
}
.act.ghost {
  background: var(--ld-bg);
  color: var(--ld-content-2);
  border: 1px solid var(--ld-line);
}
.act.warn {
  background: var(--ld-red);
}
.act.small {
  padding: 4px 10px;
  font-size: 11px;
}
.act:disabled {
  opacity: 0.5;
}
</style>
