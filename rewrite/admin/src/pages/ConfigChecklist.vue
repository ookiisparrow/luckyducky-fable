<script setup lang="ts">
// 人工配置清单（批 B9·设计契约：TopBar chip + 说明 banner + 单卡分组表；批 B10 升级：可填写保存）：
// 把散落在云函数环境变量 / admin 页内 DB 字段 / 纯人工外部后台项 / 资产正册的散落配置拼一屏「配了没」
// （条数以后端 groups 动态计·不手抄——客观计数纪律，权威断言在 config-checklist.test.ts）。
// 只读探测铁律不变（getConfigChecklist 响应从不回显任何已存密钥/配置真实值·只回 status 布尔态）；
// 后端新增 saveSecureConfig / savePayConfig 后，带 fill 元数据的项可直接在本页填写保存、免重新部署
// （守卫 rewrite/cloud/tests/config-checklist.test.ts）。前端按 item.fill 通用驱动渲染/提交，
// 不硬编码具体字段名——以后端 fill 有无 / inputType 决定怎么画、怎么交。
import { ref, computed, onMounted } from 'vue'
import { ShieldCheck, RefreshCw } from 'lucide-vue-next'
import { getConfigChecklist, saveSecureConfig, savePayConfig } from '../api/system'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import UiButton from '../components/ui/Button.vue'
import EmptyState from '../components/ui/EmptyState.vue'

type Status = 'ok' | 'missing' | 'check'
interface FillMeta {
  action: 'saveSecureConfig' | 'savePayConfig'
  docId?: 'wxkf' | 'wxpay'
  field: string
  inputType: 'text' | 'password' | 'textarea' | 'select'
  options?: { value: string; label: string }[]
}
interface Item {
  key: string
  name: string
  location: string
  purpose: string
  status: Status
  howTo: string
  url: string
  noteExtra?: string
  fill?: FillMeta
}
interface Group {
  group: string
  items: Item[]
}
interface FillState {
  value: string // 永远从空白起（零回显铁律·从不用已存值预填）
  busy: boolean
  error: string
}

const groups = ref<Group[]>([])
const message = ref('加载中…')
const loading = ref(false)
const fillState = ref<Record<string, FillState>>({})

const toneOf = (s: Status) => (s === 'ok' ? 'green' : s === 'missing' ? 'red' : 'amber')
const labelOf = (s: Status) => (s === 'ok' ? '已配' : s === 'missing' ? '未配' : '需人工核对')

const totalItems = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
// 全局保存锁：任一项保存在途时全部保存按钮禁用——防先返回的整页 load() 重建 fillState 时，
// 另一在途项的 busy 态被清、输入框复通造成二次提交/态错乱（审查批·frontend finding）
const anyBusy = computed(() => Object.values(fillState.value).some((s) => s.busy))

// 后端定型错误码 → 人话（非技术用户直读；未映射的原样带出便于排障）
function errText(code: string): string {
  if (code.startsWith('TOO_LONG:')) return `内容超长（${code.slice('TOO_LONG:'.length)} 字段有长度上限），请核对后重填`
  const map: Record<string, string> = {
    BAD_AESKEY_LEN: 'EncodingAESKey 必须是 43 位字符，请从后台完整复制后重填',
    BAD_MODE: '支付模式只能选 real 或 mock',
    BAD_DOC: '配置项标识不合法（请刷新页面后重试）',
    NO_FIELDS: '没有可保存的内容（留空提交不改动任何字段）',
  }
  return map[code] || `保存失败：${code || '未知错误'}`
}

async function load() {
  loading.value = true
  const r: any = await getConfigChecklist()
  loading.value = false
  if (r.error === 'SESSION_LOST') return // 会话失效集中导登录（client.onSessionLost·单源·根因#5）
  if (!r.ok) {
    message.value = '加载失败：' + String(r.error || '')
    return
  }
  groups.value = (r.groups || []) as Group[]
  // 每次载入（含保存成功后的整页刷新）都重建填写态：所有可填项恒空白起——响应从不带回真实值，
  // 这里也绝不该拿旧输入去预填，避免误以为"已回显"。
  const nextFill: Record<string, FillState> = {}
  for (const g of groups.value) {
    for (const it of g.items) {
      if (it.fill) nextFill[it.key] = { value: '', busy: false, error: '' }
    }
  }
  fillState.value = nextFill
  message.value = ''
}

function canSubmit(it: Item): boolean {
  const s = fillState.value[it.key]
  return !!s && !anyBusy.value && s.value.trim().length > 0
}

async function submitFill(it: Item) {
  const f = it.fill
  if (!f || anyBusy.value) return // 全局锁：在途保存未归前不受理第二笔
  const s = fillState.value[it.key]
  const value = s ? s.value.trim() : ''
  if (!value) return
  fillState.value[it.key] = { value: s.value, busy: true, error: '' }
  const r: any = f.action === 'saveSecureConfig' ? await saveSecureConfig(f.docId || '', { [f.field]: value }) : await savePayConfig({ [f.field]: value })
  if (r.error === 'SESSION_LOST') return // 集中导登录（同上）
  if (r.ok) {
    await load() // 整页刷新：拿到最新 status + 全部填写态清空（更简单可靠，优先选它）
    message.value = '已保存'
  } else {
    fillState.value[it.key] = { value: s.value, busy: false, error: errText(String(r.error || '')) }
  }
}

onMounted(load)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="人工配置清单" :sub="`${totalItems || '…'} 项散落配置一屏「配了没」 · 探不到的（企微/微信客服/小程序后台）恒需人工核对`">
      <Badge tone="neutral" dot>零回显 · 只回状态不回密钥</Badge>
      <UiButton variant="ghost" :disabled="loading" @click="load">
        <RefreshCw :size="14" :stroke-width="1.8" :class="{ spin: loading }" />
        <span>{{ loading ? '探测中…' : '重新探测' }}</span>
      </UiButton>
    </PageHeader>

    <div class="banner">
      每次点开或点「重新探测」都会重新查一遍数据库配置字段的存在与否——绿=已配（库里有值；凭证内容
      是否真有效以 kfHealthProbe 定时探针 / 真机验收为准，本页只探「配了没」不探「配对没」）、红=未配、
      琥珀=代码探不到（企业微信·微信客服·小程序后台纯人工项），需要人工去对应后台核实一遍。带填写框的
      项（微信客服凭证与卡片配置 / 支付对账凭证 / 支付接缝配置）可以直接在本页填好点「保存」，写入数据
      库后云函数运行时优先读库、立即生效、不用再去控制台改环境变量重新部署；填写框永远空白起——响应从
      不回显任何已存密钥/配置真实值，每次要改都得整值重新填一遍。其余项目仍是纯只读人工核对，不会出现
      输入框。
    </div>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <Card v-if="groups.length" flush>
      <div class="checklist">
        <template v-for="g in groups" :key="g.group">
          <div class="group-head">{{ g.group }}</div>
          <div v-for="it in g.items" :key="it.key" class="row">
            <div class="row-name-col">
              <div class="row-name">{{ it.name }}</div>
              <div class="row-loc">{{ it.location }}</div>
            </div>
            <div class="row-purpose">{{ it.purpose }}</div>
            <div class="row-status">
              <Badge :tone="toneOf(it.status)">{{ labelOf(it.status) }}</Badge>
            </div>
            <div class="row-howto">
              <div class="howto-text">{{ it.howTo }}</div>
              <div v-if="it.url" class="howto-url">{{ it.url }}</div>
              <div v-if="it.noteExtra" class="howto-note">{{ it.noteExtra }}</div>
            </div>
            <div v-if="it.fill && fillState[it.key]" class="row-fill">
              <select
                v-if="it.fill.inputType === 'select'"
                v-model="fillState[it.key].value"
                :disabled="fillState[it.key].busy"
                class="fill-select"
              >
                <option value="">不改动</option>
                <option v-for="opt in it.fill.options || []" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
              <textarea
                v-else-if="it.fill.inputType === 'textarea'"
                v-model="fillState[it.key].value"
                :disabled="fillState[it.key].busy"
                class="fill-textarea"
                rows="8"
                placeholder="粘贴完整内容后点保存…"
              />
              <input
                v-else
                v-model="fillState[it.key].value"
                :disabled="fillState[it.key].busy"
                :type="it.fill.inputType"
                class="fill-input"
                placeholder="填入后点保存生效…"
                :autocomplete="it.fill.inputType === 'password' ? 'new-password' : 'off'"
              />
              <UiButton size="sm" variant="ghost" :disabled="!canSubmit(it)" @click="submitFill(it)">
                {{ fillState[it.key].busy ? '保存中…' : '保存' }}
              </UiButton>
              <span v-if="fillState[it.key].error" class="fill-error">{{ fillState[it.key].error }}</span>
            </div>
          </div>
        </template>
      </div>
    </Card>
    <EmptyState v-else-if="!message" :icon="ShieldCheck" text="没有可展示的配置项" />
  </div>
</template>

<style scoped>
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 说明 banner（同 Settings.vue roadmap 语言：lilac 底·虚线描边） */
.banner {
  padding: 12px 16px;
  background: var(--ld-bg-lilac);
  border: 1px dashed var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12px;
  line-height: 1.7;
  color: var(--ld-content-2);
}

/* 单卡分组表：分组头分隔 + 四列行（名称位置 / 用途 / 状态 / 获取方式） */
.checklist {
  display: flex;
  flex-direction: column;
}
.group-head {
  padding: 12px 18px 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ld-content-2);
  background: var(--ld-bg-grey);
  border-bottom: 1px solid var(--ld-line);
}
.row {
  display: grid;
  grid-template-columns: 1.4fr 1.2fr 0.9fr 1.6fr;
  gap: 14px;
  align-items: start;
  padding: 12px 18px;
  border-bottom: 1px solid var(--ld-line);
}
.row:last-child {
  border-bottom: none;
}
.row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-ink);
}
.row-loc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ld-content-2);
}
.row-purpose {
  font-size: 12.5px;
  color: var(--ld-content);
  line-height: 1.55;
}
.row-status {
  margin-top: 1px;
}
.row-howto {
  min-width: 0;
}
.howto-text {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-brand-active);
  line-height: 1.5;
}
.howto-url {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ld-content-2);
  word-break: break-all;
}
.howto-note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ld-amber);
}

/* 填写区（批 B10：带 fill 元数据的项才出现）——占满整行、居下方，输入框永远空白起 */
.row-fill {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px dashed var(--ld-line);
}
.fill-input,
.fill-select {
  flex: 1 1 240px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  font: inherit;
  font-size: 12.5px;
  color: var(--ld-content);
}
.fill-textarea {
  flex: 1 1 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  font-family: var(--ld-font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--ld-content);
  resize: vertical;
}
.fill-input:focus,
.fill-select:focus,
.fill-textarea:focus {
  outline: none;
  border-color: var(--ld-purple-line);
}
.fill-input::placeholder,
.fill-textarea::placeholder {
  color: var(--ld-content-2);
}
.fill-error {
  flex: 1 1 100%;
  font-size: 11.5px;
  color: var(--ld-red);
}

@media (max-width: 900px) {
  .row {
    grid-template-columns: 1fr;
  }
}
</style>
