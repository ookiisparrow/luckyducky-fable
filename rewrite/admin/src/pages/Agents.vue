<script setup lang="ts">
// 外包账号（设计语言一致性·M3 UI 批11）：建号（口令只在建号请求用一次·库存哈希）/停启/企微 userid 绑定
// （免登用·全局唯一）。逻辑未动，仅套设计语言（页头/建号卡/grid 表/状态 chip/token）。
import { ref, onMounted } from 'vue'
import { listAgents, createAgent, disableAgent, setAgentWecomUserId } from '../api/system'
import { mapAgents, type AgentRow } from '../lib/mapSystem'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { Headset } from 'lucide-vue-next'

const rows = ref<AgentRow[]>([])
const message = ref('')
const busy = ref(false)
const form = ref({ name: '', key: '', wecomUserId: '' })
const confirmId = ref('')
const lastCreated = ref<{ name: string; key: string } | null>(null) // 建号后回显口令（换皮不回显·超管拿不到明文转交坐席）

async function reload() {
  confirmId.value = '' // 刷新即复位危险态（P1·防旧武装的停用确认残留、重进同一行一击直发·批3 规格）
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
  <div class="ld-page">
    <PageHeader
      title="外包账号"
      sub="外包坐席只有「接待」最小权限：能接会话、按已认领会话看客户资料（需客户同意），碰不到钱和商品。"
    />

    <p v-if="message" class="ld-status is-err">{{ message }}</p>

    <Card title="建外包账号" sub="登录口令只在建号这一次用到（系统只存哈希·超管拿不到明文）">
      <div class="form-grid">
        <input v-model="form.name" class="field" placeholder="名字（如 外包一号）" maxlength="40" />
        <input v-model="form.key" class="field" type="password" placeholder="登录口令（≥6 位）" />
        <input v-model="form.wecomUserId" class="field" placeholder="企微 userid（选填·免登用）" maxlength="64" />
        <UiButton size="sm" :disabled="busy" @click="doCreate">建号</UiButton>
      </div>
    </Card>

    <div v-if="lastCreated" class="secret">
      <div class="secret-body">
        已建号 <b>{{ lastCreated.name }}</b> · 登录口令（<b>只显示这一次</b>，抄给对方后关闭）：<code>{{ lastCreated.key }}</code>
      </div>
      <UiButton variant="ghost" size="sm" @click="lastCreated = null">已抄下 · 关闭</UiButton>
    </div>

    <div v-if="rows.length" class="ld-table">
      <div class="ld-thead">
        <div class="ld-th grow">名字</div>
        <div class="ld-th" :style="{ width: '190px' }">账号</div>
        <div class="ld-th" :style="{ width: '240px' }">企微绑定</div>
        <div class="ld-th" :style="{ width: '160px' }">建号时间</div>
        <div class="ld-th" :style="{ width: '96px' }">状态</div>
        <div class="ld-th ops-cell" :style="{ width: '180px' }">操作</div>
      </div>
      <div class="ld-tbody">
        <div v-for="row in rows" :key="row.id" class="ld-tr" :class="{ off: row.disabled }">
          <div class="ld-td grow"><span class="name">{{ row.name }}</span></div>
          <div class="ld-td" :style="{ width: '190px' }"><span class="mono">{{ row.id }}</span></div>
          <div class="ld-td bind" :style="{ width: '240px' }">
            <template v-if="editingId === row.id">
              <input v-model="editingVal" class="inline-in" placeholder="userid（空=解绑）" />
              <UiButton size="sm" @click="bindWecom(row)">存</UiButton>
            </template>
            <template v-else>
              <span class="bind-val">{{ row.wecomUserId || '—' }}</span>
              <UiButton variant="ghost" size="sm" @click="bindWecom(row)">改绑</UiButton>
            </template>
          </div>
          <div class="ld-td muted mono" :style="{ width: '160px' }">{{ row.createdAt }}</div>
          <div class="ld-td" :style="{ width: '96px' }">
            <Badge :tone="row.disabled ? 'neutral' : 'green'" dot>{{ row.disabled ? '已停用' : '正常' }}</Badge>
          </div>
          <div class="ld-td ops-cell" :style="{ width: '180px' }">
            <UiButton :variant="row.disabled ? 'ghost' : 'danger'" size="sm" @click="toggle(row)">
              {{ row.disabled ? '恢复' : confirmId === row.id ? '确认停用？即时生效' : '停用' }}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
    <EmptyState v-else-if="!message" :icon="Headset" text="还没有外包账号" />
  </div>
</template>

<style scoped>
/* 本页独有：建号表单栅格 · 一次性口令回显卡（绿·抄后关闭）· 企微绑定内联编辑输入 · 表格单元辅助。
 * 页头/卡/徽章/空态/按钮/表格骨架/状态行已交共享原语（PageHeader/Card/Badge/EmptyState/UiButton/.ld-table/.ld-status）。 */
.is-err {
  color: var(--ld-red);
}

/* 建号表单：三字段 + 建号按钮一行（窄屏交由栅格自然换行·kit 无表单原语） */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 10px;
  align-items: center;
}
.field {
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-size: 13px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

/* 一次性口令回显（绿·成功语气·抄给对方后关闭·系统只存哈希） */
.secret {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--ld-bg-green-soft);
  border: 1px solid var(--ld-green);
  border-radius: var(--ld-radius);
  font-size: 12.5px;
  color: var(--ld-content);
}
.secret-body {
  min-width: 0;
}
.secret code {
  font-family: var(--ld-font-mono);
  font-weight: 700;
  color: var(--ld-ink);
  background: var(--ld-bg);
  padding: 2px 8px;
  border-radius: var(--ld-radius-sm);
}

/* 表格单元辅助 */
.ld-tr.off {
  opacity: 0.55;
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
.muted {
  color: var(--ld-content-2);
  font-size: 12.5px;
}
.bind {
  gap: 8px;
}
.bind-val {
  flex: 1;
  color: var(--ld-content);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-in {
  width: 150px;
  padding: 6px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.ops-cell {
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
