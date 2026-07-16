// 品牌字体（文源圆体 WenYuan Rounded SC）分层远程加载单源（字体分层批·2026-07-16 工作流实测定档）——
// 三层字族 + URL + 缓存 + 调度集中一处。改域名/文件名/分层只改这里（+ 构建脚本 scripts/build-brand-font.mjs）。
//
// 为什么分层（旧方案：GB2312 一级 3755 字整包两档 ~1.9MB，全下完首屏才换字）：真实上屏只 ~890 字，
// tab 首屏闭包仅 ~430 字。分层后首屏所需 220KB（-88%），好网络下大概率赶在 brand-splash 2s 窗口内到达：
//   tier1（首屏·110KB/档）→ tier2（二级页·111KB/档）→ tier3（GB2312 兜底·UGC 昵称/评价/地址·765KB/档）
// 逐层接力加载（上层落定才起下层=带宽让给首屏）；每层一个字族，回退栈 T1→T2→T3→系统圆体
// （styles/tokens.wxss --ld-font-brand）按 CSS 逐字回退语义补字——T1 没有的字自动用 T2/T3 渲染，
// 坏情况=个别字暂显系统圆体（与 FOUT 相同·无正确性悬崖）。刻意不用「同族多次 loadFontFace 增量合并」：
// 官方未定义该语义（2026-07-16 对抗核查·大概率覆盖或去重忽略），不拿未定义行为当地基。
//
// 加载策略——绕 CORS（承 2026-06-29 真机定案·真凶=CloudBase 静态托管 CDN 不发
// Access-Control-Allow-Origin，渲染层 loadFontFace(网络URL) 报 ERR_CACHE_MISS）：
//   downloadFile（逻辑层·不受跨域限制）→ 读 base64 → loadFontFace(data URI)。source 传本地文件路径
//   不可行——官方文档明文 source 只支持「https 链接或 Data URL」（2026-07-16 核查钉死，别再试）。
//
// 持久缓存（新增·官方文件系统文档背书「本地用户文件清理时机跟代码包一样」=跨冷启动持久·上限 200MB）：
//   首启 downloadFile → copyFile 落 USER_DATA_PATH/brand-fonts/ → 二次冷启动本地直读零网络（飞行模式也有
//   品牌字）。文件名带版本号（v2）＝天然缓存失效：版本升级后旧文件名不再被引用，启动时顺手清理。
//   CDN 侧 max-age 仅 120s 几乎次次回源（2026-07-16 实测），本地缓存是把「每次冷启 1.9MB」降为零的主杠杆。
//
// 弱网加固（新增）：downloadFile 显式 timeout + 失败退避重试 2 次（3s/8s）——旧线曾有的重试是错误假设
// （onLaunch 时机）下加的、随真因（CORS）修复删除；本次为「瞬断=整会话系统字」这一真缺口重加，语义不同。
//
// ⚠ 用 woff 不用 woff2（官方建议格式仅 TTF/WOFF·woff2 真机静默失败·2026-06-29 真机逮出）。
// ⚠ 子集产物正本在仓根 assets/brand-fonts/（不进包·守卫 font-not-in-package），部署到静态托管 /fonts/。
// ⚠ 字符集覆盖由守卫 rw-mp-font-tier-subset-covers 机器盯（新增文案带来子集外新字即红）。
// ⚠ 用默认域名 cloudbase-….tcloudbaseapp.com（DigiCert·同视频域名 CA）不用自有 www.luckyducky.cn
//   （TrustAsia·手机微信对 CA 挑剔）。域名须在小程序后台「downloadFile 合法域名」内。
// ⚠ base64 Data URL 官方地板=基础库 3.7.9（此前属未定义行为碰巧能用）；分层后单文件 base64 过桥
//   110KB→147KB 字符，远小于旧方案 1.3MB/档，体量坑同步缓解。

export const BRAND_FONT_FAMILY = 'WenYuan Rounded SC' // tier1（首屏·族名沿用，消费方零改动）
export const BRAND_FONT_FAMILY_T2 = 'WenYuan Rounded SC T2' // tier2（二级页）
export const BRAND_FONT_FAMILY_T3 = 'WenYuan Rounded SC T3' // tier3（GB2312 兜底）

const FONT_HOST = 'https://cloudbase-d4gcssqbv06865479-1440904924.tcloudbaseapp.com'

// 三层 × 两字重（500/700 两档；600 就近落 700、400 就近落 500——全仓 wxss 声明仅此四档，已覆盖）。
// 文件名与 scripts/build-brand-font.mjs 产物一致（版本号 v2 进文件名·CDN/本地缓存失效靠改名），
// tests/brand-font.test.ts 钉形状。tier 顺序即加载顺序（首屏最先）。
export const BRAND_FONT_TIERS = [
  {
    family: BRAND_FONT_FAMILY,
    files: [
      { weight: '500', name: 'wenyuan-tier1-medium.v2.woff' },
      { weight: '700', name: 'wenyuan-tier1-bold.v2.woff' },
    ],
  },
  {
    family: BRAND_FONT_FAMILY_T2,
    files: [
      { weight: '500', name: 'wenyuan-tier2-medium.v2.woff' },
      { weight: '700', name: 'wenyuan-tier2-bold.v2.woff' },
    ],
  },
  {
    family: BRAND_FONT_FAMILY_T3,
    files: [
      { weight: '500', name: 'wenyuan-tier3-medium.v2.woff' },
      { weight: '700', name: 'wenyuan-tier3-bold.v2.woff' },
    ],
  },
]

const DOWNLOAD_TIMEOUT_MS = 30000 // 显式超时：弱网单发不设限会悬挂到全局默认太久（现状盘点缺口）
const RETRY_DELAYS_MS = [3000, 8000] // 下载失败退避重试（2 次后放弃该文件·该层其余文件不受影响）

/**
 * 远程分层加载品牌字体。失败不阻断启动（策略承老线）；字体降级本身无害（纯视觉回退系统字体/下层字族，
 * 非根因#14「动作类失败」范畴），任一环节失败刻意静默，不引 console、不 throw。
 * 缓存目录不可用（极老基础库/存储异常）时自动退化为「纯下载不落盘」，行为=旧方案。
 */
export function loadBrandFonts(): void {
  const fs = wx.getFileSystemManager()
  const cacheDir = getCacheDir()
  if (cacheDir) prepareCacheDir(fs, cacheDir)
  loadTier(fs, cacheDir, 0)
}

// USER_DATA_PATH（官方保证跨冷启动持久）；wx.env 缺失的极老环境退化为不缓存。
function getCacheDir(): string | null {
  const env = (wx as unknown as { env?: { USER_DATA_PATH?: string } }).env
  return env && env.USER_DATA_PATH ? `${env.USER_DATA_PATH}/brand-fonts` : null
}

// 建缓存目录 + 清理过期版本文件（版本升级后旧文件名不再被引用，启动时顺手删防积累）。
function prepareCacheDir(fs: WechatMiniprogram.FileSystemManager, dir: string): void {
  fs.mkdir({
    dirPath: dir,
    recursive: true,
    complete: () => {
      fs.readdir({
        dirPath: dir,
        success: ({ files }) => {
          const current = new Set(BRAND_FONT_TIERS.flatMap((t) => t.files.map((f) => f.name)))
          for (const f of files) {
            if (!current.has(f)) fs.unlink({ filePath: `${dir}/${f}`, fail: () => {} }) // 刻意静默：清理失败无害
          }
        },
        fail: () => {}, // 刻意静默：读目录失败不影响加载
      })
    },
  })
}

// 逐层接力：本层全部文件落定（成功或最终失败）才起下一层——带宽优先级=首屏最先（用户拍板口径）。
function loadTier(fs: WechatMiniprogram.FileSystemManager, cacheDir: string | null, tierIndex: number): void {
  const tier = BRAND_FONT_TIERS[tierIndex]
  if (!tier) return
  let pending = tier.files.length
  const settle = () => {
    pending--
    if (pending === 0) loadTier(fs, cacheDir, tierIndex + 1)
  }
  for (const file of tier.files) {
    getFontBase64(fs, cacheDir, file.name, (data, fromCache, cachePath) => {
      if (!data) return settle() // 取不到（下载最终失败）：跳过该字重，回退栈兜底
      wx.loadFontFace({
        global: true,
        family: tier.family,
        source: `url("data:font/woff;charset=utf-8;base64,${data}")`,
        desc: { weight: file.weight },
        complete: settle,
        fail: () => {
          // 缓存文件解析失败（写坏/截断）：删缓存，下次冷启动重新下载自愈；本次会话该字重走回退栈。
          if (fromCache && cachePath) fs.unlink({ filePath: cachePath, fail: () => {} })
        },
      })
    })
  }
}

// 取字体 base64：缓存命中本地直读（零网络）；未命中下载 → 回调交付 → 异步落盘（落盘失败不影响本次渲染）。
function getFontBase64(
  fs: WechatMiniprogram.FileSystemManager,
  cacheDir: string | null,
  name: string,
  cb: (data: string | null, fromCache: boolean, cachePath: string | null) => void
): void {
  const cachePath = cacheDir ? `${cacheDir}/${name}` : null
  const download = () => downloadFont(fs, name, cachePath, cb)
  if (!cachePath) return download()
  fs.readFile({
    filePath: cachePath,
    encoding: 'base64',
    success: ({ data }) => cb(data as string, true, cachePath),
    fail: download, // 未命中/读失败 → 下载
  })
}

function downloadFont(
  fs: WechatMiniprogram.FileSystemManager,
  name: string,
  cachePath: string | null,
  cb: (data: string | null, fromCache: boolean, cachePath: string | null) => void,
  attempt = 0
): void {
  const retry = () => {
    const delay = RETRY_DELAYS_MS[attempt]
    if (delay === undefined) return cb(null, false, null) // 重试耗尽：本会话该字重放弃（静默·降级无害）
    setTimeout(() => downloadFont(fs, name, cachePath, cb, attempt + 1), delay)
  }
  wx.downloadFile({
    url: `${FONT_HOST}/fonts/${name}`,
    timeout: DOWNLOAD_TIMEOUT_MS,
    success: (res) => {
      if (res.statusCode !== 200) return retry() // 非 200（404/5xx）也重试：CDN 抖动与瞬断同待遇
      fs.readFile({
        filePath: res.tempFilePath,
        encoding: 'base64',
        success: ({ data }) => {
          cb(data as string, false, null) // 先交付渲染，再异步落盘（落盘失败不牺牲本次换字）
          if (cachePath) fs.copyFile({ srcPath: res.tempFilePath, destPath: cachePath, fail: () => {} })
        },
        fail: () => cb(null, false, null), // 临时文件读失败：不重试（非网络问题·刻意静默）
      })
    },
    fail: retry,
  })
}
