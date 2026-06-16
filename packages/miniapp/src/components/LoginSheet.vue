<script setup>
/**
 * 登录半屏弹窗（规格 §四-1 第②段）。软门槛 ensureLogin() 触发时弹出（不跳页）。
 * 微信一键登录：勾选同意《用户协议》《隐私政策》→「微信一键登录」——用静默 openid 身份直接登录，
 * 登录环节不采集头像昵称（资料可稍后在「编辑资料」页用微信头像昵称能力补）。
 * 「暂不登录」/点遮罩/✕ 关闭继续逛（软门槛，不强制）。各页放一处 <LoginSheet/>，共享 loginSheetVisible。
 */
import { ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import { useUserStore } from '@/store/user.js'
import { loginSheetVisible } from '@/composables/useAuthGate.js'

const user = useUserStore()
const agreed = ref(false)
const submitting = ref(false)

// 每次打开重置勾选 / 提交态
watch(loginSheetVisible, (v) => {
  if (v) {
    agreed.value = false
    submitting.value = false
  }
})

function toggleAgree() {
  agreed.value = !agreed.value
}
function openAgreement(type) {
  uni.navigateTo({ url: `/pages/agreement/index?type=${type}` })
}
function close() {
  loginSheetVisible.value = false
}
async function doLogin() {
  if (submitting.value) return
  if (!agreed.value) {
    uni.showToast({ title: '请先阅读并勾选同意协议', icon: 'none' })
    return
  }
  submitting.value = true
  await user.consentLogin()
  submitting.value = false
  close()
  uni.showToast({ title: '登录成功', icon: 'none' })
}
</script>

<template>
  <view v-if="loginSheetVisible" class="ls-mask" @tap="close" @touchmove.stop.prevent>
    <view class="ls-sheet" @tap.stop>
      <view class="ls-grab"></view>
      <view class="ls-close" @tap="close"><Icon name="x" :size="18" /></view>

      <view class="ls-head">
        <image class="ls-logo" src="/static/logo-wordmark.svg" mode="heightFix" />
      </view>

      <view class="ls-foot">
        <view class="ls-agree" @tap="toggleAgree">
          <view class="ls-check" :class="{ on: agreed }">
            <Icon v-if="agreed" name="check" :size="12" />
          </view>
          <text class="ls-agree-text">
            我已阅读并同意<text class="ls-link" @tap.stop="openAgreement('user')">《用户协议》</text
            >和<text class="ls-link" @tap.stop="openAgreement('privacy')">《隐私政策》</text>
          </text>
        </view>
        <view class="ls-btn" :class="{ disabled: !agreed || submitting }" @tap="doLogin">
          {{ submitting ? '登录中…' : '微信一键登录' }}
        </view>
        <text class="ls-skip" @tap="close">暂不登录</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ls-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(22, 15, 32, 0.46);
  display: flex;
  align-items: flex-end;
  animation: ls-fade 0.3s ease;
}
@keyframes ls-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.ls-sheet {
  position: relative;
  width: 100%;
  background: $white;
  border-radius: 22px 22px 0 0;
  padding: 0 22px calc(28px + env(safe-area-inset-bottom));
  box-shadow: 0 -12px 40px rgba(20, 12, 35, 0.22);
  animation: ls-up 0.42s cubic-bezier(0.2, 0.85, 0.25, 1);
}
@keyframes ls-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
.ls-grab {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: $purple-line;
  opacity: 0.5;
  margin: 10px auto 0;
}
.ls-close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $purple-meta;
}
.ls-head {
  display: flex;
  justify-content: center;
  margin: 30px 0 28px;
}
.ls-logo {
  height: 40px;
}
.ls-foot {
  padding-top: 0;
}
.ls-agree {
  display: flex;
  align-items: flex-start;
  margin-bottom: 14px;
}
.ls-check {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin-right: 8px;
  border-radius: 50%;
  border: 1px solid $purple-line;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $white;
}
.ls-check.on {
  background: $purple;
  border-color: $purple;
}
.ls-agree-text {
  flex: 1 1 auto;
  font-size: 12px;
  line-height: 1.5;
  color: $purple-meta;
}
.ls-link {
  color: $purple;
}
.ls-btn {
  height: 50px;
  border-radius: $r-pill;
  background: $purple-ink;
  color: $white;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ls-btn.disabled {
  opacity: 0.45;
}
.ls-btn:active {
  background: $purple-ink-active;
}
.ls-skip {
  display: block;
  text-align: center;
  margin-top: 16px;
  font-size: 13px;
  color: $purple-meta;
}
</style>
