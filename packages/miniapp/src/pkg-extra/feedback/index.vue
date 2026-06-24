<script setup>
/**
 * 意见反馈页（运营钩子①·待办#23 前端半边）。
 * 上线初期 bug 高发期主动收用户反馈：分类（功能问题 / 内容建议 / 其它）+ 反馈内容 + 可选联系方式。
 * 提交走 api/feedback.js → 云函数 submitFeedback（openid 闸 + 频控 + 白名单字段，云端只写本人）。
 * 不带图片上传（最小合理默认·避免相册隐私接口 + 云存储成本）；联系方式选填、由用户自填、仅供回访。
 */
import { ref, computed } from 'vue'
import CoNavBar from '@/components/CoNavBar.vue'
import { submitFeedback } from '@/api/feedback.js'
import { goBack } from '@/utils/nav.js'
import { ensureLogin } from '@/composables/useAuthGate.js'
import { useTimers } from '@/composables/useTimers.js'

const { later } = useTimers()

// 分类：value 与云端枚举对齐（bug/idea/other）；label 给用户看
const CATEGORIES = [
  { value: 'bug', label: '功能问题' },
  { value: 'idea', label: '内容建议' },
  { value: 'other', label: '其它' },
]
const category = ref('bug')
const content = ref('')
const contact = ref('')
const submitting = ref(false)

const valid = computed(() => !!content.value.trim())

const back = () => goBack('/pages/me/index')

async function submit() {
  if (!ensureLogin()) return // 反馈绑 openid，需登录
  if (!valid.value || submitting.value) return
  submitting.value = true
  const ok = await submitFeedback({
    category: category.value,
    content: content.value.trim(),
    contact: contact.value.trim(),
  })
  submitting.value = false
  uni.showToast({ title: ok ? '已收到，谢谢反馈' : '提交失败，请稍后再试', icon: 'none' })
  if (ok) later(back, 600)
}
</script>

<template>
  <view class="co">
    <CoNavBar title="意见反馈" @back="back" />

    <view class="co-body">
      <view class="co-card fb-form">
        <view class="fb-field">
          <text class="fb-label">反馈类型</text>
          <view class="fb-chips">
            <view
              v-for="c in CATEGORIES"
              :key="c.value"
              class="fb-chip ld-press"
              :class="{ on: category === c.value }"
              @tap="category = c.value"
            >
              {{ c.label }}
            </view>
          </view>
        </view>

        <view class="fb-field area">
          <text class="fb-label">反馈内容</text>
          <textarea
            v-model="content"
            class="fb-input fb-area"
            maxlength="500"
            placeholder="说说遇到的问题或你的建议，我们会认真看每一条～"
          />
          <text class="fb-count">{{ content.length }}/500</text>
        </view>

        <view class="fb-field">
          <text class="fb-label">联系方式（选填）</text>
          <input
            v-model="contact"
            class="fb-input"
            maxlength="100"
            placeholder="留个微信 / 手机号，方便我们回访（不强制）"
          />
        </view>
      </view>

      <text class="fb-tip">你的反馈仅用于改进产品与必要回访，不会公开展示。</text>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-save" :class="{ disabled: !valid || submitting }" @tap="submit">
        {{ submitting ? '提交中…' : '提交反馈' }}
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

.fb-form {
  padding: 4px 16px 8px;
}
.fb-field {
  padding: 14px 0;
  border-bottom: 1px solid $line;
}
.fb-field:last-child {
  border-bottom: none;
}
.fb-label {
  display: block;
  font-size: 13px;
  color: $purple-meta;
  margin-bottom: 10px;
}
.fb-chips {
  display: flex;
}
.fb-chip {
  height: 34px;
  padding: 0 16px;
  margin-right: 10px;
  border-radius: $r-pill;
  background: $bg-grey;
  color: $content-2;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fb-chip.on {
  background: $purple-ink;
  color: $white;
}
.fb-input {
  width: 100%;
  font-size: 15px;
  color: $ink;
  line-height: 1.5;
}
.fb-area {
  min-height: 120px;
}
.fb-count {
  display: block;
  text-align: right;
  font-size: 12px;
  color: $content-2;
  margin-top: 6px;
}
.fb-tip {
  display: block;
  font-size: 12px;
  color: $purple-meta;
  line-height: 1.6;
  margin: 16px 16px 4px;
}
</style>
