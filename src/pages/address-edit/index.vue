<script setup>
/**
 * 编辑 / 新增收货地址页。对应原型 Checkout.jsx 的 AddressEdit。
 * query.id 有值=编辑（从 store 预填），无值=新增。
 * 受控表单 + 设为默认 + 保存 + 删除（仅编辑时）。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import { useAddressStore } from '@/store/address.js'

const address = useAddressStore()
const editId = ref(null)
const name = ref('')
const phone = ref('')
const region = ref('')
const detail = ref('')
const isDefault = ref(true)

onLoad((q) => {
  if (q && q.id !== undefined && q.id !== '') {
    const a = address.get(Number(q.id))
    if (a) {
      editId.value = a.id
      name.value = a.name
      phone.value = a.phone
      region.value = a.region || ''
      detail.value = a.detail || ''
      isDefault.value = !!a.isDefault
    }
  }
})

const valid = computed(
  () => name.value.trim() && phone.value.trim() && region.value.trim() && detail.value.trim(),
)

function back() {
  const p = getCurrentPages()
  if (p.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/address/index' })
}
function save() {
  if (!valid.value) return
  address.save({
    id: editId.value ?? undefined,
    name: name.value.trim(),
    phone: phone.value.trim(),
    region: region.value.trim(),
    detail: detail.value.trim(),
    isDefault: isDefault.value,
  })
  uni.showToast({ title: editId.value != null ? '地址已保存' : '地址已添加', icon: 'none' })
  setTimeout(back, 300)
}
function del() {
  uni.showModal({
    title: '删除地址',
    content: '确定删除这条收货地址吗？',
    confirmText: '删除',
    success: (r) => {
      if (r.confirm) {
        address.remove(editId.value)
        uni.showToast({ title: '已删除', icon: 'none' })
        setTimeout(back, 300)
      }
    },
  })
}
</script>

<template>
  <view class="co">
    <view class="co-header">
      <view class="co-nav">
        <view class="co-nav-btn" @tap="back"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="co-nav-title">{{ editId != null ? '编辑收货地址' : '新增收货地址' }}</text>
        <view class="co-nav-spacer"></view>
      </view>
    </view>

    <view class="co-body">
      <view class="co-card coaddr-form">
        <view class="coaddr-field">
          <text class="coaddr-label">收货人</text>
          <input v-model="name" class="coaddr-input" placeholder="请填写收货人姓名" />
        </view>
        <view class="coaddr-field">
          <text class="coaddr-label">手机号</text>
          <input v-model="phone" class="coaddr-input num" type="number" placeholder="请填写手机号" />
        </view>
        <view class="coaddr-field">
          <text class="coaddr-label">所在地区</text>
          <input v-model="region" class="coaddr-input" placeholder="省 / 市 / 区" />
        </view>
        <view class="coaddr-field area">
          <text class="coaddr-label">详细地址</text>
          <textarea v-model="detail" class="coaddr-input coaddr-area" placeholder="街道、楼牌号、门牌号等" />
        </view>
      </view>

      <view class="co-card coaddr-default" @tap="isDefault = !isDefault">
        <text class="coaddr-default-text">设为默认地址</text>
        <view class="co-switch" :class="{ on: isDefault }"><view class="co-switch-dot"></view></view>
      </view>

      <view v-if="editId != null" class="co-card coaddr-delete" @tap="del">
        <Icon name="trash-2" :size="17" /><text>删除收货地址</text>
      </view>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-save" :class="{ disabled: !valid }" @tap="save">保存并使用</view>
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

/* 表单 */
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

/* 设为默认 */
.coaddr-default {
  display: flex;
  align-items: center;
  padding: 16px;
}
.coaddr-default-text {
  flex: 1;
  font-size: 15px;
  color: $ink;
}
.co-switch {
  width: 44px;
  height: 26px;
  border-radius: $r-pill;
  background: $line-strong;
  flex: 0 0 auto;
  position: relative;
  transition: background 0.2s;
}
.co-switch.on {
  background: $purple;
}
.co-switch-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: $white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}
.co-switch.on .co-switch-dot {
  transform: translateX(18px);
}

/* 删除 */
.coaddr-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 15px;
  color: $red;
  font-size: 15px;
}
.coaddr-delete text {
  margin-left: 7px;
}
.coaddr-delete:active {
  background: #fef2f2;
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
