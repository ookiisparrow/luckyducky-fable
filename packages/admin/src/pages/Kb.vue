<script setup>
/**
 * 知识库（后台360工作站 B4.1·admin 侧）。维护客服 FAQ/知识条目：每条 = 键（FAQ 路由键·同客服菜单叶子 id）
 * + 问题（自己看的标签）+ 答案（客服 bot 回给顾客的文案）+ 分类 + 是否启用。
 * 客服 bot（微信客服 in-chat）按「键」读本库发答案——FAQ 答案单源（守卫 faq-via-kb-single-source）：
 * 改答案只在这里改，bot 与坐席共用同一份，杜绝两处漂移。
 * - 整体覆盖式保存：保存即把知识库同步成当前列表（删掉的条目会被移除）。
 * - 「键」须与客服菜单叶子 id 对应才会被 bot 命中（如 logistics:eta / addr:change / activation:howto / aftersale:policy）；
 *   不确定填哪个键时，点「载入预设 FAQ」一键带出当前客服菜单用到的几条，再按需改文案。
 */
import { ref } from 'vue'
import { cloudMode, listKb, saveKb } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'

const CATEGORIES = [
  { v: 'logistics', label: '物流 / 订单' },
  { v: 'activation', label: '激活 / 课程' },
  { v: 'aftersale', label: '退换 / 售后' },
  { v: 'tutorial', label: '钩织教程' },
  { v: 'other', label: '其它' },
]

// 预设模板（= 当前客服菜单叶子用到的 FAQ 键 + 初始文案；载入后可编辑/删除·非运行时来源）。
// 运行时答案单源永远是 kb 本身；这里只是给空库一个起点，省得手敲键名/初稿（首次维护用）。
const PRESET = [
  { key: 'logistics:eta', category: 'logistics', question: '多久发货', answer: '现货商品付款后 48 小时内发货；预售商品以商品页标注为准。发出后可在「查我的订单 / 物流」看单号。' },
  { key: 'addr:change', category: 'logistics', question: '改收货地址', answer: '未发货前可在小程序「我的订单 → 订单详情」修改收货地址；已发货请点「转人工」协助拦截。' },
  { key: 'activation:howto', category: 'activation', question: '激活码怎么用', answer: '收到的激活码在小程序「我的 → 课程 / 激活」页输入即可解锁；一码一用，激活后绑定本账号。' },
  { key: 'aftersale:policy', category: 'aftersale', question: '退换政策', answer: '未使用且不影响二次销售可 7 天无理由退换；材料包拆封后如有质量问题（缺件/损坏）凭照片走售后。具体以商品页与售后页为准。' },
]

const entries = ref([])
const loading = ref(false)
const saving = ref(false)
const loadErr = ref('')

async function load() {
  if (!cloudMode) return
  loading.value = true
  loadErr.value = ''
  try {
    const list = await listKb()
    entries.value = list.map((e) => ({
      key: e.key,
      question: e.question || '',
      answer: e.answer || '',
      category: e.category || 'other',
      enabled: e.enabled !== false,
    }))
  } catch (e) {
    loadErr.value = '知识库加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
load()

function addEntry() {
  entries.value.push({ key: '', question: '', answer: '', category: 'other', enabled: true })
}
async function removeEntry(i) {
  if (await confirmDialog({ title: '删除', message: '删除这条知识条目？', confirmText: '删除', danger: true }))
    entries.value.splice(i, 1)
}
function loadPreset() {
  const have = new Set(entries.value.map((e) => e.key))
  for (const p of PRESET) if (!have.has(p.key)) entries.value.push({ ...p, enabled: true })
  toast('已载入预设（重复键已跳过），按需改文案后保存', 'ok')
}

async function save() {
  if (saving.value) return
  // 校验：键非空 + 唯一（键是 bot 命中的路由键·重复会互相覆盖）
  const seen = new Set()
  for (const e of entries.value) {
    const k = (e.key || '').trim()
    if (!k) return toast('每条都要填「键」（FAQ 路由键）', 'err')
    if (seen.has(k)) return toast('键「' + k + '」重复，请改成唯一', 'err')
    seen.add(k)
  }
  saving.value = true
  try {
    const payload = entries.value.map((e, i) => ({
      key: e.key.trim(),
      question: e.question.trim(),
      answer: e.answer.trim(),
      category: e.category || 'other',
      enabled: !!e.enabled,
      order: i,
    }))
    const ok = await saveKb(payload)
    toast(ok ? '已保存 ✓' : '保存失败，检查网络', ok ? 'ok' : 'err')
  } catch (e) {
    toast('保存失败：' + e.message, 'err')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="headrow">
      <div>
        <h2>知识库</h2>
        <p class="desc">
          维护客服常见问题的标准答案。客服机器人按「键」从这里读答案回给顾客——改答案只在这里改一处，机器人和坐席用的是同一份。
        </p>
      </div>
    </div>

    <p v-if="!cloudMode" class="hint warn">知识库维护需云端模式（配置 admin/.env.local 的 VITE_ADMIN_API）。</p>
    <template v-else>
      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading" class="hint">加载中…</p>

      <template v-else>
        <p v-if="!entries.length" class="hint">
          还没有知识条目。点「载入预设 FAQ」带出当前客服菜单用到的几条作起点，或点「＋ 添加条目」从空白新增。
        </p>

        <div v-for="(e, i) in entries" :key="i" class="entry" :class="{ off: !e.enabled }">
          <div class="entry-head">
            <span class="num">{{ i + 1 }}</span>
            <input v-model="e.key" class="name keyf" placeholder="键（如 logistics:eta·须与客服菜单叶子对应）" />
            <select v-model="e.category" class="cat">
              <option v-for="c in CATEGORIES" :key="c.v" :value="c.v">{{ c.label }}</option>
            </select>
            <label class="enable"><input v-model="e.enabled" type="checkbox" />启用</label>
            <button class="mini del" @click="removeEntry(i)">删除</button>
          </div>
          <input v-model="e.question" class="name title" placeholder="问题（给自己看的标签·如「多久发货」）" />
          <textarea
            v-model="e.answer"
            class="name answer"
            rows="3"
            placeholder="答案（客服机器人回给顾客的文案）"
          ></textarea>
        </div>

        <div class="actions">
          <button class="addentry" @click="addEntry">＋ 添加条目</button>
          <button class="preset" @click="loadPreset">载入预设 FAQ</button>
        </div>

        <div class="footrow">
          <button class="save-btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          <span class="tip">保存＝把知识库同步成上面这份；删掉的条目会被移除。键须唯一、与客服菜单叶子对应才会被机器人命中。</span>
        </div>
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
}
.entry {
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--white);
}
.entry.off {
  opacity: 0.6;
}
.entry-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 6px;
}
.num {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 6px;
  background: var(--bg-grey);
  color: var(--content-2);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.name {
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 13px;
  background: transparent;
  outline: none;
  font-family: inherit;
}
.name:hover {
  border-color: var(--line-strong);
}
.name:focus {
  border-color: var(--brand);
  background: var(--white);
}
.keyf {
  flex: 1;
  font-weight: 600;
  border-color: var(--line);
}
.cat {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12.5px;
  font-family: inherit;
  background: var(--white);
  color: var(--ink);
}
.enable {
  font-size: 12px;
  color: var(--content-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.title {
  display: block;
  width: 100%;
  box-sizing: border-box;
  font-weight: 700;
  font-size: 14px;
  border-color: var(--line);
}
.answer {
  display: block;
  width: 100%;
  margin-top: 6px;
  box-sizing: border-box;
  resize: vertical;
  line-height: 1.5;
  border-color: var(--line);
}
.actions {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.addentry {
  flex: 1;
  border: 1px solid var(--purple-line);
  background: var(--bg-lilac);
  color: var(--brand-active);
  font-size: 13px;
  font-weight: 600;
  border-radius: 13px;
  padding: 12px;
  cursor: pointer;
}
.preset {
  border: 1px solid var(--line);
  background: var(--white);
  color: var(--content-2);
  font-size: 12.5px;
  border-radius: 13px;
  padding: 12px 16px;
  cursor: pointer;
}
.footrow {
  display: flex;
  align-items: center;
  gap: 12px;
}
.save-btn {
  border: none;
  background: var(--brand);
  color: var(--white);
  font-size: 13.5px;
  font-weight: 600;
  border-radius: 9px;
  padding: 10px 22px;
  cursor: pointer;
}
.save-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.tip {
  font-size: 11.5px;
  color: var(--content-2);
}
.mini {
  border: none;
  background: none;
  font-size: 11.5px;
  color: var(--content-2);
  cursor: pointer;
  flex: 0 0 auto;
}
.mini.del:hover {
  color: var(--red);
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 6px 0 14px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
