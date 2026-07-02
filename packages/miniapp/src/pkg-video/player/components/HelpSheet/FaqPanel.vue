<script setup>
/** 求助面板 · 常见问题（手风琴，展开态留在组件内）。 */
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { HELP_FAQ } from './data.js'

const faqOpen = ref(0)
</script>

<template>
  <view class="hs-detail">
    <view class="hs-faq">
      <view
        v-for="(qa, i) in HELP_FAQ"
        :key="i"
        class="hs-faq-item"
        :class="{ open: faqOpen === i }"
      >
        <view class="hs-faq-q" @tap="faqOpen = faqOpen === i ? -1 : i">
          <text class="hs-faq-q-txt">{{ qa.q }}</text>
          <view class="hs-faq-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
        <view class="hs-faq-a" :class="{ open: faqOpen === i }"
          ><text class="hs-faq-a-txt">{{ qa.a }}</text></view
        >
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.hs-detail {
  padding: 4px 18px 26px;
}
.hs-faq-item {
  border-bottom: 1px solid $line;
}
.hs-faq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 2px;
}
.hs-faq-q-txt {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15.5px;
  color: $ink;
}
.hs-faq-chev {
  display: flex;
  flex: 0 0 auto;
  transition: transform 0.26s;
}
.hs-faq-item.open .hs-faq-chev {
  transform: rotate(90deg);
}
.hs-faq-a {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.26s ease;
}
.hs-faq-a.open {
  max-height: 260px;
}
.hs-faq-a-txt {
  display: block;
  padding: 0 2px 16px;
  font-size: 14px;
  line-height: 1.65;
  color: $content;
}
</style>
