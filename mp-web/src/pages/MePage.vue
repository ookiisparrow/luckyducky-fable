<script setup lang="ts">
// 我：结构对照 rewrite/mp/pages/me/me.wxml（已登录态·样例数据；样式直接用 me.wxss）。
import { mapMe } from '@mp/lib/mapMe'
import PxI from '../components/PxI.vue'
import PxCanvas from '../components/PxCanvas.vue'
import { toast } from '../store'
import { mpStatic } from '../static'

defineProps<{ statusBarHeight: number; groundGap: number }>()

const me = mapMe({})
const entries = me.entries
const avatar = mpStatic('/static/avatar-duck-16.svg')
const cont = { courseTitle: '小棉鸭入门课', lessonName: '第 3 节 · 钩出圆圆的头' }
const counts = { pending: '0', paid: '1', shipped: '0' }
const cells = [
  { key: 'pending', label: '待支付' },
  { key: 'paid', label: '待发货' },
  { key: 'shipped', label: '待收货' },
] as const
const rows = (['courses', 'aftersales', 'address', 'consent'] as const).filter((k) => entries[k].visible)
const links = (['kefu', 'feedback', 'about'] as const).filter((k) => entries[k].visible)
const soon = (what: string) => toast(`「${what}」暂未在网页预览中还原`)
</script>

<template>
  <div class="me-bar" :style="{ paddingTop: `${statusBarHeight}px` }">
    <div class="me-head"><h1 class="me-title">我</h1></div>
  </div>
  <div class="me-scroll scroll" :style="{ top: `${statusBarHeight + 44}px` }">
    <div class="me">
      <div class="me-egg" :style="{ paddingTop: `${groundGap}px` }">
        <PxCanvas mode="ground" name="egg" />
      </div>

      <div class="me-id">
        <button v-press="'me-av-down'" class="me-av-btn" aria-label="换头像" @click="soon('换头像')">
          <span class="me-av"><img class="me-av-img" :src="avatar" alt="" /></span>
          <span class="k k-sm k-light me-av-k">换</span>
        </button>
        <div class="me-id-t">
          <span class="t-sys me-nick">{{ me.defaultNickname }}</span>
        </div>
        <button v-press="'k-flat-down'" class="k k-sm k-flat me-mini me-mini-weak" @click="soon('编辑资料')">编辑</button>
      </div>

      <div v-press="'me-card-down'" class="me-card px-skin px-card" role="button" @click="soon('继续学习')">
        <div class="me-thumb" />
        <div class="me-card-t">
          <span class="t-sys me-card-sub">继续学习 · {{ cont.courseTitle }}</span>
          <span class="t-sys me-card-main">{{ cont.lessonName }}</span>
        </div>
        <span class="k k-ink me-play"><PxI name="play" /></span>
      </div>

      <div class="me-grid">
        <button v-for="c in cells" :key="c.key" v-press="'k-flat-down'" class="k k-flat me-cell" @click="soon(c.label)">
          <span class="me-cell-top">
            <span class="me-cell-n" :class="{ 'me-cell-zero': !counts[c.key] || counts[c.key] === '0' }">{{ counts[c.key] || '-' }}</span>
            <PxI v-if="counts[c.key] && counts[c.key] !== '0'" name="led" tone="var(--v5-violet)" />
          </span>
          <span class="t-sys me-cell-l t-cap">{{ c.label }}</span>
        </button>
        <button v-if="entries.orders.visible" v-press="'k-flat-down'" class="k k-flat me-cell" @click="soon(entries.orders.label)">
          <span class="me-cell-top me-cell-arrow"><PxI name="arrow" /></span>
          <span class="t-sys me-cell-l t-cap">{{ entries.orders.label }}</span>
        </button>
      </div>

      <div class="me-rows">
        <div v-for="k in rows" :key="k" v-press="'k-row-down'" class="me-row" role="button" @click="soon(entries[k].label)">
          <span class="t-sys me-row-t">{{ entries[k].label }}</span>
          <PxI name="arrow" />
        </div>
      </div>

      <div class="me-links">
        <template v-for="(k, i) in links" :key="k">
          <div v-if="i > 0" class="me-sep" />
          <div v-press="'k-row-down'" class="t-sys me-link px-clip-6" role="button" @click="soon(entries[k].label)">{{ entries[k].label }}</div>
        </template>
      </div>

      <div class="me-tab-space" />
    </div>
  </div>
</template>

<style scoped>
.me-title {
  font: inherit;
  font-size: 20px;
  font-weight: 700;
}
.me-av,
.me-av-k {
  display: flex;
}
.me-av-k {
  position: absolute;
}
.me-cell {
  display: flex;
}
</style>
