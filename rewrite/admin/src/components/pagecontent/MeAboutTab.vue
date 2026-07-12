<script setup lang="ts">
// 我的与关于页签（批C）：跨两份 content 档——mePage（默认昵称 + 九入口 label 改名/visible 开关·key 只读固定顺序）
// 与 about（关于我们 lead + 段落 ≤10）。两档各一条独立保存生命周期（usePageContent），工具条合并展示、保存一并触发。
import { computed } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { usePageContent } from '../../lib/usePageContent'
import { normalizeMePage, mePagePayload, normalizeAbout, aboutPayload } from '../../lib/mapPageContent'
import UiButton from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import Card from '../ui/Card.vue'
import EmptyState from '../ui/EmptyState.vue'

const me = usePageContent('mePage', normalizeMePage, mePagePayload)
const about = usePageContent('about', normalizeAbout, aboutPayload)

const busy = computed(() => me.busy.value || about.busy.value)
const message = computed(() => me.message.value || about.message.value)
const autoState = computed(() => {
  const s = [me.autoState.value, about.autoState.value]
  if (s.includes('saving')) return 'saving'
  if (s.includes('error')) return 'error'
  if (s.includes('saved')) return 'saved'
  return ''
})
async function saveBoth() {
  await me.save()
  await about.save()
}

function addSection() {
  if (about.model.value && about.model.value.sections.length < 10) about.model.value.sections.push({ title: '', body: '' })
}
function delSection(i: number) {
  about.model.value?.sections.splice(i, 1)
}
</script>

<template>
  <div v-if="me.model.value && about.model.value">
    <div class="pc-toolbar">
      <Badge v-if="autoState === 'saving'" tone="amber" dot>自动保存中…</Badge>
      <Badge v-else-if="autoState === 'saved'" tone="green" dot>已自动保存</Badge>
      <Badge v-else-if="autoState === 'error'" tone="red" dot>自动保存失败</Badge>
      <UiButton :disabled="busy" @click="saveBoth">{{ busy ? '保存中…' : '保存' }}</UiButton>
    </div>
    <p v-if="message" class="ld-status">{{ message }}</p>

    <div class="pc-split">
      <div class="pc-forms">
        <Card title="「我」页" sub="默认昵称 + 九个入口（可改名 · 可隐藏 · key 固定不可改）">
          <div class="pc-field"><label>未登录/未设昵称时的默认昵称（≤20 字）</label><input v-model="me.model.value.defaultNickname" class="pc-input" maxlength="20" placeholder="小棉鸭用户" /></div>
          <div class="me-entries">
            <div v-for="e in me.model.value.entries" :key="e.key" class="me-entry">
              <code class="me-key">{{ e.key }}</code>
              <input v-model="e.label" class="pc-input me-label" maxlength="60" placeholder="入口名称" />
              <label class="me-vis"><input v-model="e.visible" type="checkbox" />显示</label>
            </div>
          </div>
        </Card>

        <Card title="关于我们" :sub="`引言 + 段落 · 最多 10 段 · 当前 ${about.model.value.sections.length} 段`">
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="about.model.value.sections.length >= 10" @click="addSection"><Plus :size="14" :stroke-width="2" />新增一段</UiButton>
          </template>
          <div class="pc-field"><label>引言（≤200 字）</label><textarea v-model="about.model.value.lead" class="pc-textarea" maxlength="200" placeholder="小棉鸭，让每个人都能亲手创造随身幸运物。" /></div>
          <EmptyState v-if="!about.model.value.sections.length" text="暂无段落，点「新增一段」添加（如：品牌故事 / 我们的团队 / 联系方式）" />
          <div v-for="(s, i) in about.model.value.sections" :key="i" class="pc-item">
            <div class="pc-item-head"><span class="pc-item-idx">第 {{ i + 1 }} 段</span><button class="pc-iconbtn" title="删除这段" @click="delSection(i)"><Trash2 :size="14" :stroke-width="1.8" /></button></div>
            <div class="pc-field"><label>小标题（≤60 字）</label><input v-model="s.title" class="pc-input" maxlength="60" placeholder="品牌故事" /></div>
            <div class="pc-field"><label>正文（≤2000 字）</label><textarea v-model="s.body" class="pc-textarea" maxlength="2000" placeholder="我们相信……" /></div>
          </div>
        </Card>
      </div>

      <!-- 右侧手机预览：「我」页入口列 + 关于引言 -->
      <div class="pc-phone-wrap">
        <div class="pc-phone">
          <div class="ph-me-head">
            <div class="ph-me-avatar">🦆</div>
            <div class="ph-me-name">{{ me.model.value.defaultNickname || '（默认昵称）' }}</div>
          </div>
          <div class="ph-me-list">
            <template v-for="e in me.model.value.entries" :key="e.key">
              <div v-if="e.visible" class="ph-me-row">{{ e.label || '（未命名）' }}</div>
            </template>
          </div>
          <div class="ph-about">
            <div class="ph-about-cap">关于我们</div>
            <div class="ph-about-lead" :class="{ 'pc-ph': !about.model.value.lead }">{{ about.model.value.lead || '（默认引言）' }}</div>
          </div>
        </div>
        <span class="pc-phone-cap">「我」页入口 + 关于预览</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.me-entries {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.me-entry {
  display: grid;
  grid-template-columns: 96px 1fr auto;
  gap: 10px;
  align-items: center;
}
.me-key {
  font-family: var(--ld-font-mono);
  font-size: 11.5px;
  color: var(--ld-content-2);
  background: var(--ld-bg-grey);
  padding: 4px 8px;
  border-radius: 6px;
  text-align: center;
}
.me-vis {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ld-content-2);
  white-space: nowrap;
}
.ph-me-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ph-me-avatar {
  width: 46px;
  height: 46px;
  border-radius: 999px;
  background: var(--ld-bg-sage);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.ph-me-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--ld-ink);
}
.ph-me-list {
  margin-top: 16px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: 12px;
  overflow: hidden;
}
.ph-me-row {
  padding: 11px 14px;
  font-size: 13px;
  color: var(--ld-content);
  border-bottom: 1px solid var(--ld-line);
}
.ph-me-row:last-child {
  border-bottom: none;
}
.ph-about {
  margin-top: 16px;
}
.ph-about-cap {
  font-size: 13px;
  font-weight: 700;
  color: var(--ld-ink);
  margin-bottom: 6px;
}
.ph-about-lead {
  font-size: 12px;
  color: var(--ld-content-2);
  line-height: 1.55;
}
</style>
