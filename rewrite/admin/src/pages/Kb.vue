<script setup lang="ts">
// 知识库（设计语言一致性·M3 UI 批14）：FAQ 整册编辑（客服 bot 与坐席快捷回复读同一份·整体覆盖式保存——删行即真删）。
// 逻辑未动，仅套设计语言（页头/FAQ 行卡/分类 select/启用勾选/token）。
import { ref, onMounted } from 'vue'
import { Trash2, Plus, BookOpen } from 'lucide-vue-next'
import { listKb, saveKb } from '../api/cs'
import { normalizeKb, type KbRow } from '../lib/mapCs'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const CATS = [
  { key: 'logistics', label: '物流' },
  { key: 'activation', label: '激活' },
  { key: 'aftersale', label: '售后' },
  { key: 'tutorial', label: '教程' },
  { key: 'other', label: '其他' },
]

const rows = ref<KbRow[]>([])
const message = ref('')
const busy = ref(false)
const confirmKey = ref('')
// 载入成功才放开「保存整册」——saveKb 是整册覆盖同步（提交外的旧 doc 逐个 remove），载入失败 rows=[] 时一保存就把
// 真实整份 FAQ 删光（KB 是客服 bot 答案 + 坐席快捷回复单源·不可逆）。同 HelpVideos/Settings/ScmBom 载入失败门·P1。
let loaded = false

// 预设 FAQ（换皮删了·键按「分类:主题」＝客服菜单叶子 id 口径填好·owner 按实际菜单微调）
const PRESET: Omit<KbRow, 'order'>[] = [
  { key: 'logistics:eta', question: '什么时候发货 / 多久到？', answer: '付款后 48 小时内发货，快递一般 3-5 天到；物流单号在「我的订单」可查。', category: 'logistics', enabled: true, featured: false },
  { key: 'activation:howto', question: '激活码怎么用？', answer: '收到材料包后扫卡片上的二维码，输入激活码即可进入课程。', category: 'activation', enabled: true, featured: false },
  { key: 'aftersale:refund', question: '可以退货退款吗？', answer: '激活卡未拆封可 7 天无理由退；已激活进课不支持退款。', category: 'aftersale', enabled: true, featured: false },
  { key: 'tutorial:start', question: '零基础能学会吗？', answer: '可以，套装配分步视频，跟着做就能完成第一只小棉鸭。', category: 'tutorial', enabled: true, featured: false },
]

async function reload() {
  confirmKey.value = '' // 刷新即复位危险态（P1·防旧武装的删行残留、重进同一位一击直删·批3 规格）
  loaded = false // 载入/刷新期间禁保存（含 save 后刷新失败 rows=[] 的窗口·防拿空表覆盖删光·同 HelpVideos）
  const r = await listKb()
  rows.value = r.ok ? normalizeKb(r.list) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
  loaded = r.ok // 成功（含合法空库 list=[]）才放开·失败恒关
  return r.ok
}

// B3：新建 FAQ 键留空由人填（换皮自动生成随机 faq-<ts>·永不匹配菜单叶子·bot 命不中）
function addRow() {
  rows.value.push({ key: '', question: '', answer: '', category: 'other', enabled: true, order: rows.value.length, featured: false })
}
function loadPreset() {
  confirmKey.value = '' // 载入预设即复位危险态（P1·同 reload 约定·批3 规格同类扩面）
  const existing = new Set(rows.value.map((r) => r.key))
  let added = 0
  PRESET.forEach((p) => {
    if (!existing.has(p.key)) {
      rows.value.push({ ...p, order: rows.value.length })
      added++
    }
  })
  message.value = added ? `已载入 ${added} 条预设（键已按菜单叶子 id 填好·可改）` : '预设 FAQ 已都在'
}
function delRow(i: number) {
  if (confirmKey.value !== 'd:' + i) {
    confirmKey.value = 'd:' + i
    return
  }
  confirmKey.value = ''
  rows.value.splice(i, 1)
}

async function save() {
  if (busy.value) return
  if (!loaded) {
    // 未成功载入即保存 = 拿空/残缺 rows 整册覆盖·把真实 FAQ 全删光（P1）——拒绝并提示刷新
    message.value = '知识库未成功载入，暂不能保存（避免覆盖并删光已有 FAQ·请刷新重试）'
    return
  }
  // 键校验（B3·bot 命中命脉·换皮删了这层）：非空 + 唯一（重复会互相覆盖）
  const keys = rows.value.map((r) => r.key.trim())
  if (keys.some((k) => !k)) {
    message.value = '每条 FAQ 都要填「键」——键须＝客服菜单叶子 id（如 logistics:eta），bot 据此命中'
    return
  }
  const dup = keys.find((k, i) => keys.indexOf(k) !== i)
  if (dup) {
    message.value = `键重复：「${dup}」——键必须唯一，否则 bot 命中会互相覆盖`
    return
  }
  // 落库前 trim（键是 bot 精确命中命脉·带尾随空格的键能绕过 trim 唯一校验入库却命不中·数据卫生）
  const cleaned = rows.value.map((row) => ({ ...row, key: row.key.trim(), question: row.question.trim(), answer: row.answer.trim() }))
  busy.value = true
  const r = await saveKb(cleaned)
  busy.value = false
  if (!r.ok) {
    // 保存失败留原文·绝不 reload——否则 listKb 成功会把编辑器换回旧数据（丢未存的 FAQ 编辑）并抹掉本条错（病根#14）
    // GC_REMOVE_FAIL（H2）：新内容已 upsert 成功，只是旧条目 GC 删除失败残留——友好文案区分于「整体没存上」
    message.value = r.error === 'GC_REMOVE_FAIL' ? '已保存新内容，但有旧条目未删净（重存一次即可收敛）' : '保存失败：' + String(r.error || '')
    return
  }
  const n = Number(r.count) || 0
  const okR = await reload() // 成功才刷（拉回落库后的整册）
  // 只在刷新也成功时显纯成功；刷新失败保留其「加载失败」可见、不被成功盖掉（病根#14 失败必可观测·迭代I 批7 回归修）
  message.value = okR ? `已保存 ${n} 条（整册覆盖·被删的行已真删）` : `已保存 ${n} 条，但列表刷新失败，请重开本页确认`
}

onMounted(reload)
</script>

<template>
  <div class="ld-page kb">
    <PageHeader title="知识库（FAQ）" sub="客服机器人和坐席快捷回复读的是同一份；「键」须＝客服菜单叶子 id（如 logistics:eta），bot 据此命中。勾「精选」的条目会公开下发到小程序播放页求助面板常见问题区（R37b）。保存整册覆盖。">
      <UiButton variant="ghost" @click="loadPreset">载入预设 FAQ</UiButton>
      <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存整册' }}</UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <Card title="FAQ 条目" :sub="`共 ${rows.length} 条 · 整册覆盖式保存·删行即真删`">
      <template #head>
        <UiButton variant="ghost" size="sm" @click="addRow"><Plus :size="14" :stroke-width="2" />新增一条</UiButton>
      </template>

      <EmptyState v-if="!rows.length" :icon="BookOpen" text="暂无 FAQ，点「新增一条」或「载入预设 FAQ」开始" />

      <div v-else class="kb-list">
        <div v-for="(row, i) in rows" :key="i" class="kb-row">
          <div class="kb-row-head">
            <input v-model="row.key" placeholder="键 logistics:eta" class="kb-key" title="＝客服菜单叶子 id·bot 据此命中" />
            <select v-model="row.category" class="kb-cat">
              <option v-for="c in CATS" :key="c.key" :value="c.key">{{ c.label }}</option>
            </select>
            <input v-model="row.question" placeholder="问题（≤200 字）" maxlength="200" class="kb-q" />
            <label class="kb-en"><input v-model="row.enabled" type="checkbox" /><span>启用</span></label>
            <label class="kb-en" title="勾选后公开下发到小程序播放页求助面板常见问题区（R37b）"><input v-model="row.featured" type="checkbox" /><span>精选</span></label>
            <button
              class="kb-del"
              :class="{ warn: confirmKey === 'd:' + i }"
              :title="confirmKey === 'd:' + i ? '再点确认删除' : '删行'"
              @click="delRow(i)"
            >
              <Trash2 :size="14" :stroke-width="1.8" />
            </button>
          </div>
          <textarea v-model="row.answer" placeholder="答案（≤2000 字·bot 原样发给顾客）" maxlength="2000" class="kb-ans" />
        </div>
      </div>
    </Card>
  </div>
</template>

<style scoped>
/* FAQ 整册编辑器·本页独有（共享原语管页头/卡/按钮/空态；这里只留内联编辑行的私有样式） */
.kb-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.kb-row {
  padding: 12px 14px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
}
.kb-row-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.kb-key {
  flex: none;
  width: 132px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: var(--ld-radius-sm);
  font-size: 12px;
  font-family: var(--ld-font-mono);
  color: var(--ld-content);
  background: var(--ld-bg);
}
.kb-cat {
  flex: none;
  width: 92px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.kb-q {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  color: var(--ld-content);
  background: var(--ld-bg);
}
.kb-en {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: 12px;
  color: var(--ld-content-2);
  cursor: pointer;
}
.kb-en input {
  width: 15px;
  height: 15px;
  accent-color: var(--ld-brand);
}
.kb-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.kb-del:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.kb-del.warn {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
.kb-ans {
  width: 100%;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  font-family: var(--ld-font);
  color: var(--ld-content);
  background: var(--ld-bg);
  box-sizing: border-box;
  resize: vertical;
}
</style>
