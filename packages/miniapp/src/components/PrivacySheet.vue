<script setup>
/**
 * 微信隐私授权半屏弹窗（R27㉒，配套 composables/usePrivacyGate.js）。
 * 仅微信小程序端有意义：wx.onNeedPrivacyAuthorization 触发时由 usePrivacyGate 打开本弹窗。
 * 「同意并继续」须用原生 <button open-type="agreePrivacyAuthorization">（CLAUDE §5 open-type 例外）；
 * 「查看完整指引」打开 mp 后台登记的《小程序用户隐私保护指引》（wx.openPrivacyContract）。
 * ⚠️ 需 mp 后台已登记隐私保护指引 + 真机验（根因#8）；其它端模板为空、不渲染。
 */
import { privacySheetVisible, agreePrivacy, disagreePrivacy } from '@/composables/usePrivacyGate.js'

function onAgree() {
  agreePrivacy('privacy-agree-btn')
}
function onDisagree() {
  disagreePrivacy()
}
function openContract() {
  // #ifdef MP-WEIXIN
  const w = globalThis.wx
  if (w && typeof w.openPrivacyContract === 'function') {
    w.openPrivacyContract({})
  }
  // #endif
}
function openPolicy() {
  uni.navigateTo({ url: '/pages/agreement/index?type=privacy' })
}
</script>

<template>
  <!-- #ifdef MP-WEIXIN -->
  <view v-if="privacySheetVisible" class="ps-mask">
    <view class="ps-sheet">
      <text class="ps-title">隐私保护提示</text>
      <text class="ps-body"
        >为给你提供完整服务，我们需要在调用相关功能前征得你的同意。请阅读<text
          class="ps-link"
          @tap="openPolicy"
          >《隐私政策》</text
        >了解我们如何收集与使用信息，也可<text class="ps-link" @tap="openContract"
          >查看完整指引</text
        >。</text
      >
      <!-- convention-ok：微信隐私授权能力按钮，open-type 属 §5 例外（prettier 将 open-type 换行，逐行规则看不到） -->
      <button
        id="privacy-agree-btn"
        class="ps-btn"
        open-type="agreePrivacyAuthorization"
        @agreeprivacyauthorization="onAgree"
      >
        同意并继续
      </button>
      <text class="ps-skip" @tap="onDisagree">不同意</text>
    </view>
  </view>
  <!-- #endif -->
</template>

<style lang="scss" scoped>
.ps-mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(22, 15, 32, 0.46);
  display: flex;
  align-items: flex-end;
}
.ps-sheet {
  width: 100%;
  background: $white;
  border-radius: 22px 22px 0 0;
  padding: 24px 22px calc(24px + env(safe-area-inset-bottom));
}
.ps-title {
  display: block;
  font-size: 17px;
  font-weight: 600;
  color: $content;
  text-align: center;
  margin-bottom: 14px;
}
.ps-body {
  display: block;
  font-size: 13px;
  line-height: 1.7;
  color: $purple-meta;
  margin-bottom: 18px;
}
.ps-link {
  color: $purple;
}
.ps-btn {
  height: 48px;
  border-radius: $r-pill;
  background: $purple-ink;
  color: $white;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ps-btn::after {
  border: none;
}
.ps-skip {
  display: block;
  text-align: center;
  margin-top: 14px;
  font-size: 13px;
  color: $purple-meta;
}
</style>
