<script setup>
/**
 * 视频教程 · 欢迎流（变体 A · 沉浸全屏）。对应原设计 Welcome.jsx 的 VariantA。
 *
 * 两种进入方式（规格 §四-2 两页式课程欢迎页）：
 * - 无码（「全部教程」/「重看引导」）：通用引导 2 屏 → 开始学习进目录（原行为）。
 * - 带码（扫激活码：?code= / 小程序码 scene / 普通链接二维码 ?q=，决策 §13）：onLoad 即调 activateCourse 绑定账户，
 *   按结果分流——'activated'（新激活/未确认）→ 课程引导屏 + 确认屏（明示「确认开始
 *   观看即失去该件商品退货权」，确认是进课唯一闸门）；'mine'（已确认）→「继续学习」
 *   直接进课；码无效 / 已被他人激活 / 网络错 → 错误屏。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import { getSystemBarVars } from '@/utils/systemBar.js'
import { STORAGE_KEYS } from '@/constants/storage.js'
import { useActivationStore } from '@/store/activation.js'
import { useCoursesStore } from '@/store/courses.js'
import { useContentStore } from '@/store/content.js'
import { parseActivationCode } from '@/api/activation.js'
import { BRAND_NAME } from '@/constants/brand.js'

const act = useActivationStore()
const coursesStore = useCoursesStore()
// 激活页背景图：控制台（橱窗）可上传，存 content.home.activationBg（云存储 fileID·mp <image> 原生渲染）；
// 无配置回退 /static/hero-full.jpg。扫码进站是新启动，主动拉一次内容。
const contentStore = useContentStore()
contentStore.load()

const page = ref(0) // 0=欢迎/引导屏 1=开始/确认屏
const mode = ref('intro') // intro 通用引导 | confirm 激活待确认 | mine 已解锁继续学习 | error
const code = ref('')
const courseId = ref('')
const courseTitle = ref('')
const errText = ref('')
const confirming = ref(false)

// 顶部关闭/返回/logo 避状态栏与胶囊：动态值经 CSS 变量进 scoped
const barVars = getSystemBarVars()

// 解析激活码：?code= / scene / 普通链接二维码 ?q= 三轨，逻辑收口在 api/activation.js（带测试）

onLoad(async (o) => {
  const c = parseActivationCode(o)
  if (!c) return // 通用引导模式
  code.value = c
  mode.value = 'loading'
  const res = await act.activate(c)
  if (res && res.ok) {
    courseId.value = res.courseId
    await coursesStore.load()
    const course = coursesStore.getById(res.courseId)
    courseTitle.value = course ? course.title : '你的专属课程'
    mode.value = res.state === 'mine' ? 'mine' : 'confirm'
  } else {
    mode.value = 'error'
    const err = res && res.error
    errText.value =
      err === 'CODE_TAKEN'
        ? '这个激活码已经被其他账号使用了。如是家人代扫，请用购买时的微信扫码。'
        : err === 'INVALID_CODE'
          ? '激活码无效，请核对包装内的二维码后重试。'
          : '网络开小差了，请稍后再扫一次。'
  }
})

// 标记「看过」（之后「全部教程」不再自动弹欢迎页，可在目录页「重看引导」再看）。
// 只在用户「开始学习」或「关闭」这类明确动作时才记 —— 之前是在 onLoad 一进页面就记，
// 导致「打开后没看就被动关掉」也算看过、下次不再自动引导。改成动作触发更贴合真实意图。
function markSeen() {
  uni.setStorageSync(STORAGE_KEYS.VIDEO_INTRO_SEEN, true)
}

function next() {
  page.value = 1
}
function back() {
  page.value = 0
}
function close() {
  markSeen()
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/index/index' })
}
function start() {
  markSeen()
  // 用 redirectTo 替换掉欢迎页：返回时直接回上一层，不再夹一屏引导
  uni.redirectTo({ url: '/pages/catalog/index' })
}
// 确认开始观看：写 enteredAt（退货权法律节点）→ 解锁进目录
async function confirmStart() {
  if (confirming.value) return
  confirming.value = true
  const res = await act.confirm(code.value, courseId.value)
  confirming.value = false
  if (res && res.ok) {
    markSeen()
    uni.redirectTo({ url: '/pages/catalog/index' })
  } else {
    uni.showToast({ title: '确认失败，请重试', icon: 'none' })
  }
}
</script>

<template>
  <view class="wel" :style="barVars">
    <image
      class="wel-photo"
      :src="contentStore.activationBg || '/static/hero-full.jpg'"
      mode="aspectFill"
    />
    <view class="wel-scrim"></view>

    <!-- ===== 通用引导（无码进入，原行为不变） ===== -->
    <template v-if="mode === 'intro'">
      <!-- 屏 0：欢迎 -->
      <view v-if="page === 0" class="wel-screen" @tap="next">
        <view class="wel-close" @tap.stop="close"><Icon name="x" :size="20" /></view>
        <view class="wel-top">
          <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
        </view>
        <view class="wel-body">
          <text class="wel-eyebrow">VIDEO COURSE · 视频教程</text>
          <view class="wel-display">
            <text class="wel-display-l">开启你的</text>
            <text class="wel-display-l">钩织之旅</text>
          </view>
          <text class="wel-lead"
            >欢迎来到 {{ BRAND_NAME }}，跟着视频一针一线，钩出属于你的幸运。</text
          >
          <view class="wel-foot">
            <view class="wel-dots"><view class="dot on"></view><view class="dot"></view></view>
            <view class="wel-mini" @tap.stop="next"
              ><text>下一页</text><Icon name="arrow-right" :size="16"
            /></view>
          </view>
        </view>
      </view>

      <!-- 屏 1：开始 -->
      <view v-else class="wel-screen">
        <view class="wel-close back" @tap="back"><Icon name="chevron-left" :size="22" /></view>
        <view class="wel-top">
          <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
        </view>
        <view class="wel-body">
          <text class="wel-eyebrow">准备好了吗</text>
          <view class="wel-display">
            <text class="wel-display-l">现在，</text>
            <text class="wel-display-l">从第一针开始</text>
          </view>
          <text class="wel-lead"
            >我们已为你备好每一步视频，跟着钩就好，慢慢来，第一次也能完成。</text
          >
          <view class="wel-cta" @tap="start">
            <text class="wel-cta-text">开始学习</text>
            <Icon name="arrow-right" :size="18" />
          </view>
          <view class="wel-dots"><view class="dot"></view><view class="dot on"></view></view>
        </view>
      </view>
    </template>

    <!-- ===== 扫码激活中 ===== -->
    <view v-else-if="mode === 'loading'" class="wel-screen">
      <view class="wel-top">
        <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
      </view>
      <view class="wel-body">
        <text class="wel-eyebrow">正在激活课程…</text>
      </view>
    </view>

    <!-- ===== 扫码激活：课程引导 + 确认（两页式，规格 §四-2/3） ===== -->
    <template v-else-if="mode === 'confirm'">
      <!-- 第 1 页：课程引导（按码渲染该课程） -->
      <view v-if="page === 0" class="wel-screen" @tap="next">
        <view class="wel-close" @tap.stop="close"><Icon name="x" :size="20" /></view>
        <view class="wel-top">
          <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
        </view>
        <view class="wel-body">
          <text class="wel-eyebrow">COURSE ACTIVATED · 课程已激活</text>
          <view class="wel-display">
            <text class="wel-display-l">{{ courseTitle }}</text>
          </view>
          <text class="wel-lead"
            >恭喜！材料包的配套视频课已经就绪，将绑定你的微信账号、永久有效。点「下一页」了解开课须知。</text
          >
          <view class="wel-foot">
            <view class="wel-dots"><view class="dot on"></view><view class="dot"></view></view>
            <view class="wel-mini" @tap.stop="next"
              ><text>下一页</text><Icon name="arrow-right" :size="16"
            /></view>
          </view>
        </view>
      </view>

      <!-- 第 2 页：确认开始观看（退货权法律节点，明示后果） -->
      <view v-else class="wel-screen">
        <view class="wel-close back" @tap="back"><Icon name="chevron-left" :size="22" /></view>
        <view class="wel-top">
          <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
        </view>
        <view class="wel-body">
          <text class="wel-eyebrow">开始前 · 请确认</text>
          <view class="wel-display">
            <text class="wel-display-l">确认开始观看</text>
            <text class="wel-display-l">视频教程</text>
          </view>
          <text class="wel-lead"
            >请注意：确认开始观看后，这件商品将不再支持退货；课程永久有效，可随时反复观看。</text
          >
          <view class="wel-cta" @tap="confirmStart">
            <text class="wel-cta-text">{{ confirming ? '确认中…' : '确认开始观看' }}</text>
            <Icon name="arrow-right" :size="18" />
          </view>
          <text class="wel-legal">确认时间将被记录 · 未确认前商品可正常退货</text>
          <view class="wel-dots"><view class="dot"></view><view class="dot on"></view></view>
        </view>
      </view>
    </template>

    <!-- ===== 本人重扫已确认的码：继续学习 ===== -->
    <view v-else-if="mode === 'mine'" class="wel-screen">
      <view class="wel-close" @tap.stop="close"><Icon name="x" :size="20" /></view>
      <view class="wel-top">
        <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
      </view>
      <view class="wel-body">
        <text class="wel-eyebrow">WELCOME BACK · 欢迎回来</text>
        <view class="wel-display">
          <text class="wel-display-l">继续你的</text>
          <text class="wel-display-l">钩织之旅</text>
        </view>
        <text class="wel-lead">{{ courseTitle }} · 已解锁，随时可以接着学。</text>
        <view class="wel-cta" @tap="start">
          <text class="wel-cta-text">继续学习</text>
          <Icon name="arrow-right" :size="18" />
        </view>
      </view>
    </view>

    <!-- ===== 激活失败（码无效 / 已被他人使用 / 网络） ===== -->
    <view v-else class="wel-screen">
      <view class="wel-top">
        <image class="wel-logo" src="/static/logo-white.svg" mode="heightFix" />
      </view>
      <view class="wel-body">
        <text class="wel-eyebrow">激活遇到问题</text>
        <view class="wel-display">
          <text class="wel-display-l">这枚激活码</text>
          <text class="wel-display-l">暂时不能用</text>
        </view>
        <text class="wel-lead">{{ errText }}</text>
        <view class="wel-cta" @tap="close">
          <text class="wel-cta-text">返回首页</text>
          <Icon name="arrow-right" :size="18" />
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.wel {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #000;
  overflow: hidden;
}
.wel-photo {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
.wel-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 70%;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 0.35) 45%,
    rgba(0, 0, 0, 0.82) 100%
  );
}
.wel-screen {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.wel-close {
  position: absolute;
  /* 小程序：与胶囊同一水平带，右端为胶囊让位 */
  /* #ifdef MP-WEIXIN */
  top: calc(var(--sbh, 0px) + (var(--navh, 44px) - 38px) / 2);
  right: calc(16px + var(--gap, 0px));
  /* #endif */
  /* #ifndef MP-WEIXIN */
  top: calc(16px + env(safe-area-inset-top));
  right: 16px;
  /* #endif */
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}
.wel-close.back {
  left: 12px;
  right: auto;
  background: transparent;
}
.wel-top {
  position: absolute;
  /* logo 居中行放在导航带下方 */
  /* #ifdef MP-WEIXIN */
  top: calc(var(--sbh, 0px) + var(--navh, 44px) + 12px);
  /* #endif */
  /* #ifndef MP-WEIXIN */
  top: calc(56px + env(safe-area-inset-top));
  /* #endif */
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
}
.wel-logo {
  height: 30px;
  opacity: 0.96;
}
.wel-body {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(56px + env(safe-area-inset-bottom));
  padding: 0 28px;
}
.wel-eyebrow {
  display: block;
  font-family: $font-sans;
  font-size: 12px;
  letter-spacing: 0.14em;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 14px;
}
.wel-display {
  margin-bottom: 16px;
}
.wel-display-l {
  display: block;
  font-family: $font-display;
  font-weight: 600;
  font-size: 40px;
  line-height: 1.12;
  color: #fff;
  letter-spacing: -0.5px;
}
.wel-lead {
  display: block;
  font-size: 15px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.88);
  max-width: 300px;
}
/* 确认页法律小字（退货权后果的辅助说明） */
.wel-legal {
  display: block;
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 12px;
}
.wel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 28px;
}
.wel-dots {
  display: flex;
  gap: 7px;
  margin-top: 28px;
}
.wel-foot .wel-dots {
  margin-top: 0;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.4);
}
.dot.on {
  width: 18px;
  border-radius: 4px;
  background: #fff;
}
.wel-mini {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: $r-pill;
  background: rgba(255, 255, 255, 0.18);
}
.wel-mini text {
  font-size: 14px;
  color: #fff;
}
.wel-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 52px;
  border-radius: $r-pill;
  background: $purple-ink;
  margin-top: 28px;
}
.wel-cta:active {
  background: $purple-ink-active;
}
.wel-cta-text {
  font-size: 17px;
  font-weight: 500;
  color: #fff;
}
</style>
