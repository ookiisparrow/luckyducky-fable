<script setup>
/**
 * 编辑 / 新增收货地址页。对应原型 Checkout.jsx 的 AddressEdit。
 * query.id 有值=编辑（从 store 预填），无值=新增。
 * 受控表单 + 设为默认 + 保存 + 删除（仅编辑时）。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import CoSwitch from '@/components/CoSwitch.vue'
import { useAddressStore } from '@/store/address.js'
import { goBack } from '@/utils/nav.js'

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

const back = () => goBack('/pages/address/index')
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
    <CoNavBar :title="editId != null ? '编辑收货地址' : '新增收货地址'" @back="back" />

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
        <CoSwitch :on="isDefault" />
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
@import '../../styles/co.scss';

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
</style>
