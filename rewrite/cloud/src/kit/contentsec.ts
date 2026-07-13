import cloud from 'wx-server-sdk'

/**
 * 微信内容安全接缝（根因#12 平台接缝单点 + 根因#3 信任边界 fail-closed）。
 *
 * 用户上传的图片（UGC）入库前必过内容安全校验——节点诊断拍照（B2.2）是本项目第一个「用户图片入库」面，
 * 黄暴恐违规图直接入库＝合规风险。走云开发「云调用」cloud.openapi.security.imgSecCheck——access_token 由
 * 云环境注入、无需 AppSecret（同 kit/shipping 走 openapi，区别 kit/wecom 企业微信须自管 token）。
 *
 * **fail-CLOSED**（区别 kit/shipping 钱链 fail-soft）：UGC 是越权写面，校不过（违规）或校不了（能力未开/网络/
 * 取不到图）一律拒、不入库——「证明安全」才放行，不能证就拒。守卫 ugc-imgsecchecked 焊「写 checkpoints 前必调本接缝」。
 *
 * ⚠️ 真发前置（靠人·根因#8「拿到 ≠ 用通」）：① 部署产物 config.json 声明 openapi 权限 `security.imgSecCheck`
 *   （build.mjs OPENAPI_PERMS 自动产·守卫 openapi-perm-declared）；② mp 后台开通内容安全能力；③ 真机验图片
 *   真能拦黄暴恐（imgSecCheck v1 同步·errCode 87014=内容含违规信息）。代码替不了 ②③，只把链路做成「配好即生效」。
 */
export type SecResult = { ok: boolean; error?: string }

const RISKY = 87014 // 微信内容安全：图片含违规信息

// msgSecCheck v2 scene（文本使用场景·微信规范）：1 资料 / 2 评论 / 3 论坛 / 4 社交日志。
// UGC 文本按面归类——昵称/签名走资料，评价文本走评论；命中风险时 result.suggest==='risky'。
export const SCENE_PROFILE = 1
export const SCENE_COMMENT = 2

/** 校验云存储里一张图片（fileId）的内容安全。绝不抛错——失败一律收成 { ok:false }（fail-closed）。 */
export async function imgSecCheck(fileId: string): Promise<SecResult> {
  if (!fileId) return { ok: false, error: 'NO_FILE' }
  try {
    const dl = await (cloud as any).downloadFile({ fileList: [fileId] })
    const f = dl && dl.fileList && dl.fileList[0]
    const buf = f && f.fileContent
    if (!buf) return { ok: false, error: 'SEC_CHECK_FAIL' } // 取不到图内容 → fail-closed 拒
    const r = await (cloud as any).openapi.security.imgSecCheck({
      media: { contentType: 'image/png', value: buf },
    })
    const code = r && (r.errCode ?? r.errcode)
    if (code === RISKY) return { ok: false, error: 'IMG_RISKY' }
    if (code != null && code !== 0) return { ok: false, error: 'SEC_CHECK_FAIL' } // 非 0 非违规码 → 保守拒
    return { ok: true }
  } catch (e: any) {
    const code = e && (e.errCode ?? e.errcode)
    // 87014=内容违规；其余异常（能力未开通/网络）一律 fail-closed 拒（UGC 越权写面·根因#3）
    return { ok: false, error: code === RISKY ? 'IMG_RISKY' : 'SEC_CHECK_FAIL' }
  }
}

/**
 * 校验一段用户文本（评价文本/昵称/签名等 UGC）的内容安全。**与 imgSecCheck 同款 fail-closed**：
 * 走 cloud.openapi.security.msgSecCheck v2（需 openid + content + version:2 + scene）——违规
 * （errCode!==0 或 result.suggest==='risky'）或校不了（能力未开/网络/异常）一律拒；「证明安全」才放行。
 * 空串/纯空白直接通过（不外呼·省无谓计费调用）。绝不抛错——异常一律收成 { ok:false }。
 * 守卫 ugc-imgsecchecked 焊「文本 UGC 入库前必调本接缝」（文本 UGC＝评价 text/tags、昵称、签名）。
 */
export async function msgSecCheck(
  content: string,
  openid: string,
  scene: number = SCENE_COMMENT
): Promise<SecResult> {
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return { ok: true } // 空文本无需检测·不外呼
  try {
    const r = await (cloud as any).openapi.security.msgSecCheck({
      openid,
      content: text,
      version: 2,
      scene,
    })
    const code = r && (r.errCode ?? r.errcode)
    const suggest = r && r.result && r.result.suggest
    if (code != null && code !== 0) return { ok: false, error: 'SEC_CHECK_FAIL' } // 非 0 一律保守拒
    if (suggest === 'risky') return { ok: false, error: 'SEC_CHECK_FAIL' } // 平台判风险
    return { ok: true } // errCode:0 且非 risky（含 pass/review/无 suggest）→ 放行
  } catch {
    // 能力未开通/网络/权限未声明等异常一律 fail-closed 拒（UGC 越权写面·根因#3）
    return { ok: false, error: 'SEC_CHECK_FAIL' }
  }
}
