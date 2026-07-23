// 五页 CMS 内容映射（纯函数·vitest 钉行为·守卫 rw-mp-page-content-golden）：云端 getPageContent → 视图模型。
// 内容纪律（同 mapHome 黄金 §九）：整档 null / 逐块缺 / 逐字段空 都回退「设计默认文案」——CMS 拉不到或
// 字段被误清空时页面永不空白、不报错（fail-soft）。默认值 = 各页面重设计原稿，逐字搬入本文件单源。
// welcome.warning（不可退货告知义务）空则强制回默认，不允许被清空；me 未知 key 忽略、visible===false 才隐藏；
// about/agreement sections 空数组用默认全文；catalogPlayer.catalog.heroImage 空 → undefined（页面走 bgFor 回退链）。
import { BRAND_NAME, BRAND_SLOGAN_EN } from './brand'

// ── 小工具（同 mapHome 口径·脏档安全；本文件单源，不跨 lib 复用私有 helper·病根#5 判例：宁可小重复）──
type Dict = Record<string, unknown>
/** 取纯对象；数组/原始值/空 → {}（逐块回退默认的地基）。 */
const obj = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {})
/** 取字符串并去首尾空白；空 → 默认（空串也算缺·防半空）。 */
const str = (v: unknown, def: string): string => {
  const s = (v == null ? '' : String(v)).trim()
  return s || def
}
/** 取非空字符串或 undefined（heroImage 用：空 → undefined 让页面走 bgFor 回退链）。 */
const strOrUndef = (v: unknown): string | undefined => {
  const s = (v == null ? '' : String(v)).trim()
  return s || undefined
}
/** 数组块：非空数组 → 逐项净化（脏项剔除）；空/缺/整组全脏 → 默认整组（黄金 §九·防误清空）。 */
function arr<T>(raw: unknown, mapItem: (x: unknown) => T | null, def: T[]): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return def
  const out: T[] = []
  for (const it of raw) {
    const m = mapItem(it)
    if (m) out.push(m)
  }
  return out.length ? out : def
}

// ═══════════════ 激活页 welcome（W1 恭喜屏 + W2 三件事屏）═══════════════
export interface WelcomePointVM {
  icon: string // 图标名（tied to position·CMS 不含图标字段，恒取默认）
  title: string
  desc: string
}
export interface WelcomeVM {
  w1: { title: string; sub: string; warning: string }
  w2: { items: WelcomePointVM[] }
}

// 默认文案（welcome.wxml W1/W2 逐字搬入）
const WELCOME_W1_DEFAULT = {
  title: '恭喜你，开启新课程',
  sub: '接下来的几个小时里，一团棉线会在你手上变成一只带来幸运的小棉鸭。',
  warning: '确认进课后，这份材料包将不可退货', // 告知义务·空则强制回默认（不允许被清空）
}
const WELCOME_W2_DEFAULT: WelcomePointVM[] = [
  { icon: 'clapperboard', title: '跟着分段视频，一步一步来', desc: '每节课拆成了很短的小段落，看一段钩一段，不用倒来倒去找位置。' },
  { icon: 'life-buoy', title: '卡住了，随时按「求助」', desc: '播放页中间那颗按钮永远在——联系客服、帮助视频、常见问题都在里面。' },
  { icon: 'bookmark-check', title: '进度自动保存', desc: '随时离开随时回来，下次打开直接接着上次的位置继续。' },
]

/** welcome 内容映射：W1 逐字段回退；W2 固定三点位（图标 tied to position）逐字段回退——CMS 只覆盖 title/desc。 */
export function mapWelcome(content: unknown): WelcomeVM {
  const c = obj(content)
  const w1 = obj(c.w1)
  const w2 = obj(c.w2)
  const items = Array.isArray(w2.items) ? w2.items : []
  return {
    w1: {
      title: str(w1.title, WELCOME_W1_DEFAULT.title),
      sub: str(w1.sub, WELCOME_W1_DEFAULT.sub),
      warning: str(w1.warning, WELCOME_W1_DEFAULT.warning),
    },
    w2: {
      // 三点位是固定 onboarding 布局、图标与位置绑定：逐槽位取 CMS title/desc、缺则回退默认，图标恒取默认槽位。
      items: WELCOME_W2_DEFAULT.map((d, i) => {
        const it = obj(items[i])
        return { icon: d.icon, title: str(it.title, d.title), desc: str(it.desc, d.desc) }
      }),
    },
  }
}

// ═══════════════ 目录页 + 播放页共享内容 catalogPlayer ═══════════════
export interface CatalogPlayerVM {
  catalog: { heroImage: string | undefined; resumeCta: string; emptyLesson: string }
  help: {
    contactTitle: string
    videosTitle: string
    faqTitle: string
    faq: { q: string; a: string }[] // 默认空数组：无 CMS FAQ → 播放页维持诚实空态导流客服（不造假 Q&A）
  }
}

const CATALOG_DEFAULT = {
  resumeCta: '开始学习', // catalog.wxml「开始学习」CTA
  emptyLesson: '这节课还在整理中', // catalog.ts onTapLesson 空态 toast
}
const HELP_DEFAULT = {
  contactTitle: '联系客服', // player.wxml 求助面板三卡标题
  videosTitle: '帮助视频',
  faqTitle: '常见问题',
}

const faqItem = (raw: unknown): { q: string; a: string } | null => {
  const x = obj(raw)
  const q = str(x.q, '')
  return q ? { q, a: str(x.a, '') } : null // 无问题的脏条剔除
}

/** catalogPlayer 内容映射：目录页取 catalog.*、播放页取 help.*；heroImage 空 → undefined（页面走 bgFor）。 */
export function mapCatalogPlayer(content: unknown): CatalogPlayerVM {
  const c = obj(content)
  const catalog = obj(c.catalog)
  const help = obj(c.help)
  return {
    catalog: {
      heroImage: strOrUndef(catalog.heroImage),
      resumeCta: str(catalog.resumeCta, CATALOG_DEFAULT.resumeCta),
      emptyLesson: str(catalog.emptyLesson, CATALOG_DEFAULT.emptyLesson),
    },
    help: {
      contactTitle: str(help.contactTitle, HELP_DEFAULT.contactTitle),
      videosTitle: str(help.videosTitle, HELP_DEFAULT.videosTitle),
      faqTitle: str(help.faqTitle, HELP_DEFAULT.faqTitle),
      faq: arr(help.faq, faqItem, []), // 空/全脏 → [] → 播放页诚实空态
    },
  }
}

// ═══════════════ 「我」页 me → 拆至 lib/mapMe.ts（原名 re-export·消费方不变）═══════════════
// 为什么拆：me 是 tab 首屏页，其 ts import 闭包决定品牌字体 tier1（首屏子集）字符面；本文件的
// 协议/隐私法务长文只在二级页上屏，同住会把 511 字拖进首屏子集（守卫 rw-mp-font-tier-subset-covers）。
// me.ts 直引 lib/mapMe；这里 re-export 保住「五页 mapper 单源入口」与既有测试/守卫引用。
export { mapMe } from './mapMe'
export type { MeEntryKey, MeEntryVM, MeVM } from './mapMe'

// ═══════════════ 关于我们 about ═══════════════
export interface AboutSectionVM {
  title: string
  body: string
}
export interface AboutVM {
  lead: string
  sections: AboutSectionVM[]
}

const ABOUT_LEAD_DEFAULT = '我们希望每个人都能亲手创造自己的随身幸运物。'
const ABOUT_SECTIONS_DEFAULT: AboutSectionVM[] = [
  { title: '我们是谁', body: `${BRAND_NAME} 是一家专注钩织的材料包品牌。我们把毛线、配件、工具与配套教学打包成一个个材料包，让没有基础的人也能从第一针开始，亲手钩出属于自己的小鸭与小物。` },
  { title: '我们做什么', body: '每一份材料包都配有分步教学视频：扫码开课，跟着视频一针一线，把一团毛线变成可以随身携带的幸运物。从选材到教学，我们只想让「开始」这件事变得足够简单。' },
  { title: '我们相信', body: `${BRAND_SLOGAN_EN}。手作的温度来自亲手完成的那一刻——当你为自己或在乎的人钩出一只小鸭，幸运也随之被你亲手创造出来。` },
]

const aboutSection = (raw: unknown): AboutSectionVM | null => {
  const x = obj(raw)
  const title = str(x.title, '')
  return title ? { title, body: str(x.body, '') } : null // 无标题的脏段剔除
}

/** about 内容映射：lead 逐字段回退；sections 空/全脏 → 默认三段全文。 */
export function mapAbout(content: unknown): AboutVM {
  const c = obj(content)
  return {
    lead: str(c.lead, ABOUT_LEAD_DEFAULT),
    sections: arr(c.sections, aboutSection, ABOUT_SECTIONS_DEFAULT),
  }
}

// ═══════════════ 用户协议 / 隐私政策 agreement ═══════════════
// 条款正文逐字承接旧线（2026-06-27 经营者评估拍板上线的已过审文案）：intro（引言）与 title 为固定法律
// 文本、不经 CMS 覆盖（合规文案勿随意改·契约无 intro/title 字段）；CMS 仅覆盖 effectiveDate（更新日期）
// 与 sections（条款条目）。sections 空数组 → 回退默认全文（防误清空上线过审文本）。
export interface AgreementArticleVM {
  title: string
  body: string
}
export interface AgreementDocVM {
  title: string
  updated: string
  intro: string
  articles: AgreementArticleVM[]
}
export interface AgreementVM {
  user: AgreementDocVM
  privacy: AgreementDocVM
}

const USER_DEFAULT: AgreementDocVM = {
  title: '用户协议',
  updated: '2026-06',
  intro: `欢迎使用${BRAND_NAME}（以下称“本小程序”）。本协议是你与本小程序经营者之间就使用本小程序服务所订立的协议。请你在使用前仔细阅读，特别是关于退货权、免除或限制责任的条款。你勾选同意或开始使用本小程序，即视为已阅读并接受本协议全部内容。`,
  articles: [
    { title: '第一条 服务内容', body: '本小程序提供钩织材料包等实物商品的在线销售，以及与所购商品配套的钩织教学视频课程的在线观看服务。' },
    { title: '第二条 账户与登录', body: '本小程序以你的微信账号标识（openid）为你建立身份，采用“软门槛”设计：你可先行浏览，在下单、查看课程等需要身份的环节再登录。本小程序登录不索取你的手机号。请妥善使用你的账户，账户下发生的行为由你负责。' },
    { title: '第三条 下单与支付', body: '商品价格、优惠及应付金额以本小程序结算页最终展示并由服务器核定为准。为防止篡改，定价与金额一律以服务器计算结果为准，不以客户端显示为准。支付通过微信支付完成。' },
    { title: '第四条 课程开通与退货权的重要说明', body: '材料包内含用于开通配套课程的唯一二维码。请特别注意：一旦你扫码并确认开始观看课程，即视为该件商品所含数字内容已实质交付，你将就该件商品失去七天无理由退货的权利。此为重要条款，你下单及扫码即表示已知悉并同意。' },
    { title: '第五条 退换货与售后', body: '在你尚未确认开始观看课程的前提下，符合法律规定与平台规则的商品可申请退换货；退款将按订单实际支付情况由服务器分摊核算后原路退回。具体以本小程序售后流程及适用法律为准。' },
    { title: '第六条 知识产权', body: '本小程序内的课程视频、图文、商标及版面等内容的知识产权归相应权利人所有。课程视频仅供你个人学习观看，未经许可不得录制、下载、传播、转售或用于任何商业用途。' },
    { title: '第七条 用户行为规范', body: '你不得利用本小程序从事任何违法违规活动，不得通过技术手段干扰服务运行、窃取内容或损害他人合法权益。如有违反，我们有权中止或终止向你提供服务，并依法追究责任。' },
    { title: '第八条 责任限制', body: '因不可抗力，或微信、网络、支付通道等第三方服务故障等非本小程序可控原因导致服务中断、延迟或数据异常的，我们在法律允许的范围内不承担责任，但将尽合理努力协助你处理。' },
    { title: '第九条 协议变更', body: '我们可能根据业务发展及法律法规的变化更新本协议，更新后将在本小程序内公示。变更生效后你继续使用本小程序，即视为接受变更后的协议。' },
    { title: '第十条 适用法律与争议解决', body: '本协议的订立、效力、解释及争议解决均适用中华人民共和国法律。因本协议产生的争议，双方应友好协商解决；协商不成的，可依法向有管辖权的人民法院提起诉讼。' },
  ],
}

const PRIVACY_DEFAULT: AgreementDocVM = {
  title: '隐私政策',
  updated: '2026-06',
  intro: `${BRAND_NAME}（以下称“本小程序”）尊重并保护你的个人信息。本政策说明我们如何收集、使用、存储与保护你的信息，以及你享有的权利。我们仅在为你提供服务所必需的范围内收集信息，坚持“最小必要”原则。特别说明：本小程序不通过微信授权获取你的手机号（下单时的收货联系电话由你自行填写、仅用于配送联系）。`,
  articles: [
    { title: '第一条 我们收集的信息', body: '为向你提供服务，我们可能收集：① 微信账号标识（openid），用于建立你的身份；② 你在“编辑资料”中主动填写的头像、昵称与个性签名；③ 你下单时提供的收货信息（收货人、联系电话、收货地址）；④ 订单与交易信息；⑤ 你的课程学习进度与互动记录；⑥ 你通过客服与我们沟通时发送的消息内容（客服会话记录），用于响应你的咨询、处理售后并改进服务质量。上述收货联系电话由你自行填写、仅用于配送联系；我们不通过微信授权获取你的手机号。' },
    { title: '第二条 我们如何使用信息', body: '上述信息用于：完成身份识别与登录、处理订单与支付、安排发货与售后、为你开通并记录课程学习进度、保障交易与账户安全，以及在你同意的范围内改进服务体验。' },
    { title: '第三条 对外提供与第三方', body: '为完成支付与退款，相关交易信息会提供给微信支付；本小程序基于微信云开发（腾讯云）提供后端服务与数据存储；当你在订单中查询物流轨迹时，相关快递单号会提供给第三方物流查询服务“快递100”，仅用于查询并向你展示配送进度。为向你提供客服与售后支持，我们可能安排外包或第三方客服（受托客服人员）在为你服务所必需的范围内查看你的订单、物流、学习进度与咨询记录等数据以响应你的请求；此类第三方受托客服访问以你的同意为前提，你可随时在小程序内查看并撤回该数据共享授权（撤回后不影响此前已依约进行的处理）。除法律要求或为完成上述服务所必需外，我们不会向第三方提供你的个人信息。你提供的收货信息在你选择配送时用于履约。' },
    { title: '第四条 信息的存储与安全', body: '你的信息存储于微信云开发所在的中国境内服务器。我们采取访问控制、最小权限、服务端校验等合理措施保护信息安全；但请理解，任何措施都无法保证信息的绝对安全。' },
    { title: '第五条 信息的存储期限', body: '我们仅在为你提供服务所必需的期间内保存你的信息。超出该期间，或你注销账户后，我们将对你的个人信息进行删除或匿名化处理（法律另有规定的除外）。' },
    { title: '第六条 你的权利', body: '你有权查询、更正你的资料（可在“编辑资料”中修改），有权要求删除你的个人信息或注销账户，也可以撤回此前作出的授权同意。我们将依法依规及时响应你的请求。' },
    { title: '第七条 未成年人保护', body: '若你是未成年人，请在监护人的指导下使用本小程序并提供信息。我们不会在明知的情况下收集未满十四周岁儿童的个人信息；如发现此类情况，将尽快删除相关信息。' },
    { title: '第八条 微信隐私授权', body: '当本小程序需要调用涉及隐私的微信接口时，会在调用前请求你的授权，你可选择同意或拒绝；拒绝不影响你使用与该接口无关的其他功能。相关授权说明亦见微信侧《小程序用户隐私保护指引》。' },
    { title: '第九条 政策更新', body: '我们可能适时更新本政策，更新后将在本小程序内公示；涉及重大变更的，我们会以显著方式提示你。' },
    { title: '第十条 联系我们', body: '如你对本政策或个人信息处理有任何疑问、意见或投诉，可通过本小程序内的客服入口与我们联系，我们将尽快为你处理。' },
  ],
}

const agreementArticle = (raw: unknown): AgreementArticleVM | null => {
  const x = obj(raw)
  const title = str(x.title, '')
  return title ? { title, body: str(x.body, '') } : null
}

/** 单文档映射（user/privacy 共用）：effectiveDate→更新日期回退默认；sections→条款条目、空/全脏回退默认全文；
 *  intro/title 为固定合规文本恒取默认（契约无字段·勿被 CMS 覆盖）。 */
function mapAgreementDoc(raw: unknown, def: AgreementDocVM): AgreementDocVM {
  const d = obj(raw)
  return {
    title: def.title, // 固定（导航栏标题·契约无字段）
    updated: str(d.effectiveDate, def.updated),
    intro: def.intro, // 固定合规引言（契约无字段·勿覆盖）
    articles: arr(d.sections, agreementArticle, def.articles),
  }
}

/** agreement 内容映射：user/privacy 两文档各自回退默认全文。 */
export function mapAgreement(content: unknown): AgreementVM {
  const c = obj(content)
  return {
    user: mapAgreementDoc(c.user, USER_DEFAULT),
    privacy: mapAgreementDoc(c.privacy, PRIVACY_DEFAULT),
  }
}
