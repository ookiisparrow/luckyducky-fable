// 首页（重设计 9 板块·M2）：Hero/品牌/特写+商品轨/信任条/拆门槛折叠/买家秀/FAQ/收尾CTA/页脚。
// 数据经 api/catalog → app 网关；内容拿不到（网络/未部署）逐块回退设计默认文案（mapHomeContent），不空屏。
// 页只编排：把原始返回交给纯函数 mapHomeContent/mapProducts，再 setData（house style·同 detail/me）。
import { tapHaptic, dragTick } from '../../lib/haptics'
import { pendulumAt, FLIP_N, FLIP_ZERO } from '../../lib/flipLever'
import { getContent } from '../../api/catalog'
import { getAllProducts, getProductById } from '../../lib/catalog'
import { mapHomeContent, mapProducts, type HomeContentVM, type ProductVM, type StopmotionVM } from '../../lib/mapHome'
import { decideQuickAdd } from '../../lib/quickAdd'
import * as cart from '../../lib/cart'
import { consumeHomeTop } from '../../lib/homeIntent'
import { armExitAlert } from '../../utils/exitGuard'
import { loginGate } from '../../lib/loginGate'

let toastTimer: ReturnType<typeof setTimeout> | null = null

const SM_TICK_MS = 16 // 定格动画回摆/入场动画步进（≈60fps 定时器·同 flip-demo）

// 包内测试帧（CMS 未配齐 36 帧时的回退源·素材说明见 home.wxml 头注）：帧源整串在逻辑层拼，
// 模板只收 src——远程/包内两种来源才能共用同一套 <image>，不在 wxml 里分叉。
const SM_LOCAL_FRAMES = Array.from({ length: FLIP_N }, (_, i) => '/static/stopmotion/fr-' + String(i).padStart(2, '0') + '.jpg')
const SM_LOCAL_HERO = '/static/stopmotion/hi-' + String(FLIP_ZERO).padStart(2, '0') + '.jpg'

// 帧源身份（换没换素材的判据）：云端每次 getTempFileURL 都换签名参数，整串比对会让每次下拉刷新
// 都误判「换源」→ 白白重置门闸重下 36 张；只比路径部分，换的是真文件才算换源。
const smSourceKey = (frames: string[], hero: string): string =>
  frames
    .concat(hero)
    .map((u) => u.split('?')[0])
    .join('|')

Page({
  data: {
    statusBarHeight: 0,
    showSplash: true, // 冷启动品牌开屏：初值 true=首帧即盖上，纯计时器 splash 自撤后经 onSplashDone 置 false。
    // 挂 onLoad（每次冷启动一次），非 onShow——切 tab 回来/热恢复不重播（brand-splash 有界自撤守卫见 rw-mp-splash-auto-dismiss）
    loading: true,
    loadFailed: false,
    content: mapHomeContent(null) as HomeContentVM, // 首帧即默认文案·不空屏
    products: [] as ProductVM[],
    openReassure: 0, // 折叠默认首条展开（设计 CollapseGroup useState(0)）
    openFaq: 0,
    showTop: false,
    toast: { show: false, text: '' },
    // 定格动画（特写位）：帧源＝完整 src 数组（CMS 配齐 36 帧用远程·否则包内测试帧）；四通道喂 wxs（见 stopmotion.wxs 头注）
    smFrames: SM_LOCAL_FRAMES, // 首帧即包内素材（本地即时可显）；reload 拿到 CMS 帧再经 smApplySource 换源
    smHero: SM_LOCAL_HERO, // 定格层（1080²）
    smReady: false, // 加载门闸：36 张 bindload 齐才可拖（防拖到冷帧闪白）
    smHint: true, // 首次引导 chip（首拖即收）
    smMaxJ: 0, // 滑轨半行程 px（onReady 量得）
    smSettleX: 0, // 松手回摆/入场扫帧位移通道（逻辑层定时器 → wxs 落样式）
    smPhase: 'boot', // boot → moving ⇄ rest：转 rest 时 wxs 权威归位（帧 17 + 高清层淡入）
  },
  onLoad() {
    const info = wx.getWindowInfo()
    this.setData({ statusBarHeight: info.statusBarHeight })
    void this.reload()
  },
  // 定格动画非渲染态（不进 data：不触发 setData——同 flip-demo railState 范式）
  sm: { maxJ: 0, timer: 0 as ReturnType<typeof setInterval> | 0, loaded: 0, lastFrame: FLIP_ZERO, lastTickFrame: FLIP_ZERO },
  onReady() {
    // 量滑轨与滑钮宽出半行程：maxJ = 轨半宽 - 钮半宽 - 2（承 flip-demo railMax()）
    wx.createSelectorQuery()
      .in(this)
      .select('.sm-rail')
      .boundingClientRect()
      .select('.sm-fader')
      .boundingClientRect()
      .exec((res: { width: number }[]) => {
        if (res[0] && res[1]) {
          this.sm.maxJ = res[0].width / 2 - res[1].width / 2 - 2
          this.setData({ smMaxJ: this.sm.maxJ })
          this.smMaybeEnter()
        }
      })
  },
  hidden: false, // 已切走本 tab 标记（H·完备性扫描新增）：home 是 tabBar 页，切 tab/navigateTo 只触发 onHide、
  // 实例常驻不销毁（不适用 checkout 那套 onUnload→this.unloaded 家族）——quick-add 的 await 恢复点据此判断
  // 是否还站在本页，不把迟到回包的导航/角标同步/toast 打到用户已经切走之后的当前页面上。
  onShow() {
    this.hidden = false
    armExitAlert() // tabBar 根页误触退出提醒（返回二次确认·2026-07-13 用户反馈·覆盖边界见 utils/exitGuard）
    if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home')
    loginGate.maybePromptOnce() // 进 App 首个落地页即软门槛弹一次登录半屏（未同意时·本会话共用一次闸·可暂不登录先逛）
    // 兜底意图落地（我页无课/welcome先逛逛）回到顶部；正常切 tab 未置位则保留上次滚动位置（行为不变）
    if (consumeHomeTop()) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    // 定格动画自愈：动画中被切走（onHide 停了定时器）回来时 phase 转 rest → wxs 权威归位帧 17
    if (this.data.smReady && !this.sm.timer && this.data.smPhase === 'moving') this.setData({ smPhase: 'rest' })
  },
  onHide() {
    this.hidden = true
    this.smStop() // 切走 tab 停回摆/入场定时器（帧停在哪不管，onShow 转 rest 自愈归位）
  },
  async onPullDownRefresh() {
    await this.reload()
    wx.stopPullDownRefresh()
  },
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    const show = e.scrollTop > 900 // 滚过约一屏半露出「回到顶部」
    if (show !== this.data.showTop) this.setData({ showTop: show })
  },
  _seq: 0, // reload 代次（同 order-list 范式）：onLoad + 下拉刷新可能并发触发·丢弃被更晚 reload 取代的过期回包
  async reload() {
    const seq = ++this._seq
    // 强刷（force:true）：下拉刷新/首屏仍要最新数据，同时回填缓存供详情/购物车复用（省它们的云调用）。
    const [content, products] = await Promise.all([getContent(), getAllProducts({ force: true })])
    if (seq !== this._seq) return // 过期回包（被更晚 reload 取代）：丢弃·不覆盖较新结果
    const vm = mapHomeContent(content.ok ? content.home : null) // 逐块回退默认（不空屏·不半空）
    this.setData({
      loading: false,
      content: vm,
      products: mapProducts(products),
      loadFailed: products === null,
    })
    this.smApplySource(vm.stopmotion)
  },
  toggleReassure(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index)
    this.setData({ openReassure: this.data.openReassure === i ? -1 : i })
  },
  toggleFaq(e: WechatMiniprogram.TouchEvent) {
    const i = Number(e.currentTarget.dataset.index)
    this.setData({ openFaq: this.data.openFaq === i ? -1 : i })
  },
  onTapProduct(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },
  _addSeq: 0, // onAddProduct 代次（H3·完备性扫描新增·同 reload._seq 范式）：本页是 tabBar 页（onUnload 正常导航
  // 基本不触发，不适用 checkout 那套 this.unloaded 家族），连点不同商品「+」可并发在途——不设代际复核则更晚一次
  // 点击的结果可能被更早一次的迟到回包盖掉。切走本 tab（onHide）而非退出本页那条路见上面 hidden 字段（Round4 复审补漏）。
  // 首页「+」快速加购（2026-07-08 用户拍板改真加购；2026-07-13 用户拍板：「+」统一加入购物车，多规格默认加
  // 首个规格·不再跳详情）：单规格直加、多规格加首规格、原始记录取不到（缓存 miss 且网络失败）温和失败反馈
  // ——决策纯函数见 lib/quickAdd（navigate 分支已随本次决策删除·取不到出 null）。
  async onAddProduct(e: WechatMiniprogram.TouchEvent) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const seq = ++this._addSeq
    const raw = await getProductById(id)
    if (seq !== this._addSeq) return // 过期回包（被更晚一次 onAddProduct 取代）：丢弃·不提示
    const payload = decideQuickAdd(raw)
    if (payload) {
      cart.add(payload) // 数据侧动作照做（用户确实点了「+」）：即便已切走本 tab 也不该丢单
      if (this.hidden) return // 已切走 home tab（H·完备性扫描新增）：角标同步/toast 是本页 UI 副作用，用户已看不到，静默跳过
      if (typeof this.getTabBar === 'function') (this.getTabBar() as unknown as LdTabBar).setActive('home') // 角标随动（同 cart.ts:24 范式）
      // 多规格被默认加了首规格时把规格名亮给用户（自绘 ping 不受原生 toast 字数限制）——静默替选规格必须可见
      this.ping(payload.sku ? '已加入购物车 · ' + payload.sku : '已加入购物车')
    } else {
      if (this.hidden) return
      this.ping('商品信息获取失败，请稍后重试')
    }
  },
  toProducts() {
    tapHaptic()
    wx.pageScrollTo({ selector: '#friends', duration: 320 }) // 「购买」滚到商品轨（设计 scrollToProduct）
  },
  toIntro() {
    wx.pageScrollTo({ selector: '#intro', duration: 320 }) // 搜索胶囊滚到品牌介绍（设计 scrollToIntro）
  },
  backTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 320 })
  },
  // 品牌开屏淡出完成（brand-splash 计时器到点 triggerEvent('done')）：撤下覆盖层露出首页。
  onSplashDone() {
    this.setData({ showSplash: false })
  },

  /* ---------- 定格动画（特写位）：逻辑层半边 ---------- */
  // 换帧源（CMS 配齐 36 帧 → 远程；否则包内测试帧）。三件事必须一起做，缺一即真机事故：
  //  ① 门闸 smReady 归 false —— 新一批 <image> 要重新走 36 次 bindload，沿用旧门闸＝可拖到还没
  //     下载完的远程帧上闪白（正是门闸存在的理由，换源是它唯一真正生效的场景）；
  //  ② 计数器/定时器归零 —— loaded 不清零则新一批永远凑不满 FLIP_N，门闸再也开不了（死锁）；
  //  ③ phase 转 rest —— wx:for 列表整换会重建帧节点，WXS 之前 setStyle 的 opacity 随之丢失、
  //     DOM 回到模板初值（帧 17 可见），而 WXS 模块态 st.frame 还停在旧帧；转 rest 让 WXS 权威
  //     归位（applyX(0) → 帧 17 + 滑钮回中 + 高清层淡入），两边重新对齐。
  smApplySource(sm: StopmotionVM | null) {
    const frames = sm ? sm.frames : SM_LOCAL_FRAMES
    const hero = sm ? sm.hero : SM_LOCAL_HERO
    if (smSourceKey(frames, hero) === smSourceKey(this.data.smFrames, this.data.smHero)) return // 同一批素材：不折腾
    this.smStop()
    this.sm.loaded = 0
    this.sm.lastFrame = FLIP_ZERO
    this.sm.lastTickFrame = FLIP_ZERO
    this.smEntranceDone = false // 新素材重跑一次入场扫帧：它同时是这批帧的解码预热（见 smMaybeEnter 三重身份）
    this.setData({ smFrames: frames, smHero: hero, smReady: false, smPhase: 'rest', smSettleX: 0 })
  },
  // 加载门闸：36 张 scrub 帧 bindload 齐才放开拖动（防拖到未加载帧闪白）。包内回退素材本地即时，
  // 门闸真正吃劲的是 CMS 远程帧（网络下载有延迟）；binderror 也计数防死锁（某帧 404 不该锁死整个拖动）。
  onSmFrameLoad() {
    this.sm.loaded++
    if (this.sm.loaded === FLIP_N) {
      this.setData({ smReady: true })
      this.smMaybeEnter()
    }
  },
  onSmFrameError() {
    this.onSmFrameLoad()
  },
  // 入场扫帧（门闸开 + 滑轨量宽两条件齐才起跑·两回调竞态各自来敲一次）：左满行→右满行→钟摆归位。
  // 三重身份：① 开屏可见的「小鸭转一圈」入场动画；② 每帧都被绘制一遍 = 双端解码/光栅预热
  // （iOS 无 will-change 保证，这就是它的兜底，见 wxss 注释）；③ 顺带自证 36 帧全链可显示。
  smEntranceDone: false,
  smMaybeEnter() {
    if (this.smEntranceDone || !this.data.smReady || !this.sm.maxJ) return
    this.smEntranceDone = true
    const maxJ = this.sm.maxJ
    const D1 = 240 // 中位 → 左满行
    const D2 = 560 // 左满行 → 右满行（扫全 36 帧）
    const t0 = Date.now()
    this.smStop()
    // phase 转 moving → wxs 撤高清定格层，露出下面的扫帧动画（否则高清层压顶把入场转圈全遮住，
    // 且被完全遮挡的 scrub 帧不参与光栅/解码、预热落空）；扫帧结束 phase 转 rest 时再淡回高清层。
    this.setData({ smPhase: 'moving' })
    this.sm.timer = setInterval(() => {
      const t = Date.now() - t0
      if (t < D1) {
        const k = t / D1
        this.setData({ smSettleX: -maxJ * k * (2 - k) }) // easeOut 探左
        return
      }
      if (t < D1 + D2) {
        this.setData({ smSettleX: -maxJ + 2 * maxJ * ((t - D1) / D2) }) // 匀速扫右
        return
      }
      const { x, done } = pendulumAt(maxJ, t - D1 - D2) // 右满行起钟摆归位
      this.setData({ smSettleX: x })
      if (done) {
        this.smStop()
        this.setData({ smPhase: 'rest' })
      }
    }, SM_TICK_MS)
  },
  // wxs 首拖回调：停回摆定时器 + 收引导 chip + phase 转 moving（rest 的高清层已被 wxs 同步撤下）
  onSmDragState() {
    this.smStop()
    this.sm.lastTickFrame = this.sm.lastFrame
    const patch: { smPhase: string; smHint?: boolean } = { smPhase: 'moving' }
    if (this.data.smHint) patch.smHint = false
    this.setData(patch)
  },
  // wxs 指下翻帧回调（仅拖动中触发）：逐格「嗒」走 lib/haptics 单源（40ms 钳制快扫跳齿·配方真机拍板版）
  onSmFrameTick(e: { frame: number }) {
    this.sm.lastFrame = e.frame
    if (dragTick(this.sm.lastTickFrame, e.frame)) this.sm.lastTickFrame = e.frame
  },
  // wxs 松手回调：阻尼钟摆回中（数学同 flip-demo 方案一·pendulumAt），摆过中点轻震；终点 phase 转 rest
  onSmRelease(e: { x: number }) {
    this.smStop()
    const x0 = e.x
    if (!x0) {
      this.setData({ smPhase: 'rest' })
      return
    }
    const t0 = Date.now()
    let prevX = x0
    this.sm.timer = setInterval(() => {
      const { x, done } = pendulumAt(x0, Date.now() - t0)
      if ((prevX > 0 && x < 0) || (prevX < 0 && x > 0)) tapHaptic('light') // 过中点（事件震·80ms 地板）
      prevX = x
      this.setData({ smSettleX: x })
      if (done) {
        this.smStop()
        this.setData({ smPhase: 'rest' })
      }
    }, SM_TICK_MS)
  },
  smStop() {
    if (this.sm.timer) {
      clearInterval(this.sm.timer)
      this.sm.timer = 0
    }
  },
  // bug sweep II L3：页脚链接架构无 href 字段（admin 只存纯文本 label），本无法通用跳转——「关于我们」
  // 是唯一已上线且默认安装态必现的 label（/pages/about/about 已注册·me 页也有正常入口），单独映射修复
  // 默认误报「敬请期待」；其余 label 无对应页仍是合法占位（不加配置面/不引 href 机制，运营真需要再配跳转）。
  onTapFooterLink(e: WechatMiniprogram.TouchEvent) {
    const label = String(e.currentTarget.dataset.label || '')
    if (label === '关于我们') {
      wx.navigateTo({ url: '/pages/about/about' })
      return
    }
    this.ping(label + ' · 敬请期待')
  },
  ping(text: string) {
    if (toastTimer) clearTimeout(toastTimer)
    this.setData({ toast: { show: true, text } })
    toastTimer = setTimeout(() => this.setData({ 'toast.show': false }), 1600)
  },

  // 转发/朋友圈钩子（分发前置·决策§29·守卫 rw-mp-share-wired）：公开页开转发，私有页（交易/学习/隐私）
  // 刻意不加钩子＝默认不可转发。不配 imageUrl——微信默认截页面顶部真身，不造假分享图。
  onShareAppMessage() {
    return { title: '小棉鸭钩织材料包｜一针一线，钩出随身幸运物', path: '/pages/home/home' }
  },
  onShareTimeline() {
    return { title: '小棉鸭钩织材料包｜一针一线，钩出随身幸运物' }
  },
})
