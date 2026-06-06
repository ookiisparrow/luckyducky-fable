<script setup>
/**
 * 编辑资料页。对应原型 Checkout.jsx 的 ProfileEdit。
 * 头像（相册上传，uni.chooseImage）+ 昵称 + 手机号 + 个性签名。
 * 读写 store/user.js 的 profile；保存后我的页头部即时更新。
 * 复用结算系列 co- 表单样式。
 */
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { useUserStore } from '@/store/user.js'

const user = useUserStore()
const name = ref(user.profile.name || '')
const phone = ref(user.profile.phone || '')
const bio = ref(user.profile.bio || '')
const avatar = ref(user.profile.avatar || '')

const valid = computed(() => !!name.value.trim())

function pickAvatar() {
  uni.chooseImage({
    count: 1,
    success: (res) => {
      avatar.value = res.tempFilePaths && res.tempFilePaths[0]
    },
  })
}
function back() {
  const p = getCurrentPages()
  if (p.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/me/index' })
}
function save() {
  if (!valid.value) return
  user.updateProfile({
    name: name.value.trim(),
    phone: phone.value.trim(),
    bio: bio.value.trim(),
    avatar: avatar.value,
  })
  uni.showToast({ title: '资料已保存', icon: 'none' })
  setTimeout(back, 300)
}
</script>

<template>
  <view class="co">
    <view class="co-header">
      <view class="co-nav">
        <view class="co-nav-btn" @tap="back"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="co-nav-title">编辑资料</text>
        <view class="co-nav-spacer"></view>
      </view>
    </view>

    <view class="co-body">
      <view class="co-card coaddr-form">
        <view class="coaddr-field" @tap="pickAvatar">
          <text class="coaddr-label">头像</text>
          <view class="coprof-avatar">
            <MediaSlot ratio="1/1" :radius="24" :src="avatar" />
            <view class="coprof-cam"><Icon name="camera" :size="11" /></view>
          </view>
        </view>
        <view class="coaddr-field">
          <text class="coaddr-label">昵称</text>
          <input v-model="name" class="coaddr-input" placeholder="给自己起个名字" />
        </view>
        <view class="coaddr-field">
          <text class="coaddr-label">手机号</text>
          <input v-model="phone" class="coaddr-input num" type="number" placeholder="请填写手机号" />
        </view>
        <view class="coaddr-field area">
          <text class="coaddr-label">个性签名</text>
          <textarea
            v-model="bio"
            class="coaddr-input coaddr-area"
            maxlength="60"
            placeholder="写句话介绍下自己吧～"
          />
        </view>
      </view>
      <text class="coprof-tip">点击头像，从相册上传一张照片作为形象</text>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-save" :class="{ disabled: !valid }" @tap="save">保存</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.co {
  min-height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
  color: $content;
}

/* 顶部导航（结算系列同款） */
.co-header {
  background: $white;
  padding: calc(6px + env(safe-area-inset-top)) 0 0;
  border-bottom: 0.5px solid $line;
}
.co-nav {
  display: flex;
  align-items: center;
  padding: 2px 16px 12px;
}
.co-nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.co-nav-btn:active {
  background: rgba(0, 0, 0, 0.06);
}
.co-nav-title {
  flex: 1;
  text-align: center;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.co-nav-spacer {
  width: 34px;
  flex: 0 0 auto;
}

.co-body {
  padding: 12px 14px 4px;
}
.co-card {
  background: $white;
  border-radius: $r-md;
  box-shadow: $shadow-soft;
  overflow: hidden;
  margin-bottom: 12px;
}

/* 表单（与地址编辑同款） */
.coaddr-form {
  padding: 2px 16px;
}
.coaddr-field {
  display: flex;
  align-items: center;
  padding: 15px 0;
  border-bottom: 0.5px solid $line-soft;
}
.coaddr-field:last-child {
  border-bottom: none;
}
.coaddr-field.area {
  align-items: flex-start;
}
.coaddr-label {
  flex: 0 0 64px;
  font-size: 14.5px;
  color: $content;
}
.coaddr-field.area .coaddr-label {
  padding-top: 2px;
}
.coaddr-input {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  color: $ink;
  line-height: 1.5;
}
.coaddr-input.num {
  font-family: $font-sans;
  letter-spacing: 0.02em;
}
.coaddr-area {
  height: 66px;
}

/* 头像 */
.coprof-avatar {
  position: relative;
  width: 48px;
  height: 48px;
}
.coprof-cam {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: $purple;
  border: 2px solid $white;
  display: flex;
  align-items: center;
  justify-content: center;
}
.coprof-tip {
  display: block;
  text-align: center;
  font-size: 12px;
  color: $purple-meta;
  line-height: 1.6;
  margin: 16px 16px 4px;
}

/* 底部保存 */
.co-foot {
  height: calc(78px + env(safe-area-inset-bottom));
}
.co-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  background: $white;
  box-shadow: 0 -1px 0 $line;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
}
.co-save {
  height: 48px;
  border-radius: $r-pill;
  background: $purple;
  color: $white;
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.co-save.disabled {
  background: #cdb8ee;
}
.co-save:active {
  opacity: 0.94;
}
</style>
