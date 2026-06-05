<script setup>
/**
 * 折叠手风琴（一次展开一项）。对应原型 Sections.jsx 的 CollapseGroup。
 * 同时用于「把门槛一一拆掉」(带图标+可选配图) 与「大家都在问」FAQ。
 *
 * props:
 *   items     [{ title, body, icon? }]
 *   variant   'default' | 'faq'
 *   withImage 展开时是否显示灰色配图（卖点区用）
 */
import { ref } from 'vue'
import Icon from './Icon.vue'
import MediaSlot from './MediaSlot.vue'

defineProps({
  items: { type: Array, required: true },
  variant: { type: String, default: 'default' },
  withImage: { type: Boolean, default: false },
})

const open = ref(0) // 默认展开第一项，与原型一致
function toggle(i) {
  open.value = open.value === i ? -1 : i
}
</script>

<template>
  <view class="ld-collapse-group" :class="`v-${variant}`">
    <view v-for="(it, i) in items" :key="i" class="ld-panel" :class="{ open: open === i }">
      <view class="ld-panel-head" @tap="toggle(i)">
        <view v-if="it.icon" class="ld-panel-ico">
          <Icon :name="it.icon" :size="22" />
        </view>
        <text class="ld-panel-title">{{ it.title }}</text>
        <text class="ld-panel-action">{{ open === i ? '收起' : '展开' }}</text>
        <view class="ld-chev">
          <Icon name="chevron-down" :size="20" />
        </view>
      </view>

      <view class="ld-panel-body" :class="{ open: open === i }">
        <view class="ld-panel-inner">
          <text class="ld-panel-text">{{ it.body }}</text>
          <view v-if="withImage" class="ld-panel-img">
            <MediaSlot ratio="1/1" :radius="6" label="放入图片" />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-collapse-group {
  border-radius: $r-md;
  overflow: hidden;
  border: 1px solid $line;
}
.ld-panel {
  border-bottom: 1px solid $line;
  background: $white;
}
.ld-panel:last-child {
  border-bottom: none;
}
.ld-panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
}
.ld-panel-head:active {
  background: rgba(0, 0, 0, 0.02);
}
.ld-panel-ico {
  width: 24px;
  height: 24px;
  display: flex;
  flex: 0 0 auto;
}
.ld-panel-title {
  flex: 1;
  text-align: left;
  font-family: $font-display;
  font-weight: 500;
  font-size: $fs-lead;
  color: rgba(0, 0, 0, 0.9);
}
.ld-panel-action {
  font-family: $font-cn;
  font-size: 15px;
  color: $content-2;
  flex: 0 0 auto;
}
.ld-chev {
  flex: 0 0 auto;
  display: flex;
  transition: transform 0.25s;
}
.ld-panel.open .ld-chev {
  transform: rotate(180deg);
}

/* 展开/收起动画：用 max-height + opacity（全端通用） */
.ld-panel-body {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transition:
    max-height 0.28s ease,
    opacity 0.22s ease;
}
.ld-panel-body.open {
  max-height: 700px;
  opacity: 1;
}
.ld-panel-text {
  display: block;
  padding: 0 16px 18px 50px;
  font-size: 15px;
  line-height: 1.6;
  color: $content;
}
.ld-panel-img {
  padding: 0 16px 18px;
}

/* FAQ 变体 */
.v-faq {
  border: none;
  background: $bg-lilac;
}
.v-faq .ld-panel {
  background: $bg-lilac;
  border-bottom: 1px solid #ece6f2;
}
.v-faq .ld-panel-title {
  font-size: 17px;
}
.v-faq .ld-panel-text {
  padding-left: 16px;
}
</style>
