<script setup lang="ts">
// 欢迎与激活页签（批C）：W1 恭喜屏（主标题/副文案/警示语）+ W2 三件事清单。
// 警示语琥珀描边提示「保留原意勿清空」（不可退货等法务文案·清空即失守）。背景图三态在「首页」签编辑（存 content/home 档·此签只提示）。
import { Plus, Trash2 } from 'lucide-vue-next'
import { usePageContent } from '../../lib/usePageContent'
import { normalizeWelcome, welcomePayload } from '../../lib/mapPageContent'
import UiButton from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'
import Card from '../ui/Card.vue'
import EmptyState from '../ui/EmptyState.vue'

const { model, message, busy, autoState, save } = usePageContent('welcome', normalizeWelcome, welcomePayload)

function addItem() {
  if (model.value && model.value.w2.items.length < 3) model.value.w2.items.push({ title: '', desc: '' })
}
function delItem(i: number) {
  model.value?.w2.items.splice(i, 1)
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

    <div class="pc-split">
      <div class="pc-forms">
        <Card title="W1 恭喜屏" sub="激活成功后的第一屏：主标题 + 副文案 + 警示语">
          <div class="pc-field"><label>主标题（≤60 字）</label><input v-model="model.w1.title" class="pc-input" maxlength="60" placeholder="恭喜你，激活成功！" /></div>
          <div class="pc-field"><label>副文案（≤120 字）</label><textarea v-model="model.w1.sub" class="pc-textarea" maxlength="120" placeholder="你的专属钩织之旅现在开始。" /></div>
          <div class="pc-field">
            <label>警示语（≤120 字·法务文案·保留原意勿清空）</label>
            <input v-model="model.w1.warning" class="pc-input pc-amber-edge" maxlength="120" placeholder="激活后不可退货，请确认后再激活。" />
          </div>
        </Card>

        <Card title="W2 三件事" :sub="`激活后要做的事清单 · 最多 3 条 · 当前 ${model.w2.items.length} 条`">
          <template #head>
            <UiButton variant="ghost" size="sm" :disabled="model.w2.items.length >= 3" @click="addItem"><Plus :size="14" :stroke-width="2" />新增一条</UiButton>
          </template>
          <EmptyState v-if="!model.w2.items.length" text="暂无条目，点「新增一条」添加（如：领取材料包 / 观看教程 / 加入社群）" />
          <div v-for="(it, i) in model.w2.items" :key="i" class="pc-item">
            <div class="pc-item-head"><span class="pc-item-idx">第 {{ i + 1 }} 条</span><button class="pc-iconbtn" title="删除这条" @click="delItem(i)"><Trash2 :size="14" :stroke-width="1.8" /></button></div>
            <div class="pc-field"><label>标题（≤60 字）</label><input v-model="it.title" class="pc-input" maxlength="60" placeholder="领取你的材料包" /></div>
            <div class="pc-field"><label>说明（≤2000 字）</label><textarea v-model="it.desc" class="pc-textarea" maxlength="2000" placeholder="在「我的订单」查看物流，收到后即可开始。" /></div>
          </div>
        </Card>
      </div>

      <!-- 右侧手机预览：W1 恭喜屏 + W2 清单 -->
      <div class="pc-phone-wrap">
        <div class="pc-phone">
          <div class="ph-w1-title">{{ model.w1.title || '（默认文案）' }}</div>
          <div class="ph-w1-sub" :class="{ 'pc-ph': !model.w1.sub }">{{ model.w1.sub || '（默认副文案）' }}</div>
          <div v-if="model.w1.warning" class="ph-w1-warn">{{ model.w1.warning }}</div>
          <div class="ph-w2">
            <div v-for="(it, i) in model.w2.items" :key="i" class="ph-w2-card">
              <div class="ph-w2-t" :class="{ 'pc-ph': !it.title }">{{ it.title || '（未填标题）' }}</div>
              <div class="ph-w2-d" :class="{ 'pc-ph': !it.desc }">{{ it.desc || '（未填说明）' }}</div>
            </div>
            <div v-if="!model.w2.items.length" class="pc-ph ph-w2-empty">（暂无三件事条目）</div>
          </div>
        </div>
        <span class="pc-phone-cap">激活成功 · W1/W2 预览</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ph-w1-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--ld-ink);
  text-align: center;
  line-height: 1.3;
}
.ph-w1-sub {
  margin-top: 8px;
  font-size: 13px;
  color: var(--ld-content-2);
  text-align: center;
}
.ph-w1-warn {
  margin: 14px 0 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--ld-bg-amber-soft);
  color: var(--ld-amber);
  font-size: 12px;
  text-align: center;
}
.ph-w2 {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ph-w2-card {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: 12px;
  padding: 12px 14px;
}
.ph-w2-t {
  font-size: 14px;
  font-weight: 700;
  color: var(--ld-ink);
}
.ph-w2-d {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ld-content-2);
  line-height: 1.5;
}
.ph-w2-empty {
  text-align: center;
  font-size: 12px;
  padding: 20px 0;
}
</style>
