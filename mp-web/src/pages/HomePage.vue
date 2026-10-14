<script setup lang="ts">
// 首页：结构逐块对照 rewrite/mp/pages/home/home.wxml（class 名不改，样式直接用 home.wxss）。
import { ref } from 'vue'
import { mapHomeContent } from '@mp/lib/mapHome'
import PxI from '../components/PxI.vue'
import PxCanvas from '../components/PxCanvas.vue'
import { addToCart, products, toast } from '../store'
import { mpStatic } from '../static'

defineProps<{ statusBarHeight: number }>()

const content = mapHomeContent({})
const heroImg = mpStatic(content.hero.img)
const logo = mpStatic('/static/logo-wordmark.svg')
const scenes = [
  { kind: 'hats', caption: '三种颜色的帽子，随心换' },
  { kind: 'charm', caption: '挂在包上，走到哪带到哪' },
  { kind: 'share', caption: '帽子也能借给小熊、小蛙' },
]

const scroller = ref<HTMLElement | null>(null)
const showTop = ref(false)
const openFaq = ref(-1)

const scrollTo = (id: string) => {
  const box = scroller.value
  const el = box?.querySelector<HTMLElement>(`#${id}`)
  if (box && el) box.scrollTo({ top: el.offsetTop, behavior: 'smooth' })
}
const onScroll = () => {
  const box = scroller.value
  if (box) showTop.value = box.scrollTop > box.clientHeight * 1.5
}
const onAdd = (id: string, name: string) => {
  addToCart(id)
  toast(`已加入购物车：${name}`)
}
const no = (i: number) => (i < 9 ? '0' : '') + (i + 1)
</script>

<template>
  <div class="hm-bar" :style="{ paddingTop: `${statusBarHeight}px` }">
    <img class="hm-bar-logo hfix" :src="logo" alt="小棉鸭 Lucky Ducky" />
  </div>
  <div ref="scroller" class="hm-scroll scroll" :style="{ top: `${statusBarHeight + 44}px` }" @scroll.passive="onScroll">
    <div id="top" />

    <section
      class="hm-fold"
      :style="{ height: `calc(var(--mp-vh) - ${statusBarHeight + 44}px - 52px - max(24px, env(safe-area-inset-bottom)))` }"
    >
      <div class="hm-gap-a" />
      <div class="hm-hero">
        <img class="hm-hero-img focus-img" :src="heroImg" alt="戴粉色小帽的钩织小棉鸭" />
        <div class="hm-fade-top" />
        <div class="hm-fade-bottom" />
      </div>
      <div class="hm-gap-b" />
      <div class="hm-hero-copy">
        <h1 class="hm-display">{{ content.hero.title }}</h1>
        <span class="mono hm-tagline">{{ content.hero.tagline }}</span>
      </div>
      <div class="hm-hero-keys">
        <button v-press="'k-light-down'" class="k k-light hm-search" @click="scrollTo('intro')">
          <span class="hm-search-text">{{ content.hero.search }}</span>
          <PxI name="down" tone="var(--v5-ink-2)" />
        </button>
        <button v-press="'k-ink-down'" class="k k-ink hm-buy" @click="scrollTo('friends')">购买</button>
      </div>
      <div class="hm-gap-c" />
    </section>

    <section id="intro" class="hm-brand">
      <img class="hm-brand-logo hfix" :src="logo" alt="" />
      <p class="t-sys hm-lead">{{ content.brand.lead }}</p>
    </section>
    <div class="hm-scenes">
      <div v-for="s in scenes" :key="s.kind" class="hm-scene">
        <PxCanvas mode="scene" :name="s.kind" />
        <span class="hm-scene-cap">{{ s.caption }}</span>
      </div>
    </div>

    <section id="friends" class="hm-sec">
      <h2 class="hm-h2">{{ content.feature.title }}</h2>
      <p class="t-sys hm-sub">{{ content.feature.body }}</p>
    </section>
    <div class="hm-rail scroll-x">
      <div class="hm-rail-row">
        <div v-for="p in products" :key="p.id" v-press="'press-fade'" class="hm-card" role="button" @click="toast('商品详情页暂未在网页预览中还原')">
          <div class="hm-card-media">
            <img class="hm-card-img focus-img" :src="p.cover" :alt="p.name" loading="lazy" />
          </div>
          <div class="hm-card-info">
            <span class="t-sys hm-card-name">{{ p.name }}</span>
            <div class="hm-card-foot">
              <span class="mono hm-price">{{ p.priceLabel }}</span>
              <div class="hm-add-hit" @click.stop="onAdd(p.id, p.name)">
                <button v-press="'k-light-down'" class="k k-sm k-light hm-add" :aria-label="`把${p.name}加入购物车`">
                  <PxI name="plus" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="hm-trust">
      <div v-for="(t, i) in content.trust" :key="t.label" class="hm-trust-item">
        <div class="hm-trust-ico"><PxCanvas mode="anim" :name="t.anim" :size="4" :delay="i * 600" /></div>
        <span class="hm-trust-label">{{ t.label }}</span>
      </div>
    </div>

    <section class="hm-sec hm-sec-tight">
      <h2 class="hm-h2">{{ content.reassure.heading }}</h2>
      <p class="t-sys hm-sub">{{ content.reassure.lead }}</p>
    </section>
    <div class="hm-reassure">
      <div v-for="(r, i) in content.reassure.items" :key="r.title" class="hm-rs">
        <div v-if="r.img" class="hm-rs-media"><img class="hm-rs-img" :src="r.img" alt="" /></div>
        <div class="hm-rs-head">
          <span class="mono hm-no">{{ no(i) }}</span>
          <span class="hm-rs-title">{{ r.title }}</span>
        </div>
        <p class="t-sys hm-body">{{ r.body }}</p>
      </div>
    </div>

    <section class="hm-sec"><h2 class="hm-h2">大家都在问</h2></section>
    <div class="hm-faq">
      <div v-for="(f, i) in content.faq" :key="f.title" class="hm-faq-item">
        <div v-press="'k-row-down'" class="hm-faq-row" role="button" :aria-expanded="openFaq === i" @click="openFaq = openFaq === i ? -1 : i">
          <span class="mono hm-no" :class="{ 'hm-no-on': openFaq === i }">{{ no(i) }}</span>
          <span class="hm-faq-title">{{ f.title }}</span>
          <span class="t-sys hm-faq-act t-cap">{{ openFaq === i ? '收起' : '展开' }}</span>
        </div>
        <p v-if="openFaq === i" class="t-sys hm-faq-body enter-rise">{{ f.body }}</p>
      </div>
    </div>

    <section class="hm-closing">
      <div class="hm-closing-copy">
        <h2 class="hm-closing-title">{{ content.closing.title }}</h2>
        <button v-press="'k-ink-down'" class="k k-ink k-48 hm-closing-btn" @click="scrollTo('friends')">
          <span class="hm-sheen"><span class="hm-sheen-a" /><span class="hm-sheen-b" /><span class="hm-sheen-c" /></span>
          <span class="hm-closing-cta">{{ content.closing.cta }}</span>
        </button>
      </div>
    </section>

    <footer class="hm-footer">
      <img class="hm-footer-logo hfix" :src="logo" alt="" />
      <div class="hm-footer-links">
        <template v-for="(l, i) in content.footer.links" :key="l">
          <span v-if="i > 0" class="t-sys hm-footer-dot">·</span>
          <span class="t-sys hm-footer-link hit44" role="button" @click="toast(l)">{{ l }}</span>
        </template>
      </div>
      <span class="mono hm-footer-copy">{{ content.footer.copy }}</span>
    </footer>
    <div class="hm-tab-space" />
  </div>

  <button
    v-if="showTop"
    v-press="'k-light-down'"
    class="k k-light hm-backtop hit44 enter-rise"
    aria-label="回到顶部"
    @click="scroller?.scrollTo({ top: 0, behavior: 'smooth' })"
  >
    <PxI name="up" />
  </button>
</template>

<style scoped>
.hm-display,
.hm-h2,
.hm-closing-title {
  font: inherit;
}
.hm-display {
  font-size: 48px;
  font-weight: 900;
}
.hm-h2 {
  font-size: 24px;
  font-weight: 700;
}
.hm-closing-title {
  font-size: 30px;
  font-weight: 900;
}
.hm-sheen,
.hm-sheen-a,
.hm-sheen-b,
.hm-sheen-c {
  display: flex;
}
.hm-sheen-a,
.hm-sheen-b,
.hm-sheen-c {
  height: 100%;
}
.hm-faq-body {
  display: block;
}
</style>
