<script setup>
/**
 * 编辑资料页。头像 + 昵称 + 个性签名（手机号已放弃，见规格 §一）。
 * 小程序端用微信「头像昵称填写能力」：头像须原生 button open-type="chooseAvatar"
 * （CLAUDE.md 不用 button 的例外——平台能力，已条件编译隔离 + 样式归零）；
 * 昵称 input type="nickname" 键盘可一键带出微信昵称。其它端保留相册选图。
 * 保存走 store/user.js 的 saveProfile：本地即时生效，小程序端同步云端 users。
 */
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { useUserStore } from '@/store/user.js'
import { goBack } from '@/utils/nav.js'
import { useTimers } from '@/composables/useTimers.js'

const { later } = useTimers()

const user = useUserStore()
const name = ref(user.profile.name || '')
const bio = ref(user.profile.bio || '')
const avatar = ref(user.profile.avatar || '')
const saving = ref(false)

const valid = computed(() => !!name.value.trim())

// 小程序端：微信头像选择回调（自带「用微信头像 / 相册 / 拍照」）
function onChooseAvatar(e) {
  avatar.value = (e.detail && e.detail.avatarUrl) || avatar.value
}
// 其它端：相册选图
function pickAvatar() {
  uni.chooseImage({
    count: 1,
    success: (res) => {
      avatar.value = res.tempFilePaths && res.tempFilePaths[0]
    },
  })
}
const back = () => goBack('/pages/me/index')
async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  const synced = await user.saveProfile({
    name: name.value.trim(),
    bio: bio.value.trim(),
    avatar: avatar.value,
  })
  saving.value = false
  uni.showToast({ title: synced ? '资料已保存' : '已存本机，云端同步失败', icon: 'none' })
  later(back, 300)
}
</script>

<template>
  <view class="co">
    <CoNavBar title="编辑资料" @back="back" />

    <view class="co-body">
      <view class="co-card coaddr-form">
        <view class="coaddr-field">
          <text class="coaddr-label">头像</text>
          <!-- #ifdef MP-WEIXIN -->
          <button class="coprof-avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
            <view class="coprof-avatar">
              <MediaSlot ratio="1/1" :radius="24" :src="avatar" />
              <view class="coprof-cam"><Icon name="camera" :size="11" /></view>
            </view>
          </button>
          <!-- #endif -->
          <!-- #ifndef MP-WEIXIN -->
          <view class="coprof-avatar" @tap="pickAvatar">
            <MediaSlot ratio="1/1" :radius="24" :src="avatar" />
            <view class="coprof-cam"><Icon name="camera" :size="11" /></view>
          </view>
          <!-- #endif -->
        </view>
        <view class="coaddr-field">
          <text class="coaddr-label">昵称</text>
          <!-- #ifdef MP-WEIXIN -->
          <input
            v-model="name"
            type="nickname"
            class="coaddr-input"
            maxlength="20"
            placeholder="给自己起个名字"
          />
          <!-- #endif -->
          <!-- #ifndef MP-WEIXIN -->
          <input v-model="name" class="coaddr-input" maxlength="20" placeholder="给自己起个名字" />
          <!-- #endif -->
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
      <!-- #ifdef MP-WEIXIN -->
      <text class="coprof-tip">点击头像可直接用微信头像；点昵称输入框，键盘上方可一键填入微信昵称</text>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <text class="coprof-tip">点击头像，从相册上传一张照片作为形象</text>
      <!-- #endif -->
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-save" :class="{ disabled: !valid || saving }" @tap="save">
        {{ saving ? '保存中…' : '保存' }}
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 头像（小程序端外层是原生 button，样式全部归零，只当点击热区用） */
.coprof-avatar-btn {
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  line-height: 1;
  border-radius: 0;
  width: auto;
}
.coprof-avatar-btn::after {
  border: none;
}
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
</style>
