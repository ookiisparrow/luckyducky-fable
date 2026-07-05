<script setup lang="ts">
// 知识库（设计语言一致性·M3 UI 批14）：FAQ 整册编辑（客服 bot 与坐席快捷回复读同一份·整体覆盖式保存——删行即真删）。
// 逻辑未动，仅套设计语言（页头/FAQ 行卡/分类 select/启用勾选/token）。
import { ref, onMounted } from 'vue'
import { Trash2, Plus } from 'lucide-vue-next'
import { listKb, saveKb } from '../api/cs'
import { normalizeKb, type KbRow } from '../lib/mapCs'

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

// 预设 FAQ（换皮删了·键按「分类:主题」＝客服菜单叶子 id 口径填好·owner 按实际菜单微调）
const PRESET: Omit<KbRow, 'order'>[] = [
  { key: 'logistics:eta', question: '什么时候发货 / 多久到？', answer: '付款后 48 小时内发货，快递一般 3-5 天到；物流单号在「我的订单」可查。', category: 'logistics', enabled: true },
  { key: 'activation:howto', question: '激活码怎么用？', answer: '收到材料包后扫卡片上的二维码，输入激活码即可进入课程。', category: 'activation', enabled: true },
  { key: 'aftersale:refund', question: '可以退货退款吗？', answer: '激活卡未拆封可 7 天无理由退；已激活进课不支持退款。', category: 'aftersale', enabled: true },
  { key: 'tutorial:start', question: '零基础能学会吗？', answer: '可以，套装配分步视频，跟着做就能完成第一只小棉鸭。', category: 'tutorial', enabled: true },
]

async function reload() {
  const r = await listKb()
  rows.value = r.ok ? normalizeKb(r.list) : []
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

// B3：新建 FAQ 键留空由人填（换皮自动生成随机 faq-<ts>·永不匹配菜单叶子·bot 命不中）
function addRow() {
  rows.value.push({ key: '', question: '', answer: '', category: 'other', enabled: true, order: rows.value.length })
}
function loadPreset() {
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
  message.value = r.ok ? `已保存 ${Number(r.count) || 0} 条（整册覆盖·被删的行已真删）` : '保存失败：' + String(r.error || '')
  void reload()
}

onMounted(reload)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>知识库（FAQ）</h1>
        <p class="sub">客服机器人和坐席快捷回复读的是同一份；「键」须＝客服菜单叶子 id（如 logistics:eta），bot 据此命中。保存整册覆盖。</p>
      </div>
      <div class="head-ops">
        <button class="act ghost" @click="loadPreset">载入预设 FAQ</button>
        <button class="btn-primary" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存整册' }}</button>
      </div>
    </header>

    <p v-if="message" class="status">{{ message }}</p>

    <div v-for="(row, i) in rows" :key="row.key" class="kb-card">
      <div class="kb-head">
        <input v-model="row.key" placeholder="键 logistics:eta" class="kbkey" title="＝客服菜单叶子 id·bot 据此命中" />
        <select v-model="row.category" class="cat">
          <option v-for="c in CATS" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <input v-model="row.question" placeholder="问题（≤200 字）" maxlength="200" class="q" />
        <label class="en"><input v-model="row.enabled" type="checkbox" /><span>启用</span></label>
        <button class="icon-btn" :class="{ warn: confirmKey === 'd:' + i }" :title="confirmKey === 'd:' + i ? '再点确认删除' : '删行'" @click="delRow(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
      </div>
      <textarea v-model="row.answer" placeholder="答案（≤2000 字·bot 原样发给顾客）" maxlength="2000" />
    </div>

    <button class="add-btn" @click="addRow"><Plus :size="14" :stroke-width="2" /><span>加一条 FAQ</span></button>
  </div>
</template>

<style scoped>
.page {
  max-width: 900px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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
.btn-primary {
  flex: none;
  padding: 10px 18px;
  border: none;
  border-radius: 999px;
  background: var(--ld-purple-ink);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.5;
}
.head-ops {
  display: flex;
  gap: 8px;
  flex: none;
}
.act.ghost {
  padding: 10px 16px;
  border: 1px solid var(--ld-line);
  border-radius: 999px;
  background: var(--ld-bg);
  color: var(--ld-content);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.kbkey {
  flex: none;
  width: 130px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line-strong);
  border-radius: 8px;
  font-size: 12px;
  font-family: var(--ld-font-mono);
  background: var(--ld-bg);
}
.icon-btn.warn {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.kb-card {
  padding: 14px 16px;
  margin-bottom: 10px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
}
.kb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.cat {
  flex: none;
  width: 90px;
  padding: 7px 10px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  background: var(--ld-bg);
}
.q {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
}
.en {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: 12px;
  color: var(--ld-content-2);
  cursor: pointer;
}
.en input {
  width: 15px;
  height: 15px;
  accent-color: var(--ld-brand);
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.icon-btn:hover {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
textarea {
  width: 100%;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  font-size: 13px;
  font-family: var(--ld-font);
  box-sizing: border-box;
  resize: vertical;
}
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border: 1px dashed var(--ld-purple-line);
  border-radius: 999px;
  background: var(--ld-bg-lilac);
  color: var(--ld-brand-active);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
</style>
