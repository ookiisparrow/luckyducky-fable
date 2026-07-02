<script setup>
/**
 * 外包账号管理（后台360工作站 B5.2·承面C 车道 C·商户超管建/停/列外包坐席账号）。
 * - 外包账号 = adminConfig 里 role='outsourced' 的多账号：以「登录口令」认身份（keyHash 入库·不存明文），
 *   disabled 停用即刻无法登录。外包最小权（ROLES.outsourced·caps 由 role 派生·不含 '*'）。
 * - 本页仅商户超管可用（未登记 ACTION_CAPS 默认拒·外包自身无权建/停账号·守卫 agent-rbac-gated）。
 * - 口令只在创建时展示一次给你转交外包坐席，之后不再回显（后端不回明文·白名单只回 id/name/role/disabled）。
 */
import { ref } from 'vue'
import { cloudMode, listAgents, createAgent, setAgentDisabled, setAgentWecomUserId } from '@/api/cloud.js'
import { confirmDialog, promptDialog, toast } from '@/utils/ui.js'

const agents = ref([])
const loading = ref(false)
const loadErr = ref('')
const creating = ref(false)
const newName = ref('')
const newKey = ref('')
const newWecomId = ref('')
const lastCreated = ref(null) // { name, key } 创建后一次性展示口令，供转交外包

async function load() {
  if (!cloudMode) return
  loading.value = true
  loadErr.value = ''
  try {
    agents.value = await listAgents()
  } catch (e) {
    loadErr.value = '账号加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
load()

async function create() {
  if (creating.value) return
  const name = newName.value.trim()
  const key = newKey.value
  if (!name) return toast('请填写账号名称', 'err')
  if (key.length < 6) return toast('登录口令至少 6 位', 'err')
  creating.value = true
  try {
    const agent = await createAgent(name, key, newWecomId.value.trim())
    lastCreated.value = { name: agent.name, key } // 一次性展示口令（后端不再回显）
    newName.value = ''
    newKey.value = ''
    newWecomId.value = ''
    await load()
    toast('已创建 ✓，请把登录口令转交该外包坐席', 'ok')
  } catch (e) {
    toast(e.message, 'err')
  } finally {
    creating.value = false
  }
}

// 回填/改绑企微 userid（免登用）：promptDialog 取值·空串=解绑·唯一性由后端校验
async function editWecomId(a) {
  const next = await promptDialog({
    title: '绑定企业微信 userid',
    message: `「${a.name}」的企业微信 userid（用于企微内免登；留空=解绑）`,
    defaultValue: a.wecomUserId || '',
    placeholder: '如 LiSi（企业微信通讯录里的成员账号）',
  })
  if (next === null) return // 取消
  const val = next.trim()
  if (val === (a.wecomUserId || '')) return // 未改
  try {
    await setAgentWecomUserId(a.id, val)
    a.wecomUserId = val
    toast(val ? '已绑定企微 userid ✓' : '已解绑', 'ok')
  } catch (e) {
    toast(e.message, 'err')
  }
}

async function toggle(a) {
  const next = !a.disabled
  const ok = await confirmDialog({
    title: next ? '停用账号' : '恢复账号',
    message: next ? `停用「${a.name}」？停用后该账号即刻无法登录。` : `恢复「${a.name}」的登录权限？`,
    confirmText: next ? '停用' : '恢复',
    danger: next,
  })
  if (!ok) return
  try {
    await setAgentDisabled(a.id, next)
    a.disabled = next
    toast(next ? '已停用' : '已恢复', 'ok')
  } catch (e) {
    toast(e.message, 'err')
  }
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div>
    <div class="headrow">
      <div>
        <h2>外包账号</h2>
        <p class="desc">
          为外包/第三方客服坐席建立独立登录账号（最小权：只可查会话 + 回复 + 升级·不可动钱/改状态/退款）。
          账号以登录口令认身份，停用即刻失效。外包坐席看客户数据受「分配 scope + 数据共享告知同意」双重约束。
        </p>
      </div>
    </div>

    <p v-if="!cloudMode" class="hint warn">外包账号管理需云端模式（配置 admin/.env.local 的 VITE_ADMIN_API）。</p>
    <template v-else>
      <!-- 建号 -->
      <div class="create">
        <input v-model="newName" class="inp" placeholder="账号名称（如「客服-小李」·审计留痕用）" />
        <input v-model="newKey" class="inp" type="text" placeholder="登录口令（≥6 位·转交该坐席）" />
        <input v-model="newWecomId" class="inp" type="text" placeholder="企微 userid（可选·免登用·可后补）" />
        <button class="add" :disabled="creating" @click="create">{{ creating ? '创建中…' : '＋ 建外包账号' }}</button>
      </div>
      <p v-if="lastCreated" class="hint ok">
        已创建「{{ lastCreated.name }}」，登录口令：<b>{{ lastCreated.key }}</b>
        —— 请立刻转交该外包坐席，本口令仅此一次展示，之后不再回显。
      </p>

      <!-- 列表 -->
      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading" class="hint">加载中…</p>
      <template v-else>
        <p v-if="!agents.length" class="hint">还没有外包账号。上面填名称 + 口令即可建第一个。</p>
        <table v-else class="tbl">
          <thead>
            <tr><th>名称</th><th>角色</th><th>企微免登</th><th>创建于</th><th>状态</th><th class="ta-r">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="a in agents" :key="a.id" :class="{ off: a.disabled }">
              <td>{{ a.name || '（未命名）' }}</td>
              <td><span class="role">外包坐席</span></td>
              <td>
                <button class="wecom" :class="{ unbound: !a.wecomUserId }" @click="editWecomId(a)">
                  {{ a.wecomUserId || '＋ 绑定' }}
                </button>
              </td>
              <td class="meta">{{ fmtDate(a.createdAt) }}</td>
              <td>
                <span class="badge" :class="a.disabled ? 'b-off' : 'b-on'">{{ a.disabled ? '已停用' : '启用中' }}</span>
              </td>
              <td class="ta-r">
                <button class="mini" :class="{ danger: !a.disabled }" @click="toggle(a)">
                  {{ a.disabled ? '恢复' : '停用' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </div>
</template>

<style scoped>
.headrow {
  margin-bottom: 12px;
}
h2 {
  font-size: 16.5px;
  color: var(--ink);
  margin: 0 0 4px;
}
.desc {
  font-size: 12px;
  color: var(--content-2);
  margin: 0;
  line-height: 1.6;
}
.create {
  display: flex;
  gap: 10px;
  margin: 6px 0 12px;
}
.inp {
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 9px 12px;
  font-size: 13px;
  font-family: inherit;
  background: var(--white);
  color: var(--ink);
  flex: 1;
  outline: none;
}
.inp:focus {
  border-color: var(--brand);
}
.add {
  border: 1px solid var(--purple-line);
  background: var(--bg-lilac);
  color: var(--brand-active);
  font-size: 13px;
  font-weight: 600;
  border-radius: 9px;
  padding: 9px 18px;
  cursor: pointer;
  flex: 0 0 auto;
}
.add:disabled {
  opacity: 0.5;
  cursor: default;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th {
  text-align: left;
  font-size: 11px;
  color: var(--purple-meta);
  font-weight: 600;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}
.tbl td {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
}
.tbl tr.off td {
  opacity: 0.55;
}
.ta-r {
  text-align: right;
}
.meta {
  color: var(--content-2);
  font-size: 12px;
}
.role {
  font-size: 12px;
  color: var(--content-2);
}
.wecom {
  border: 1px solid var(--line);
  background: var(--white);
  font-size: 12px;
  font-family: inherit;
  color: var(--ink);
  border-radius: 7px;
  padding: 4px 10px;
  cursor: pointer;
}
.wecom.unbound {
  color: var(--purple-meta);
  border-style: dashed;
}
.wecom:hover {
  border-color: var(--brand);
}
.badge {
  font-size: 11px;
  border-radius: 6px;
  padding: 2px 8px;
}
.b-on {
  background: var(--bg-sage);
  color: #2f7a4d;
}
.b-off {
  background: var(--bg-grey);
  color: var(--content-2);
}
.mini {
  border: 1px solid var(--line);
  background: var(--white);
  font-size: 12px;
  color: var(--content-2);
  border-radius: 7px;
  padding: 5px 12px;
  cursor: pointer;
}
.mini.danger:hover {
  color: var(--red);
  border-color: #f0c8c5;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 6px 0 14px;
  line-height: 1.6;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
.hint.ok {
  border-color: #bfe3cd;
  background: #f0f9f3;
  color: #2f7a4d;
}
</style>
