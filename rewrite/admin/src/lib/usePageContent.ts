// 页面内容页签保存生命周期（批C·收敛阀）：welcome/catalogPlayer/mePage/about/agreement 四签的
// 「进签拉取 → 900ms 防抖自动保存 → serialSave 串行防乱序 → load-guard 未载入不写 → 离签补存」完全同构。
// 抽成 composable 而非 4 份复制——防把 HomeContent 里那套有文档记载的竞态修复（serialSave 乱序/未载入整档覆盖·
// 根因#8）在复制中改错（元模式：复制即漂移·病根#5）。HomeContentForm 用的是 getHomeContent/saveHomeContent
// 另一对接口 + 多图上传，形状不同、单独保留、不并进此 composable（别为「碰巧长得像」硬合并）。
import { ref, watch, onMounted, onBeforeUnmount, nextTick, type Ref } from 'vue'
import { getPageContent, savePageContent } from '../api/content'
import { serialSave } from './serialSave'

export type AutoState = '' | 'saving' | 'saved' | 'error'

export function usePageContent<M>(page: string, normalize: (_raw: unknown) => M, payload: (_m: M) => Record<string, unknown>) {
  const model: Ref<M | null> = ref(null) as Ref<M | null>
  const message = ref('')
  const busy = ref(false)
  const autoState = ref<AutoState>('')
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let loaded = false // load-guard：首次载入赋值不触发自动保存

  async function autosave() {
    if (!model.value) return
    const r = await savePageContent(page, payload(model.value))
    autoState.value = r.ok ? 'saved' : 'error'
  }
  // 串行·防慢网两次自动保存乱序覆盖（根因#8）；key='page-content:'+page（批D·P1）：改走模块级共享槽位，
  // 快速切签再切回本签（PageContent.vue 用 v-if+:key 强制重建组件实例）时，新实例接管旧实例仍在途的补存
  // 链，防旧快照晚到覆盖新实例已存的编辑；按 page 分槽——不同页签互不干扰。
  const flushSave = serialSave(autosave, 'page-content:' + page)

  watch(
    model,
    () => {
      if (!model.value || !loaded) return
      autoState.value = 'saving'
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void flushSave(), 900)
    },
    { deep: true }
  )

  onBeforeUnmount(() => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      void flushSave() // 离签补存 pending（切页/切签都会走此·防未点保存直接切走静默丢失）
    }
  })

  onMounted(async () => {
    const r = await getPageContent(page)
    model.value = normalize(r.ok ? r.content : null)
    if (!r.ok) {
      // 载入失败：loaded 恒 false → 自动/手动保存都不放开，否则一次编辑就拿空档整块覆盖已有内容
      message.value = '加载失败：' + String(r.error || '')
      return
    }
    void nextTick(() => (loaded = true))
  })

  async function save() {
    if (!model.value || busy.value) return
    if (!loaded) {
      message.value = '内容未成功载入，暂不能保存（避免覆盖已有配置·请刷新重试）'
      return
    }
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    busy.value = true
    await flushSave() // 先排空在途/待发的自动保存链（防旧快照落在手动保存之后覆盖新编辑·根因#8）
    const r = await savePageContent(page, payload(model.value))
    busy.value = false
    autoState.value = ''
    message.value = r.ok ? '已保存，小程序立即生效' : '保存失败：' + String(r.error || '')
  }

  return { model, message, busy, autoState, save }
}
