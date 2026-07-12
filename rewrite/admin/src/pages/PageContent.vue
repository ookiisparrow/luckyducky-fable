<script setup lang="ts">
// 页面内容工作台（批C·照 design/控制台.pen y:31200–35360 五屏）：五页签统管小程序各页可编辑文案/图，
// 每签右侧 375 手机实时预览 + 自动保存。切签用 v-if 卸载/挂载——进签 onMounted 拉取、离签 onBeforeUnmount 补存
// （各 tab 组件自带 usePageContent 生命周期）。首页签内嵌 HomeContentForm（存 content/home 档·背景图三态在此）。
import { ref, computed } from 'vue'
import PageHeader from '../components/ui/PageHeader.vue'
import HomeContentForm from '../components/pagecontent/HomeContentForm.vue'
import WelcomeTab from '../components/pagecontent/WelcomeTab.vue'
import CatalogPlayerTab from '../components/pagecontent/CatalogPlayerTab.vue'
import MeAboutTab from '../components/pagecontent/MeAboutTab.vue'
import AgreementTab from '../components/pagecontent/AgreementTab.vue'

const TABS = [
  { key: 'home', label: '首页', comp: HomeContentForm },
  { key: 'welcome', label: '欢迎与激活', comp: WelcomeTab },
  { key: 'catalogPlayer', label: '目录与播放', comp: CatalogPlayerTab },
  { key: 'meAbout', label: '我的与关于', comp: MeAboutTab },
  { key: 'agreement', label: '协议文案', comp: AgreementTab },
] as const

const active = ref<(typeof TABS)[number]['key']>('home')
const activeComp = computed(() => TABS.find((t) => t.key === active.value)!.comp)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="页面内容" sub="小程序各页可编辑的文案与图，分页签维护；每签右侧为手机实时预览，编辑即自动保存、保存后立即生效。" />
    <div class="pc-tabs">
      <button v-for="t in TABS" :key="t.key" class="pc-tab" :class="{ on: active === t.key }" @click="active = t.key">{{ t.label }}</button>
    </div>
    <!-- v-if 切换：切签即卸载旧签（触发离签补存）+ 挂载新签（触发进签拉取）·key 强制重建 -->
    <component :is="activeComp" :key="active" />
  </div>
</template>
