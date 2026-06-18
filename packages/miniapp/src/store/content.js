/**
 * 首页内容 store（hero 文案 / 信任条 / FAQ）。
 * 云端有编辑过的内容则覆盖，否则用本地默认（data/trust.js、data/faq.js、Hero 组件默认文案）。
 * 覆盖按「块」整体替换：某块云端为空数组/空字段时仍用本地默认（防误清空线上）。
 * 不持久化：进首页拉取。
 */
import { defineStore } from 'pinia'
import { getHomeContent } from '@/api/content.js'
import { TRUST_ITEMS } from '@/data/trust.js'
import { FAQ_ITEMS } from '@/data/faq.js'

const DEFAULT_HERO = { title: '创造幸运', tagline: 'Get ducky get lucky' }

export const useContentStore = defineStore('content', {
  state: () => ({
    home: null, // 云端原始文档（null = 未编辑过/不可用）
    loaded: false,
  }),
  getters: {
    hero: (s) => {
      const h = s.home?.hero
      return {
        title: h?.title || DEFAULT_HERO.title,
        tagline: h?.tagline || DEFAULT_HERO.tagline,
      }
    },
    // 激活页背景图（welcome）：控制台上传的云存储 fileID，空＝welcome 回退 /static/hero-full.jpg
    activationBg: (s) => s.home?.activationBg || '',
    trust: (s) => (s.home?.trust?.length ? s.home.trust : TRUST_ITEMS),
    faq: (s) => (s.home?.faq?.length ? s.home.faq : FAQ_ITEMS),
  },
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return
      this.home = await getHomeContent()
      this.loaded = true
    },
  },
})
