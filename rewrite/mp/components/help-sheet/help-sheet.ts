// 播放页求助面板（底部半屏）：menu → 帮助视频 / 常见问题两个子层；帮助视频在面板内播。从 player 页拆出。
// 页面只管三件事：求助键调 open()、返回键先问 back()、收 pausemain 事件暂停主视频（防两段视频同时出声）。
// 标题栏那 4 条样式（.lp-help-nav/-sq/-title/-close）和加桌引导共用，留在 player.wxss，经 apply-shared 生效。
import { getHelpVideos, getPublicFaq } from '../../api/learning'
import { getPageContent } from '../../lib/pageContent'
import { mapHelpVideos, mapPublicFaq, type HelpTopicVM, type FaqItemVM } from '../../lib/mapLearning'
import { mapCatalogPlayer, type CatalogPlayerVM } from '../../lib/mapPages'
import { openCustomerService } from '../../utils/customerService'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxHint } from '../../lib/pxFx'

const OUT_MS = 240 // 关面板下滑动画，同全站半屏

// 每实例一份（同 login-sheet）。videos/faq 是请求代次：快速退出再进同一子层时，慢回的旧请求不能盖掉新列表
const inst = new WeakMap<object, { videos: number; faq: number; gone: boolean }>()
const st = (c: object) => {
  let s = inst.get(c)
  if (!s) inst.set(c, (s = { videos: 0, faq: 0, gone: false }))
  return s
}

/** 提示挂在当前页的 px-fx 上。 */
const host = () => {
  const pages = getCurrentPages()
  return pages[pages.length - 1] as unknown as Parameters<typeof fxHint>[0]
}

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的 .k-*/.sh-* 与 player.wxss 的标题栏样式
  properties: {
    statusBarHeight: { type: Number, value: 0 },
  },
  data: {
    helpOut: false, // 退场动画中
    helpPanel: '' as '' | 'menu' | 'videos' | 'faq', // ''＝关闭
    helpVideosState: 'loading' as 'loading' | 'ok' | 'empty',
    helpTopics: [] as HelpTopicVM[],
    helpFaqState: 'loading' as 'loading' | 'ok' | 'empty' | 'fail', // 拉取失败≠没有 FAQ
    helpFaqList: [] as FaqItemVM[],
    helpSrc: '', // 非空＝正在面板内播放这段
    helpSegName: '',
    help: mapCatalogPlayer(null).help as CatalogPlayerVM['help'], // CMS 文案：先给默认，拉到再覆盖
  },
  lifetimes: {
    async attached() {
      const content = await getPageContent('catalogPlayer')
      if (st(this).gone) return
      this.setData({ help: mapCatalogPlayer(content).help })
    },
    detached() {
      st(this).gone = true
    },
  },
  methods: {
    onKeyDown: keyDown,
    onKeyUp: keyUp,
    open() {
      this.setData({ helpPanel: 'menu' })
    },
    /** 返回键：面板开着就逐层退（面板内播放→列表→menu→关），返回 true 表示已处理；关着返回 false。 */
    back(): boolean {
      const { helpSrc, helpPanel } = this.data
      if (!helpSrc && !helpPanel) return false
      this.setData(helpSrc ? { helpSrc: '', helpSegName: '' } : { helpPanel: helpPanel === 'menu' ? '' : 'menu' })
      return true
    },
    onHelpContact() {
      openCustomerService()
    },
    // 帮助视频每次进都重拉：地址是短时效的
    onHelpVideos() {
      this.setData({ helpPanel: 'videos', helpVideosState: 'loading', helpTopics: [] })
      void this.loadHelpVideos()
    },
    async loadHelpVideos() {
      const token = ++st(this).videos
      const r = await getHelpVideos()
      if (token !== st(this).videos || this.data.helpPanel !== 'videos') return
      const topics = mapHelpVideos(r)
      this.setData(topics.length ? { helpVideosState: 'ok', helpTopics: topics } : { helpVideosState: 'empty', helpTopics: [] })
    },
    // 常见问题：后台 CMS 填了就直接用，不再拉客服知识库
    onHelpFaq() {
      if ((this.data.help.faq || []).length > 0) {
        this.setData({ helpPanel: 'faq' })
        return
      }
      this.setData({ helpPanel: 'faq', helpFaqState: 'loading', helpFaqList: [] })
      void this.loadHelpFaq()
    },
    async loadHelpFaq() {
      const token = ++st(this).faq
      const r = await getPublicFaq()
      if (token !== st(this).faq || this.data.helpPanel !== 'faq') return
      if (!r.ok) {
        this.setData({ helpFaqState: 'fail', helpFaqList: [] })
        return
      }
      const list = mapPublicFaq(r) || []
      this.setData(list.length ? { helpFaqState: 'ok', helpFaqList: list } : { helpFaqState: 'empty', helpFaqList: [] })
    },
    onHelpBackMenu() {
      this.setData({ helpPanel: 'menu' })
    },
    // 点遮罩/关闭键：先播退场再真关；清 helpSrc 卸掉面板内 <video>，免得后台继续解码费流量
    onHelpClose() {
      if (this.data.helpOut) return
      this.setData({ helpOut: true })
      setTimeout(() => {
        if (st(this).gone) return
        this.setData({ helpOut: false, helpPanel: '', helpSrc: '', helpSegName: '' })
      }, OUT_MS)
    },
    onHelpPlaySegment(e: WechatMiniprogram.TouchEvent) {
      const ds = e.currentTarget.dataset as { url?: string; name?: string }
      const url = String(ds.url || '')
      if (!url) return // 没地址的段在模板里已置灰，双保险
      this.triggerEvent('pausemain')
      this.setData({ helpSrc: url, helpSegName: String(ds.name || '') })
    },
    // 回列表；主视频不自动恢复，用户自己点画面
    onHelpVideoBack() {
      this.setData({ helpSrc: '', helpSegName: '' })
    },
    onHelpVideoError() {
      fxHint(host(), '这段视频暂时播放不了')
    },
    noop() {}, // catch:touchmove 锁背景滚动要一个真实存在的 handler
  },
})
