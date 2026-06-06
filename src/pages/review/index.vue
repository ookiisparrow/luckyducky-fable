<script setup>
/**
 * 评价晒单页。对应原型 Checkout.jsx 的 ReviewSubmit。
 * 入口：已完成订单「评价晒单」。评分 + 标签 + 文字 + 晒图(灰占位) + 匿名。
 * 「发布评价」当前 Toast（无真实评价系统）。
 */
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { goBack } from '@/utils/nav.js'

const REV_TAGS = ['教程清晰', '很可爱', '适合新手', '包装用心', '物流快', '线材好']
const REV_LABEL = ['', '非常不满', '不满意', '一般', '满意', '非常满意']
const product = { name: '微笑小鸡 · 入门套装', spec: '鹅黄' }

const rating = ref(5)
const tags = ref(['很可爱', '教程清晰'])
const text = ref('')
const photoCount = ref(1)
const anon = ref(false)

function toggleTag(t) {
  const i = tags.value.indexOf(t)
  if (i >= 0) tags.value.splice(i, 1)
  else tags.value.push(t)
}
function addPhoto() {
  if (photoCount.value < 6) photoCount.value++
}
function rmPhoto() {
  if (photoCount.value > 0) photoCount.value--
}
const back = () => goBack('/pages/me/index')
function publish() {
  uni.showToast({ title: '评价已发布 · 感谢分享~', icon: 'none' })
  setTimeout(back, 400)
}
</script>

<template>
  <view class="co">
    <CoNavBar title="评价晒单" @back="back" />

    <view class="co-body">
      <!-- 商品 + 评分 -->
      <view class="co-card corev-top">
        <view class="corev-prod">
          <view class="corev-prod-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="corev-prod-mid">
            <text class="corev-prod-name">{{ product.name }}</text>
            <text v-if="product.spec" class="co-item-spec">{{ product.spec }}</text>
          </view>
        </view>
        <view class="corev-rate">
          <view class="corev-rate-stars">
            <text
              v-for="n in 5"
              :key="n"
              class="corev-star"
              :class="{ on: n <= rating }"
              @tap="rating = n"
              >★</text
            >
          </view>
          <text class="corev-rate-label">{{ REV_LABEL[rating] }}</text>
        </view>
      </view>

      <!-- 标签 -->
      <view class="co-card corev-sec">
        <text class="corev-sec-title">大家都说</text>
        <view class="corev-tags">
          <view
            v-for="t in REV_TAGS"
            :key="t"
            class="corev-tag"
            :class="{ on: tags.includes(t) }"
            @tap="toggleTag(t)"
            >{{ t }}</view
          >
        </view>
      </view>

      <!-- 文字 + 晒图 -->
      <view class="co-card corev-sec">
        <textarea
          v-model="text"
          class="corev-text"
          maxlength="500"
          placeholder="说说你的钩织体验，分享给想入坑的小伙伴吧～"
        />
        <text class="corev-count">{{ text.length }}/500</text>
        <view class="corev-photos">
          <view v-for="n in photoCount" :key="n" class="corev-photo">
            <MediaSlot ratio="1/1" />
            <view class="corev-photo-rm" @tap.stop="rmPhoto"><Icon name="x" :size="12" /></view>
          </view>
          <view v-if="photoCount < 6" class="corev-add" @tap="addPhoto">
            <Icon name="camera-meta" :size="22" />
            <text>晒图</text>
          </view>
        </view>
      </view>

      <!-- 匿名 -->
      <view class="co-card corev-anon" @tap="anon = !anon">
        <text class="corev-anon-text">匿名评价</text>
        <text class="corev-anon-sub">隐藏你的昵称与头像</text>
        <view class="co-switch" :class="{ on: anon }"><view class="co-switch-dot"></view></view>
      </view>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-save" @tap="publish">发布评价</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 商品 + 评分 */
.corev-top {
  padding: 16px;
}
.corev-prod {
  display: flex;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 0.5px solid $line-soft;
}
.corev-prod-img {
  width: 52px;
  height: 52px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.corev-prod-mid {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.corev-prod-name {
  font-size: 15px;
  color: $ink;
  line-height: 1.3;
}
.corev-rate {
  display: flex;
  align-items: center;
  padding-top: 16px;
}
.corev-rate-stars {
  display: flex;
}
.corev-star {
  font-size: 30px;
  line-height: 1;
  color: $line-strong;
  margin-right: 6px;
}
.corev-star.on {
  color: $duck-deep;
}
.corev-rate-label {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $duck-orange;
  margin-left: 8px;
}

/* 标签 */
.corev-sec {
  padding: 16px;
}
.corev-sec-title {
  display: block;
  font-size: 13px;
  color: $content-2;
  margin-bottom: 12px;
}
.corev-tags {
  display: flex;
  flex-wrap: wrap;
}
.corev-tag {
  font-size: 13px;
  color: $content;
  background: $bg-grey;
  border: 1px solid transparent;
  border-radius: $r-pill;
  padding: 8px 15px;
  margin: 0 9px 9px 0;
}
.corev-tag.on {
  background: $bg-lilac;
  color: $purple;
  border-color: $purple-line;
}

/* 文字 + 晒图 */
.corev-text {
  width: 100%;
  min-height: 88px;
  font-size: 15px;
  line-height: 1.6;
  color: $ink;
}
.corev-count {
  display: block;
  text-align: right;
  font-family: $font-sans;
  font-size: 11px;
  color: $content-2;
  margin-top: 4px;
}
.corev-photos {
  display: flex;
  flex-wrap: wrap;
  margin-top: 14px;
}
.corev-photo {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: $r-sm;
  overflow: hidden;
  margin: 0 8px 8px 0;
}
.corev-photo-rm {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.corev-add {
  width: 72px;
  height: 72px;
  border: 1px dashed $line-strong;
  border-radius: $r-sm;
  background: $bg-grey;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: $content-2;
}
.corev-add text {
  font-size: 11px;
  margin-top: 4px;
}
.corev-add:active {
  border-color: $purple;
}

/* 匿名 */
.corev-anon {
  display: flex;
  align-items: center;
  padding: 16px;
}
.corev-anon-text {
  font-size: 15px;
  color: $ink;
}
.corev-anon-sub {
  flex: 1;
  font-size: 12px;
  color: $content-2;
  margin-left: 10px;
}
</style>
