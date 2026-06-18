<script setup>
/**
 * 「我」个人中心主页。对应原型 MyProfile.jsx（学习中枢版 A）。
 * 紫色资料头 + 继续学习卡 + 我的订单 + 客服/地址 列表。
 *
 * 真实接通：「继续学习」卡 → 云端最近观看点（progress store，无记录回退样例）；
 *   「全部教程」→ 首次进视频课先放欢迎引导页、之后直达目录；
 *   订单九宫格 / 全部订单 → 订单列表页（真实订单，角标按 store 数量）；退款/售后仍样例（P4 接真）。
 *   客服 → 独立微信客服会话（openCustomerService·R18/⑨ 升级·决策§19）。
 *
 * 图位走 MediaSlot 灰占位；my-* 类名沿用原型。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import TabBar from '@/components/TabBar.vue'
import LoginSheet from '@/components/LoginSheet.vue'
import ProfileHeader from './components/ProfileHeader.vue'
import ContinueVideo from './components/ContinueVideo.vue'
import OrderGrid from './components/OrderGrid.vue'
import { CONTINUE_VIDEO as V, ORDER_TABS } from '@/data/profile.js'
import { useUserStore } from '@/store/user.js'
import { useOrdersStore } from '@/store/orders.js'
import { useCoursesStore } from '@/store/courses.js'
import { useProgressStore } from '@/store/progress.js'
import { openCustomerService } from '@/utils/customerService.js'
import { useActivationStore } from '@/store/activation.js'
import { STORAGE_KEYS } from '@/constants/storage.js'
import { mmss } from '@/utils/format.js'
import { ensureLogin } from '@/composables/useAuthGate.js'
import { useExitGuard } from '@/composables/useExitGuard.js'

const user = useUserStore()
const orders = useOrdersStore()
const courses = useCoursesStore()
const progress = useProgressStore()
const act = useActivationStore()
// 返回拦截：第一次返回弹「再按一次退出」，2s 内再返回才真退出（配模板 scroll-view + page-container）
const { backGuard, onBackGuard } = useExitGuard()

// 角标 = 各状态真实订单数（只标可办理的三态，已完成/售后不标）
const BADGE_STATUS = { pending: 'pending', toship: 'paid', toreceive: 'shipped' }
const orderTabs = computed(() =>
  ORDER_TABS.map((t) => ({ ...t, badge: orders.countByStatus[BADGE_STATUS[t.key]] || 0 }))
)
onShow(() => {
  orders.load()
  courses.load()
  act.loadMine() // 我的已激活课程：判断「未激活」空态
  progress.load(true) // 强刷：刚看完一段回到「我」页，继续学习卡立即更新
})
// 下拉刷新：内容在整页 scroll-view 内滚动，页面级 enablePullDownRefresh 在 mp 不触发（根因#8），
// 用 scroll-view refresher 强刷订单/课程/激活/进度。
const refreshing = ref(false)
async function onRefresh() {
  refreshing.value = true
  try {
    await Promise.all([
      orders.load(true),
      courses.load(true),
      act.loadMine(true),
      progress.load(true),
    ])
  } finally {
    refreshing.value = false // 收转圈（失败也收，不卡）
  }
}
// 未激活任何课程（act 已加载且我的课程为空）→ 继续学习卡显示空态
const noCourse = computed(() => act.loaded && act.mine.length === 0)

// 继续学习卡：云端最近观看点定位课时与章节；无云 / 无记录回退样例 V
const cont = computed(() => {
  const lw = progress.lastWatch
  if (!lw) return V
  const ls = courses.allLessons
  const i = ls.findIndex((l) => l.id === lw.lessonId)
  if (i < 0) return V
  const l = ls[i]
  const ch = courses.current.chapters.find((c) => c.id === l.chapter)
  const durSec = lw.dur > 0 ? lw.dur : 0
  return {
    ep: `${ch ? ch.title : ''} · 第 ${i + 1} 集`,
    name: l.name,
    at: mmss(lw.at),
    dur: durSec > 0 ? mmss(durSec) : l.dur,
    pct: durSec > 0 ? Math.min(100, Math.round((lw.at / durSec) * 100)) : 0,
    lessonId: l.id,
  }
})

function continueWatch() {
  if (!ensureLogin()) return // 续播 = 进课，需登录
  // 续播云端最近观看的那节；无记录回退样例对应的 l3
  uni.navigateTo({ url: `/pages/player/index?id=${cont.value.lessonId || 'l3'}` })
}
function allCourses() {
  // 首次进视频课先看欢迎引导，之后直达目录（浏览目录不挡，进具体课时再验登录）
  const seen = uni.getStorageSync(STORAGE_KEYS.VIDEO_INTRO_SEEN)
  uni.navigateTo({ url: seen ? '/pages/catalog/index' : '/pages/welcome/index' })
}
// 未激活空态：去逛逛买材料包（扫码激活后才有课程）
function goShop() {
  uni.reLaunch({ url: '/pages/index/index' })
}
function onOrder(key) {
  if (!ensureLogin()) return // 我的订单 = 个人数据，需登录
  if (key === 'refund') uni.navigateTo({ url: '/pages/aftersales/index' })
  else uni.navigateTo({ url: `/pages/order-list/index?tab=${key}` })
}
function allOrders() {
  if (!ensureLogin()) return
  uni.navigateTo({ url: '/pages/order-list/index' })
}
function goAddress() {
  if (!ensureLogin()) return
  uni.navigateTo({ url: '/pages/address/index' })
}
function goEditProfile() {
  if (!ensureLogin()) return
  uni.navigateTo({ url: '/pages/profile-edit/index' })
}
// 资料头未登录态点击 → 登录页
function goLogin() {
  ensureLogin()
}
</script>

<template>
  <view class="my-profile">
    <scroll-view
      scroll-y
      :show-scrollbar="false"
      refresher-enabled
      :refresher-triggered="refreshing"
      class="my-scroll"
      @refresherrefresh="onRefresh"
    >
      <!-- 紫色资料头 -->
      <ProfileHeader
        :profile="user.profile"
        :logged-in="user.isLogin"
        @edit="goEditProfile"
        @login="goLogin"
      />

      <view class="my-stack">
        <!-- 继续学习 -->
        <view class="my-card my-card-pad">
          <view class="my-sec-head">
            <view class="my-sec-title">
              <view class="my-sec-ico"><Icon name="graduation-cap" :size="19" /></view>
              <text>继续学习</text>
            </view>
            <view class="my-sec-more" @tap="allCourses">
              <text>全部教程</text><Icon name="chevron-right" :size="14" />
            </view>
          </view>

          <ContinueVideo v-if="!noCourse" :v="cont" @watch="continueWatch" />
          <view v-else class="my-course-empty">
            <view class="my-course-empty-ico"><Icon name="graduation-cap" :size="26" /></view>
            <text class="my-course-empty-title">还没有课程</text>
            <text class="my-course-empty-sub">购买材料包、扫码激活后即可开始视频跟学</text>
            <view class="my-course-empty-btn" @tap="goShop">
              <text>去逛逛</text><Icon name="chevron-right" :size="15" />
            </view>
          </view>
        </view>

        <!-- 我的订单 -->
        <view class="my-card my-card-pad">
          <view class="my-sec-head">
            <view class="my-sec-title"><text>我的订单</text></view>
            <view class="my-sec-more" @tap="allOrders">
              <text>全部订单</text><Icon name="chevron-right" :size="14" />
            </view>
          </view>
          <OrderGrid :tabs="orderTabs" @open="onOrder" />
        </view>

        <!-- 客服 / 地址 -->
        <view class="my-card my-list">
          <!-- 联系客服：调 openCustomerService 进独立微信客服会话（R18/⑨ 升级·决策§19；helper 内吃 mp/非 mp） -->
          <view class="my-row ld-tap" @tap="openCustomerService">
            <view class="my-row-ico"><Icon name="headphones-meta" :size="22" /></view>
            <text class="my-row-label">联系客服</text>
            <view class="my-row-chev"><Icon name="chevron-right" :size="18" /></view>
          </view>
          <view class="my-row divided ld-tap" @tap="goAddress">
            <view class="my-row-ico"><Icon name="map-pin-meta" :size="22" /></view>
            <text class="my-row-label">地址管理</text>
            <view class="my-row-chev"><Icon name="chevron-right" :size="18" /></view>
          </view>
        </view>
      </view>

      <view class="my-pad-bottom"></view>
    </scroll-view>

    <TabBar active="me" />
    <LoginSheet />
    <!-- #ifdef MP-WEIXIN -->
    <!-- 返回拦截（PoC）：内容在上方 scroll-view 内滚，page-container 武装拦返回不影响内部滚动 -->
    <page-container :show="backGuard" :overlay="false" :duration="0" @beforeleave="onBackGuard" />
    <!-- #endif -->
  </view>
</template>

<style lang="scss" scoped>
.my-profile {
  height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
}
/* PoC：内容滚动容器（撑满视口，内部滚动；page-container 锁页面滚动锁不到这里） */
.my-scroll {
  height: 100vh;
}

/* 内容堆叠 */
.my-stack {
  padding: 8px 20px 0;
}
.my-card {
  background: $white;
  border-radius: $r-md;
  border: 1px solid $line;
  box-shadow: $shadow-soft;
  margin-bottom: 16px;
}
.my-card-pad {
  padding: 16px;
}
.my-pad-bottom {
  height: 112px;
}

.my-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 14px;
}
.my-sec-title {
  display: flex;
  align-items: center;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.my-sec-ico {
  display: flex;
  margin-right: 7px;
}
.my-sec-more {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: $content-2;
}
.my-sec-more text {
  margin-right: 2px;
}

/* 列表行 */
.my-list {
  overflow: hidden;
}
.my-row {
  display: flex;
  align-items: center;
  padding: 15px 16px;
}
.my-row.divided {
  border-top: 1px solid $line;
}
.my-row-ico {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 13px;
}
.my-row-label {
  flex: 1 1 auto;
  font-size: 15px;
  color: $ink;
}
.my-row-chev {
  display: flex;
}

/* 继续学习 · 未激活课程空态 */
.my-course-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 18px 16px 8px;
}
.my-course-empty-ico {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: $bg-lilac;
  display: flex;
  align-items: center;
  justify-content: center;
}
.my-course-empty-title {
  font-size: 16px;
  font-weight: 600;
  color: $ink;
  margin-top: 14px;
}
.my-course-empty-sub {
  font-size: 13px;
  line-height: 1.6;
  color: $purple-meta;
  margin-top: 8px;
}
.my-course-empty-btn {
  display: flex;
  align-items: center;
  margin-top: 16px;
  background: $purple-ink;
  color: $white;
  border-radius: $r-pill;
  font-size: 14px;
  font-weight: 600;
  padding: 9px 14px 9px 18px;
}
.my-course-empty-btn:active {
  opacity: 0.94;
}
</style>
