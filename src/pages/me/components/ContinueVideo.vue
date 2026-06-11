<script setup>
/**
 * 「我」· 继续学习的视频卡 + 续播条。从 me 页拆出（外层 my-card 与「全部教程」标题仍在父页）。
 * 视频进度等数据由 v 传入；点视频或「继续观看」发 watch 事件回父页跳播放页。
 */
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { parseDur } from '@/utils/format.js'

const props = defineProps({
  v: { type: Object, default: () => ({}) }, // { at, dur, ep, name, pct }
})
defineEmits(['watch'])

// 还剩 X 分钟：由 at/dur 现算（原为写死文案）；不足 1 分钟按 1 算，算不出不显示
const leftMin = computed(() => {
  const left = parseDur(props.v.dur) - parseDur(props.v.at)
  return left > 0 ? Math.max(1, Math.round(left / 60)) : 0
})
</script>

<template>
  <view class="my-video" @tap="$emit('watch')">
    <MediaSlot ratio="16/9" />
    <view class="my-video-scrim"></view>
    <text class="my-video-dur">{{ v.at }} / {{ v.dur }}</text>
    <view class="my-play"><Icon name="play-ink" :size="22" /></view>
    <view class="my-video-cap">
      <text class="my-video-ep">{{ v.ep }}</text>
      <text class="my-video-name">{{ v.name }}</text>
    </view>
    <view class="my-prog"><view class="my-prog-fill" :style="{ width: v.pct + '%' }"></view></view>
  </view>
  <view class="my-resume">
    <text class="my-resume-text"
      >看到 <text class="t">{{ v.at }}</text
      ><text v-if="leftMin"> · 还剩 {{ leftMin }} 分钟</text></text
    >
    <view class="my-resume-btn" @tap="$emit('watch')">
      <Icon name="play" :size="15" /><text>继续观看</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.my-video {
  position: relative;
  width: 100%;
  border-radius: $r-md;
  overflow: hidden;
}
.my-video-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    to top,
    rgba(20, 14, 30, 0.62) 0%,
    rgba(20, 14, 30, 0.12) 42%,
    rgba(20, 14, 30, 0) 70%
  );
}
.my-video-dur {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  font-family: $font-sans;
  font-size: 11px;
  color: $white;
  background: rgba(0, 0, 0, 0.5);
  padding: 3px 8px;
  border-radius: $r-pill;
}
.my-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 2;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
}
.my-video-cap {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  color: $white;
}
.my-video-ep {
  display: block;
  font-family: $font-sans;
  font-size: 11px;
  letter-spacing: 0.04em;
  opacity: 0.85;
}
.my-video-name {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 16px;
  line-height: 1.25;
  margin-top: 3px;
}
.my-prog {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.32);
  z-index: 3;
}
.my-prog-fill {
  height: 100%;
  background: $purple;
}
.my-resume {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 13px;
}
.my-resume-text {
  font-size: 13px;
  color: $content-2;
}
.my-resume-text .t {
  font-family: $font-sans;
  font-weight: 600;
  color: $content;
}
.my-resume-btn {
  display: flex;
  align-items: center;
  background: $purple-ink;
  color: $white;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 14px;
  padding: 9px 20px;
}
.my-resume-btn text {
  margin-left: 6px;
}
.my-resume-btn:active {
  opacity: 0.94;
}

</style>
