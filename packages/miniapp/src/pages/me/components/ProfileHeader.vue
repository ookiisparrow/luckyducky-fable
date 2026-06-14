<script setup>
/**
 * 「我」· 紫色资料头（头像 / 昵称 / 等级 / 签名 / 编辑；手机号已放弃，不展示）。从 me 页拆出。
 * 资料数据由 profile 传入；点「编辑」发 edit 事件回父页跳转。样式自成一体（不与其它段共用）。
 */
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { getSystemBar } from '@/utils/systemBar.js'

const props = defineProps({
  profile: { type: Object, default: () => ({}) }, // { name, lv, bio, avatar }
  loggedIn: { type: Boolean, default: false }, // 未登录：展示「点击登录」入口（软门槛）
})
const emit = defineEmits(['edit', 'login'])
// 未登录时整块点击去登录；已登录交给「编辑」按钮（@tap.stop）
function onTapId() {
  if (!props.loggedIn) emit('login')
}

// 顶部留白避开状态栏（注入 CSS 变量；标题居中、胶囊在右上不重叠，无需右避让）
const topStyle = { '--sbh': getSystemBar().statusBarHeight + 'px' }
</script>

<template>
  <view class="my-header my-header-purple" :style="topStyle">
    <view class="my-navrow"><text class="my-navtitle">我的</text></view>
    <view class="my-id" :class="{ tappable: !loggedIn }" @tap="onTapId">
      <view class="my-avatar"><MediaSlot ratio="1/1" :radius="31" :src="profile.avatar" /></view>
      <view class="my-id-text">
        <view class="my-id-nameline">
          <text class="my-id-name">{{ loggedIn ? profile.name : '点击登录' }}</text>
          <text v-if="loggedIn && profile.lv" class="my-lv">{{ profile.lv }}</text>
        </view>
        <text v-if="loggedIn && profile.bio" class="my-id-bio">{{ profile.bio }}</text>
        <text v-else-if="!loggedIn" class="my-id-bio">登录后同步资料与学习进度</text>
      </view>
      <view v-if="loggedIn" class="my-edit" @tap.stop="$emit('edit')">
        <Icon name="pencil" :size="13" /><text>编辑</text>
      </view>
      <view v-else class="my-edit"><text>登录</text></view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.my-header {
  position: relative;
  /* #ifdef MP-WEIXIN */
  padding: calc(8px + var(--sbh, 0px)) 20px 22px;
  /* #endif */
  /* #ifndef MP-WEIXIN */
  padding: calc(8px + env(safe-area-inset-top)) 20px 22px;
  /* #endif */
}
.my-header-purple {
  /* 品牌紫渐变头（原型同款，渐变不入 token） convention-ok */
  background: linear-gradient(160deg, #b79bea 0%, #8c6fd0 58%, #7b5caf 100%);
  color: $white;
}
.my-navrow {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 20px 4px;
  min-height: 40px;
}
.my-navtitle {
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  letter-spacing: 0.04em;
  color: $white;
}
.my-id {
  display: flex;
  align-items: center;
  margin-top: 14px;
}
.my-avatar {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 auto;
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.55),
    0 6px 16px rgba(54, 58, 80, 0.18);
}
.my-id-text {
  min-width: 0;
  flex: 1 1 auto;
  margin: 0 14px;
}
.my-id-nameline {
  display: flex;
  align-items: center;
}
.my-id-name {
  font-family: $font-display;
  font-weight: 700;
  font-size: 22px;
  line-height: 1.15;
  color: $white;
}
.my-lv {
  flex: 0 0 auto;
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.02em;
  padding: 3px 9px;
  border-radius: $r-pill;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.22);
  color: $white;
  margin-left: 8px;
}
.my-id-bio {
  display: block;
  font-size: 12.5px;
  line-height: 1.5;
  margin-top: 7px;
  color: $white;
  opacity: 0.9;
}
.my-edit {
  align-self: flex-start;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.2);
  color: $white;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: $r-pill;
}
.my-edit text {
  margin-left: 4px;
}
.my-edit:active {
  background: rgba(255, 255, 255, 0.32);
}
</style>
