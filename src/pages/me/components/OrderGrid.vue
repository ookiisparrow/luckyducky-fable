<script setup>
/**
 * 「我」· 我的订单九宫格。从 me 页拆出（外层 my-card 与「全部订单」标题仍在父页）。
 * 入口数据由 tabs 传入；点某格发 open(key) 事件回父页跳对应订单页。
 */
import Icon from '@/components/Icon.vue'

defineProps({
  tabs: { type: Array, default: () => [] }, // [{ key, icon, label, badge }, ...]
})
defineEmits(['open'])
</script>

<template>
  <view class="my-orders">
    <view v-for="o in tabs" :key="o.key" class="my-order" @tap="$emit('open', o.key)">
      <view class="my-order-ico">
        <Icon :name="o.icon" :size="25" />
        <text v-if="o.badge" class="my-order-badge">{{ o.badge }}</text>
      </view>
      <text class="my-order-label">{{ o.label }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.my-orders {
  display: flex;
}
.my-order {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 0;
}
.my-order-ico {
  position: relative;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.my-order-badge {
  position: absolute;
  top: -5px;
  right: -8px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: $r-pill;
  background: $red;
  color: $white;
  font-family: $font-sans;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.my-order-label {
  font-size: 12px;
  color: $content;
  margin-top: 7px;
}
</style>
