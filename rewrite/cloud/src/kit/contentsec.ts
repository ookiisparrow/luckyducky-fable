import cloud from 'wx-server-sdk'
import { ERR } from '@ldrw/shared'
import { alert } from './observe'
import { err } from './reply'

/**
 * 微信内容安全接缝（根因#12 平台接缝单点 + 根因#3 信任边界 fail-closed）。
 *
 * 用户上传的图片（UGC）入库前必过内容安全校验——节点诊断拍照是本项目第一个「用户图片入库」面，
 * 黄暴恐违规图直接入库＝合规风险。走云开发「云调用」cloud.openapi.security.imgSecCheck——access_token 由
 * 云环境注入、无需 AppSecret（同 kit/shipping 走 openapi，区别 kit/wecom 企业微信须自管 token）。
 *
 * **图片 + 评价/资料文本 = fail-CLOSED**（区别 kit/shipping 钱链 fail-soft）：公开展示 UGC，校不过或校不了一律拒。
 * **客服打字 / 意见反馈 = fail-OPEN**（`msgSecCheck(..., 'open')`）：真违规仍拒；接口抖动放行并记 `SEC_CHECK_INFRA`，
 * 安检挂了不能卡死顾客通道。守卫 ugc-imgsecchecked 焊公开 UGC 写面。
 *
 * ⚠️ 真发前置（靠人·根因#8「拿到 ≠ 用通」）：① 部署产物 config.json 声明 openapi 权限 `security.imgSecCheck`
 *   （build.mjs OPENAPI_PERMS 自动产·守卫 rw-openapi-perm-declared）；② mp 后台开通内容安全能力；③ 真机验图片
 *   真能拦黄暴恐（imgSecCheck v1 同步·errCode 87014=内容含违规信息）。代码替不了 ②③，只把链路做成「配好即生效」。
 */
type SecResult = { ok: boolean; error?: string }

const RISKY = 87014 // 微信内容安全：图片含违规信息

// msgSecCheck v2 scene（文本使用场景·微信规范）：1 资料 / 2 评论 / 3 论坛 / 4 社交日志。
// UGC 文本按面归类——昵称/签名走资料，评价文本走评论；命中风险时 result.suggest==='risky'。
export const SCENE_PROFILE = 1
export const SCENE_COMMENT = 2

/** 校验云存储里一张图片（fileId）的内容安全。绝不抛错——失败一律收成 { ok:false }（fail-closed）。 */
export async function imgSecCheck(fileId: string): Promise<SecResult> {
  if (!fileId) return err('NO_FILE')
  try {
    // 云函数 downloadFile 官方形状是 { fileID } → { fileContent, statusCode }，不是 getTempFileURL 的 fileList
    const dl = await cloud.downloadFile({ fileID: fileId })
    const buf = dl && dl.fileContent
    if (!buf) return err('SEC_CHECK_FAIL') // 取不到图内容 → fail-closed 拒
    const r = await (cloud as any).openapi.security.imgSecCheck({
      media: { contentType: 'image/png', value: buf },
    })
    const code = r && (r.errCode ?? r.errcode)
    if (code === RISKY) return err('IMG_RISKY')
    if (code != null && code !== 0) return err('SEC_CHECK_FAIL') // 非 0 非违规码 → 保守拒
    return { ok: true }
  } catch (e: any) {
    const code = e && (e.errCode ?? e.errcode)
    // 87014=内容违规；其余异常（能力未开通/网络）一律 fail-closed 拒（UGC 越权写面·根因#3）
    return err(code === RISKY ? 'IMG_RISKY' : 'SEC_CHECK_FAIL')
  }
}

/** 接口抖动时：closed＝拒（评价/头像）；open＝放行并记日志（客服/反馈·防卡死顾客通道）。 */
type MsgSecInfra = 'closed' | 'open'

function isRisky(code: unknown, suggest: unknown): boolean {
  return code === RISKY || suggest === 'risky'
}

function onInfraFail(infra: MsgSecInfra, scene: number): SecResult {
  if (infra === 'open') {
    alert('security', 'msgSecCheck', 'SEC_CHECK_INFRA', { scene })
    return { ok: true }
  }
  return err('SEC_CHECK_FAIL')
}

/**
 * 校验一段用户文本的内容安全。走 cloud.openapi.security.msgSecCheck v2
 * （openid + content + version:2 + scene）。空串/纯空白直接通过（不外呼）。绝不抛错。
 *
 * **违规**（errCode 87014 或 result.suggest==='risky'）一律拒，回 TEXT_RISKY——两条路径相同。
 * **接口抖动/能力未开**（其它非 0 码 / 抛错）：
 *   - `infra:'closed'`（默认·评价/昵称/签名）：拒，回 SEC_CHECK_FAIL。UGC 公开展示面，「证明安全」才放行。
 *     与违规分开回码：抖动时让用户「改文字」，正常文字怎么改都过不了。
 *   - `infra:'open'`（客服打字 / 意见反馈）：放行并 `alert(SEC_CHECK_INFRA)`。
 *     安检抖动不得卡死顾客消息（拍板）。
 * 守卫 ugc-imgsecchecked 焊评价/资料写面；客服/反馈由测试锁 fail-open。
 */
export async function msgSecCheck(
  content: string,
  openid: string,
  scene: number = SCENE_COMMENT,
  infra: MsgSecInfra = 'closed'
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
    if (isRisky(code, suggest)) return err(ERR.TEXT_RISKY)
    if (code != null && code !== 0) return onInfraFail(infra, scene)
    return { ok: true } // errCode:0 且非 risky（含 pass/review/无 suggest）→ 放行
  } catch (e: any) {
    const code = e && (e.errCode ?? e.errcode)
    if (code === RISKY) return err(ERR.TEXT_RISKY) // 抛错壳里的违规码仍拒
    return onInfraFail(infra, scene)
  }
}
