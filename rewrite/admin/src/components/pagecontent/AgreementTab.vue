<script setup lang="ts">
// 协议文案页签（批C）：用户协议 user + 隐私政策 privacy 两份（各 version/effectiveDate + 条款增删改 ≤30）。
// 顶部琥珀警示：文案已过审、改动须同步微信后台《隐私保护指引》；保存时服务端自动留版本档（history 只读展示·无回滚）。
import { Plus, Trash2, AlertTriangle } from 'lucide-vue-next'
import { usePageContent } from '../../lib/usePageContent'
import { normalizeAgreement, agreementPayload, type AgreementClause } from '../../lib/mapPageContent'
import UiButton from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import Card from '../ui/Card.vue'
import EmptyState from '../ui/EmptyState.vue'

const { model, message, busy, autoState, save } = usePageContent('agreement', normalizeAgreement, agreementPayload)

function addSection(c: AgreementClause) {
  if (c.sections.length < 30) c.sections.push({ title: '', body: '' })
}
function delSection(c: AgreementClause, i: number) {
  c.sections.splice(i, 1)
}
</script>

<template>
  <div v-if="model">
    <div class="pc-toolbar">
      <Badge v-if="autoState === 'saving'" tone="amber" dot>自动保存中…</Badge>
      <Badge v-else-if="autoState === 'saved'" tone="green" dot>已自动保存</Badge>
      <Badge v-else-if="autoState === 'error'" tone="red" dot>自动保存失败</Badge>
      <UiButton :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存' }}</UiButton>
    </div>
    <p v-if="message" class="ld-status">{{ message }}</p>

    <div class="pc-amber-banner">
      <AlertTriangle :size="16" :stroke-width="2" style="flex: none; margin-top: 1px" />
      <span>当前文案已过审。改动隐私政策请同步更新微信后台《隐私保护指引》；每次改版号保存后系统会自动留一条版本档。</span>
    </div>

    <div class="pc-split" style="margin-top: 16px">
      <div class="pc-forms">
        <Card v-for="part in (['user', 'privacy'] as const)" :key="part" :title="part === 'user' ? '用户协议' : '隐私政策'" :sub="`版本号 + 生效日期 + 条款 · 最多 30 条 · 当前 ${model[part].sections.length} 条`">
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="model[part].sections.length >= 30" @click="addSection(model[part])"><Plus :size="14" :stroke-width="2" />新增条款</UiButton>
          </template>
          <div class="pc-row2">
            <div class="pc-field"><label>版本号（≤20 字）</label><input v-model="model[part].version" class="pc-input" maxlength="20" placeholder="v1.0" /></div>
            <div class="pc-field"><label>生效日期（≤20 字）</label><input v-model="model[part].effectiveDate" class="pc-input" maxlength="20" placeholder="2026-07-12" /></div>
          </div>
          <EmptyState v-if="!model[part].sections.length" text="暂无条款，点「新增条款」添加" />
          <div v-for="(s, i) in model[part].sections" :key="i" class="pc-item">
            <div class="pc-item-head"><span class="pc-item-idx">第 {{ i + 1 }} 条</span><button class="pc-iconbtn" title="删除这条" @click="delSection(model[part], i)"><Trash2 :size="14" :stroke-width="1.8" /></button></div>
            <div class="pc-field"><label>条款标题（≤60 字）</label><input v-model="s.title" class="pc-input" maxlength="60" placeholder="第一条 服务范围" /></div>
            <div class="pc-field"><label>条款正文（≤2000 字）</label><textarea v-model="s.body" class="pc-textarea" maxlength="2000" placeholder="……" /></div>
          </div>
        </Card>

        <Card title="版本档" sub="每次改版号保存自动追加（服务端维护 · 只读展示 · 保留最近 10 条）">
          <EmptyState v-if="!model.history.length" text="暂无版本记录（改动版本号并保存后自动生成）" />
          <div v-else class="hist">
            <div v-for="(h, i) in model.history" :key="i" class="hist-row">
              <Badge :tone="h.part === 'user' ? 'brand' : 'neutral'">{{ h.part === 'user' ? '用户协议' : '隐私政策' }}</Badge>
              <span class="hist-ver">{{ h.version }}</span>
              <span class="hist-at">{{ h.at }}</span>
            </div>
          </div>
        </Card>
      </div>

      <!-- 右侧手机预览：协议页壳 -->
      <div class="pc-phone-wrap">
        <div class="pc-phone">
          <div v-for="part in (['user', 'privacy'] as const)" :key="part" class="ph-agr">
            <div class="ph-agr-title">{{ part === 'user' ? '用户协议' : '隐私政策' }}</div>
            <div class="ph-agr-meta pc-ph" :class="{ 'pc-ph': !model[part].version }">
              {{ model[part].version || '（无版本号）' }} · {{ model[part].effectiveDate || '（无日期）' }}
            </div>
            <div v-if="model[part].sections.length" class="ph-agr-first">{{ model[part].sections[0].title || '（未填标题）' }}</div>
            <div v-else class="pc-ph ph-agr-empty">（暂无条款）</div>
          </div>
        </div>
        <span class="pc-phone-cap">协议页预览</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pc-row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.hist {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hist-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}
.hist-ver {
  font-family: var(--ld-font-mono);
  font-weight: 600;
  color: var(--ld-ink);
}
.hist-at {
  color: var(--ld-content-2);
  font-size: 11.5px;
}
.ph-agr {
  margin-bottom: 18px;
}
.ph-agr-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ld-ink);
}
.ph-agr-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ld-content-2);
}
.ph-agr-first {
  margin-top: 10px;
  font-size: 13px;
  color: var(--ld-content);
}
.ph-agr-empty {
  margin-top: 10px;
  font-size: 12px;
}
</style>
