<script setup>
/**
 * 页脚。对应原型 Sections.jsx 的 Footer。深紫底、白色 logo。
 * 「关于我们 / Lucky 鸭」两链接进关于我们页（守卫 footer-links-wired 锁不回退死链接）。
 */
function goAbout() {
  uni.navigateTo({ url: '/pages/about/index' })
}
</script>

<template>
  <view class="ld-footer">
    <image class="ld-footer-logo" src="/static/logo-white.svg" mode="heightFix" />
    <view class="ld-footer-links">
      <text class="ld-footer-link" @tap="goAbout">关于我们</text>
      <text class="ld-footer-sep">·</text>
      <text class="ld-footer-link" @tap="goAbout">Lucky 鸭</text>
    </view>
    <text class="ld-footer-copy">Copyright © 2026 ZHUO DUCKI LUCKY · All Rights Reserved.</text>
  </view>
</template>

<style lang="scss" scoped>
.ld-footer {
  background: $purple-tab;
  padding: 36px $pad-page 120px; /* 底部留白给浮动 Tab 栏 */
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.ld-footer-logo {
  height: 40px;
  margin-bottom: 18px;
}
.ld-footer-links {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: center;
}
.ld-footer-link {
  font-size: 13px;
  color: $white;
}
.ld-footer-sep {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
}
.ld-footer-copy {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.75);
  margin-top: 12px;
  line-height: 1.6;
  max-width: 260px;
}
</style>
