<script setup>
/**
 * 求助面板（设计稿完整版）：在线客服 / 遇到问题(辅助视频) / 常见问题 / 学习交流群 / 反馈视频问题。
 * 从播放页（player）拆出 —— 面板自带开合状态。父级用 ref 调 open() 打开
 * （打开前由父级负责暂停主视频）。辅助视频为海报占位 + 计时模拟播放（非真视频）。
 */
import { ref, computed, watch, onUnmounted, getCurrentInstance } from 'vue'
import Icon from './Icon.vue'
import MediaSlot from './MediaSlot.vue'

defineProps({
  ep: { type: String, default: '' },
  title: { type: String, default: '' },
})

const instance = getCurrentInstance()

const help = ref(false)
const helpView = ref(null) // null=选项 / service / step / faq / group / report
const helpTopic = ref(null) // 'step' 下选中的辅助视频 index
const faqOpen = ref(0)
const reportSel = ref(null)

const HELP_OPTS = [
  {
    id: 'service',
    icon: 'headphones-purple',
    title: '联系在线客服',
    sub: '工作日 9:00–21:00 · 平均 1 分钟应答',
  },
  {
    id: 'step',
    icon: 'circle-help-purple',
    title: '遇到问题了',
    sub: '把卡住的地方拍给老师，帮你逐针看',
  },
  { id: 'faq', icon: 'book-open', title: '常见问题', sub: '新手最常卡住的几个问题' },
  { id: 'group', icon: 'users-purple', title: '加入学习交流群', sub: '和一起钩鸭的小伙伴互相打气' },
  { id: 'report', icon: 'flag-purple', title: '反馈视频问题', sub: '卡顿 / 看不清 / 没声音…' },
]
const SERVICE_CHIPS = ['材料缺少/损坏', '钩错了想拆', '发货与物流', '退换货', '其它问题']
const TROUBLE = [
  {
    title: '通常解决办法',
    sub: '数错针、太紧、打结、歪了…对症排查',
    dur: '02:40',
    segs: 4,
    desc: '这条视频带你快速排查最常见的几个卡点，对照着检查，大多能自己解决。',
  },
  {
    title: '如何重新开始',
    sub: '拆几针或整只重来，毛线不浪费',
    dur: '01:55',
    segs: 3,
    desc: '演示如何安全地拆线回退，以及整只重新起头的方法 —— 放心大胆地重来。',
  },
  {
    title: '如何制作一个开始结',
    sub: '第一针的滑结，跟着做就会',
    dur: '03:10',
    segs: 5,
    desc: '手把手教你打出第一针的滑结（起手结），这是所有钩织的起点。',
  },
]
const HELP_FAQ = [
  {
    q: '完全没有基础，也能学会吗？',
    a: '可以的。课程从拿钩针、起针开始，每一针都有慢动作示范，跟着钩就好。九成新手都能完成第一只小鸭。',
  },
  {
    q: '材料用完了，怎么补？',
    a: '套装内的毛线、棉花都可单独补购，在「我」-「我的材料」里一键补货，常用色号长期有货。',
  },
  {
    q: '钩错了能拆掉重来吗？',
    a: '当然。钩织最大的好处就是可拆。轻轻抽线就能回到上一步，不会浪费毛线，大胆试。',
  },
  {
    q: '钩完一只大概要多久？',
    a: '新手平均 3–4 小时，可以分几次完成。每节视频 3–8 分钟，跟着节奏慢慢来，不赶进度。',
  },
  {
    q: '支持退换货吗？',
    a: '七天无理由退换。只要材料包未拆封，随时可退；拆封后若有缺漏件，免费补寄。',
  },
]
const REPORT_TYPES = ['视频卡顿', '画面看不清', '字幕有误', '没有声音', '其它']

const inTopic = computed(() => helpView.value === 'step' && helpTopic.value !== null)
const sheetTitle = computed(() => {
  if (inTopic.value) return TROUBLE[helpTopic.value].title
  if (helpView.value)
    return (HELP_OPTS.find((o) => o.id === helpView.value) || {}).title || '需要帮忙吗？'
  return '需要帮忙吗？'
})

// 父级（播放页）暂停主视频后，用 ref 调本方法打开面板
function open() {
  help.value = true
  helpView.value = null
  helpTopic.value = null
}
function closeHelp() {
  help.value = false
  helpView.value = null
  helpTopic.value = null
}
function sheetBack() {
  if (inTopic.value) helpTopic.value = null
  else helpView.value = null
}
function helpAction(msg) {
  uni.showToast({ title: msg, icon: 'none' })
}

// 本地时间格式化（mm:ss）；与播放页同款
const fmt = (s) => {
  s = Math.max(0, Math.round(s || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 辅助视频（「遇到问题了」下的小视频卡 · 海报占位 + 计时模拟播放）
const parseDur = (d) => {
  const [m, s] = String(d).split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}
const hvT = ref(0)
const hvPlaying = ref(false)
let hvTimer = null
const hvDur = computed(() => (inTopic.value ? parseDur(TROUBLE[helpTopic.value].dur) : 0))
const hvSegs = computed(() => (inTopic.value ? TROUBLE[helpTopic.value].segs : 0))
const hvPct = computed(() => (hvDur.value ? (hvT.value / hvDur.value) * 100 : 0))
const hvSegFill = (i) => {
  const sl = hvSegs.value ? 100 / hvSegs.value : 0
  return sl ? Math.max(0, Math.min(100, ((hvPct.value - i * sl) / sl) * 100)) : 0
}
function clearHv() {
  if (hvTimer) {
    clearInterval(hvTimer)
    hvTimer = null
  }
}
function startHv() {
  clearHv()
  hvTimer = setInterval(() => {
    if (hvT.value >= hvDur.value) {
      hvT.value = hvDur.value
      hvPlaying.value = false
      clearHv()
      return
    }
    hvT.value += 1
  }, 1000)
}
function hvToggle() {
  if (hvT.value >= hvDur.value) hvT.value = 0
  hvPlaying.value = !hvPlaying.value
  if (hvPlaying.value) startHv()
  else clearHv()
}
function hvSeekTap(e) {
  if (hvDur.value <= 0) return
  const x = (e.detail && e.detail.x) || (e.touches && e.touches[0] && e.touches[0].clientX) || 0
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select('.hv-scrub')
    .boundingClientRect((r) => {
      if (!r) return
      const ratio = Math.min(1, Math.max(0, (x - r.left) / r.width))
      hvT.value = Math.round(ratio * hvDur.value)
    })
    .exec()
}
watch(helpTopic, (v) => {
  clearHv()
  if (v !== null) {
    hvT.value = 0
    hvPlaying.value = true
    startHv()
  }
})
onUnmounted(clearHv)

defineExpose({ open })
</script>

<template>
  <view class="vp-helpsheet" :class="{ on: help }">
    <view class="vp-sheet-backdrop" @tap="closeHelp"></view>
    <view class="vp-sheet">
      <view class="vp-sheet-grab"></view>
      <view class="vp-sheet-head">
        <view v-if="helpView" class="vp-sheet-back" @tap="sheetBack"
          ><Icon name="chevron-left-ink" :size="21"
        /></view>
        <view class="vp-sheet-htext">
          <text class="vp-sheet-title">{{ sheetTitle }}</text>
          <text v-if="!helpView" class="vp-sheet-sub">{{ ep }} · {{ title }}</text>
        </view>
        <view class="vp-sheet-x" @tap="closeHelp"><Icon name="x-ink" :size="18" /></view>
      </view>
      <view class="vp-sheet-body">
        <!-- 选项列表 -->
        <view v-if="!helpView" class="vp-sheet-list">
          <view v-for="o in HELP_OPTS" :key="o.id" class="vp-opt" @tap="helpView = o.id">
            <view class="vp-opt-ico"><Icon :name="o.icon" :size="21" /></view>
            <view class="vp-opt-mid">
              <text class="vp-opt-title">{{ o.title }}</text>
              <text class="vp-opt-sub">{{ o.sub }}</text>
            </view>
            <view class="vp-opt-chev"><Icon name="chevron-right" :size="18" /></view>
          </view>
        </view>

        <!-- 在线客服 -->
        <view v-else-if="helpView === 'service'" class="hs-detail">
          <view class="hs-svc-hero">
            <view class="hs-svc-av"><Icon name="headphones-amber" :size="25" /></view>
            <view>
              <text class="hs-svc-name">小鸭客服 · 暖暖</text>
              <view class="hs-svc-status"
                ><view class="dot"></view><text>在线 · 通常 1 分钟内回复</text></view
              >
            </view>
          </view>
          <text class="hs-bubble"
            >你好呀~ 我是你的钩织小帮手。遇到任何问题，直接告诉我就好，我们一针一针来解决。</text
          >
          <text class="hs-clabel">常见求助，点一下快速发送</text>
          <view class="hs-chips">
            <view
              v-for="(c, i) in SERVICE_CHIPS"
              :key="i"
              class="hs-chip"
              @tap="helpAction('已为你转接客服 · ' + c)"
              >{{ c }}</view
            >
          </view>
          <view class="hs-input">
            <input class="hs-input-field" placeholder="输入你的问题…" disabled />
            <view class="hs-send" @tap="helpAction('消息已送达 · 客服马上回复你~')"
              ><Icon name="send-w" :size="19"
            /></view>
          </view>
        </view>

        <!-- 遇到问题了：辅助视频列表 / 单个视频 -->
        <view v-else-if="helpView === 'step'" class="hs-detail">
          <view v-if="helpTopic === null" class="hs-vlist">
            <view v-for="(t, i) in TROUBLE" :key="i" class="hs-vrow" @tap="helpTopic = i">
              <view class="hs-vthumb">
                <MediaSlot ratio="1/1" />
                <view class="hs-vthumb-play"><Icon name="play-ink" :size="14" /></view>
              </view>
              <view class="hs-vrow-mid">
                <text class="hs-vrow-title">{{ t.title }}</text>
                <text class="hs-vrow-sub">{{ t.sub }}</text>
                <view class="hs-vrow-meta"
                  ><Icon name="play-purple" :size="13" /><text>视频 · {{ t.dur }}</text></view
                >
              </view>
              <view class="vp-opt-chev"><Icon name="chevron-right" :size="18" /></view>
            </view>
          </view>
          <view v-else>
            <view class="hv-video">
              <MediaSlot ratio="4/5" />
              <view class="hv-scrim"></view>
              <view class="hv-seg">
                <view class="hv-seg-bars">
                  <view v-for="i in hvSegs" :key="i" class="hv-seg-bar">
                    <view class="hv-seg-fill" :style="{ width: hvSegFill(i - 1) + '%' }"></view>
                  </view>
                </view>
              </view>
              <view class="hv-play" @tap="hvToggle"
                ><Icon :name="hvPlaying ? 'pause-w' : 'play-fill-w'" :size="25"
              /></view>
              <view class="hv-bar">
                <text class="hv-time">{{ fmt(hvT) }}</text>
                <view class="hv-scrub" @tap="hvSeekTap">
                  <view class="hv-scrub-fill" :style="{ width: hvPct + '%' }"></view>
                  <view class="hv-scrub-thumb" :style="{ left: hvPct + '%' }"></view>
                </view>
                <text class="hv-time">{{ fmt(hvDur) }}</text>
              </view>
            </view>
            <text class="hv-desc">{{ TROUBLE[helpTopic].desc }}</text>
          </view>
        </view>

        <!-- 常见问题 -->
        <view v-else-if="helpView === 'faq'" class="hs-detail">
          <view class="hs-faq">
            <view
              v-for="(qa, i) in HELP_FAQ"
              :key="i"
              class="hs-faq-item"
              :class="{ open: faqOpen === i }"
            >
              <view class="hs-faq-q" @tap="faqOpen = faqOpen === i ? -1 : i">
                <text>{{ qa.q }}</text>
                <view class="hs-faq-chev"><Icon name="chevron-right" :size="18" /></view>
              </view>
              <view class="hs-faq-a" :class="{ open: faqOpen === i }"
                ><text>{{ qa.a }}</text></view
              >
            </view>
          </view>
        </view>

        <!-- 学习交流群 -->
        <view v-else-if="helpView === 'group'" class="hs-detail">
          <view class="hs-group-card">
            <text class="hs-group-name">易织小棉鸭 · 新手互助群</text>
            <text class="hs-group-meta">已有 1,286 位钩织小伙伴 · 老师每日在线答疑</text>
            <view class="hs-qr"><Icon name="qr-code-ink" :size="112" /></view>
            <text class="hs-group-hint">微信扫一扫，加入群聊</text>
            <view class="hs-group-btn" @tap="helpAction('群号已复制 · 88-Ducky')"
              >复制群号 88-Ducky</view
            >
          </view>
          <view class="hs-group-pts">
            <view class="hs-group-pt"
              ><view class="dot"></view><text>遇到问题随时提问，不卡在某一针</text></view
            >
            <view class="hs-group-pt"
              ><view class="dot"></view><text>每周钩织打卡，和大家一起完成</text></view
            >
            <view class="hs-group-pt"
              ><view class="dot"></view><text>群内专属材料补给与新手福利</text></view
            >
          </view>
        </view>

        <!-- 反馈视频问题 -->
        <view v-else-if="helpView === 'report'" class="hs-detail">
          <text class="hs-flabel">遇到了什么问题？</text>
          <view class="hs-chips">
            <view
              v-for="(t, i) in REPORT_TYPES"
              :key="i"
              class="hs-chip"
              :class="{ on: reportSel === i }"
              @tap="reportSel = i"
              >{{ t }}</view
            >
          </view>
          <text class="hs-flabel mt">补充描述（选填）</text>
          <textarea class="hs-textarea" placeholder="再多告诉我们一点，比如出现在第几分钟…" />
          <view
            class="hs-submit"
            :class="{ disabled: reportSel === null }"
            @tap="reportSel !== null && helpAction('反馈已收到 · 感谢你帮小鸭变得更好~')"
            >提交反馈</view
          >
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* —— 求助面板（设计稿完整版） —— */
.vp-helpsheet {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}
.vp-helpsheet.on {
  pointer-events: auto;
}
.vp-sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.3s;
}
.vp-helpsheet.on .vp-sheet-backdrop {
  opacity: 1;
}
.vp-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 76%;
  background: $bg-grey;
  border-radius: 22px 22px 0 0;
  box-shadow: 0 -12px 44px rgba(0, 0, 0, 0.32);
  transform: translateY(101%);
  transition: transform 0.34s cubic-bezier(0.22, 0.61, 0.36, 1);
  display: flex;
  flex-direction: column;
  color: $ink;
  overflow: hidden;
}
.vp-helpsheet.on .vp-sheet {
  transform: none;
}
.vp-sheet-grab {
  width: 38px;
  height: 4px;
  border-radius: 999px;
  background: $line-strong;
  margin: 11px auto 4px;
}
.vp-sheet-head {
  display: flex;
  align-items: flex-start;
  padding: 10px 16px 14px;
}
.vp-sheet-back,
.vp-sheet-x {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-top: 2px;
}
.vp-sheet-back:active,
.vp-sheet-x:active {
  background: rgba(0, 0, 0, 0.12);
}
.vp-sheet-back {
  margin-right: 12px;
}
.vp-sheet-htext {
  flex: 1 1 auto;
  min-width: 0;
}
.vp-sheet-title {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 22px;
  color: $ink;
}
.vp-sheet-sub {
  display: block;
  font-size: 13px;
  color: $content-2;
  margin-top: 5px;
}
.vp-sheet-x {
  margin-left: 12px;
}
.vp-sheet-body {
  flex: 1 1 auto;
  overflow-y: auto;
}

/* 选项列表 */
.vp-sheet-list {
  padding: 2px 16px 24px;
}
.vp-opt {
  display: flex;
  align-items: center;
  padding: 15px 16px;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-md;
  margin-bottom: 10px;
}
.vp-opt:active {
  background: #fafafa;
}
.vp-opt-ico {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 14px;
}
.vp-opt-mid {
  flex: 1 1 auto;
  min-width: 0;
}
.vp-opt-title {
  display: block;
  font-size: 16px;
  color: $ink;
}
.vp-opt-sub {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 3px;
  line-height: 1.45;
}
.vp-opt-chev {
  flex: 0 0 auto;
  display: flex;
  margin-left: 8px;
}

/* 子页通用容器 */
.hs-detail {
  padding: 4px 18px 26px;
}

/* 在线客服 */
.hs-svc-hero {
  display: flex;
  align-items: center;
  padding: 4px 0 16px;
}
.hs-svc-av {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f5b030;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 12px;
}
.hs-svc-name {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.hs-svc-status {
  display: flex;
  align-items: center;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 3px;
}
.hs-svc-status .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2fbf71;
  margin-right: 6px;
}
.hs-bubble {
  display: block;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: 4px 16px 16px 16px;
  padding: 13px 15px;
  font-size: 14.5px;
  line-height: 1.6;
  color: $content;
}
.hs-clabel {
  display: block;
  font-size: 13px;
  color: $content-2;
  margin: 20px 0 11px;
}
.hs-chips {
  display: flex;
  flex-wrap: wrap;
}
.hs-chip {
  border: 1px solid $line-strong;
  background: $white;
  color: $ink;
  border-radius: 999px;
  padding: 9px 15px;
  font-size: 13.5px;
  margin: 0 9px 9px 0;
}
.hs-chip:active {
  background: $bg-grey;
}
.hs-chip.on {
  background: $purple;
  border-color: $purple;
  color: $white;
}
.hs-input {
  display: flex;
  align-items: center;
  margin-top: 22px;
  background: $white;
  border: 1px solid $line-strong;
  border-radius: 999px;
  padding: 5px 5px 5px 16px;
}
.hs-input-field {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  color: $ink;
}
.hs-send {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: $purple;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-left: 10px;
}

/* 学习群 */
.hs-group-card {
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-md;
  padding: 22px 20px;
  text-align: center;
}
.hs-group-name {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 18px;
  color: $ink;
}
.hs-group-meta {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 6px;
  line-height: 1.5;
}
.hs-qr {
  width: 154px;
  height: 154px;
  margin: 18px auto 12px;
  background: $white;
  border: 1px solid $line;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(54, 58, 80, 0.08);
}
.hs-group-hint {
  display: block;
  font-size: 12.5px;
  color: $content-2;
}
.hs-group-btn {
  margin-top: 16px;
  height: 46px;
  border-radius: 999px;
  background: $purple-ink;
  color: $white;
  font-weight: 600;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.04em;
}
.hs-group-btn:active {
  opacity: 0.92;
}
.hs-group-pts {
  margin: 18px 2px 0;
}
.hs-group-pt {
  display: flex;
  align-items: flex-start;
  margin-bottom: 11px;
}
.hs-group-pt .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: $duck-deep;
  flex: 0 0 auto;
  margin: 7px 12px 0 3px;
}
.hs-group-pt text {
  font-size: 13.5px;
  color: $content;
  line-height: 1.5;
}

/* 常见问题（手风琴） */
.hs-faq-item {
  border-bottom: 1px solid $line;
}
.hs-faq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 2px;
}
.hs-faq-q text {
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
.hs-faq-a text {
  display: block;
  padding: 0 2px 16px;
  font-size: 14px;
  line-height: 1.65;
  color: $content;
}

/* 遇到问题了 · 辅助视频列表 */
.hs-vlist {
  display: flex;
  flex-direction: column;
}
.hs-vrow {
  display: flex;
  align-items: center;
  padding: 12px;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-md;
  margin-bottom: 10px;
}
.hs-vrow:active {
  background: #fafafa;
}
.hs-vthumb {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 10px;
  flex: 0 0 auto;
  overflow: hidden;
  margin-right: 13px;
}
.hs-vthumb-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hs-vrow-mid {
  flex: 1 1 auto;
  min-width: 0;
}
.hs-vrow-title {
  display: block;
  font-size: 16px;
  color: $ink;
}
.hs-vrow-sub {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 3px;
  line-height: 1.4;
}
.hs-vrow-meta {
  display: flex;
  align-items: center;
  margin-top: 6px;
  font-family: $font-sans;
  font-size: 11.5px;
  color: $purple;
}
.hs-vrow-meta text {
  margin-left: 4px;
}

/* 辅助视频播放卡片 */
.hv-video {
  position: relative;
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
  background: #1a1620;
}
.hv-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 26%),
    linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0) 30%);
}
.hv-seg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  padding: 11px 12px 0;
}
.hv-seg-bars {
  display: flex;
}
.hv-seg-bar {
  flex: 1 1 0;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  overflow: hidden;
  margin-right: 5px;
}
.hv-seg-bar:last-child {
  margin-right: 0;
}
.hv-seg-fill {
  display: block;
  height: 100%;
  background: #fff;
  border-radius: 999px;
}
.hv-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 3;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hv-play:active {
  transform: translate(-50%, -50%) scale(0.92);
}
.hv-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  padding: 0 12px 12px;
  display: flex;
  align-items: center;
}
.hv-time {
  flex: 0 0 auto;
  font-family: $font-sans;
  font-size: 11px;
  color: #fff;
}
.hv-scrub {
  position: relative;
  flex: 1 1 auto;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  margin: 0 10px;
}
.hv-scrub-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: $purple;
}
.hv-scrub-thumb {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.hv-desc {
  display: block;
  margin: 15px 2px 0;
  font-size: 14px;
  line-height: 1.65;
  color: $content;
}

/* 反馈表单 */
.hs-flabel {
  display: block;
  font-size: 13.5px;
  color: $content;
  font-weight: 500;
  margin: 8px 0 11px;
}
.hs-flabel.mt {
  margin-top: 22px;
}
.hs-textarea {
  width: 100%;
  min-height: 96px;
  border: 1px solid $line-strong;
  border-radius: 12px;
  padding: 13px 14px;
  font-size: 14px;
  color: $ink;
  background: $white;
  box-sizing: border-box;
}
.hs-submit {
  margin-top: 22px;
  height: 50px;
  border-radius: 999px;
  background: $purple;
  color: $white;
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hs-submit.disabled {
  opacity: 0.4;
}
</style>
