// 头像上传 + 保存失败说人话（编辑资料页与「我」页换头像共用）。
// chooseAvatar 给的是临时路径：先传云存储换 cloud:// 再交 updateProfile（云端只收 cloud:// 或空·入库前过图片内容安全）。
import { fxHint } from './pxFx'

/** 临时路径传云存储，返回永久 fileID；失败抛错（调用方决定是否照常存其它字段）。 */
export async function uploadAvatar(filePath: string): Promise<string> {
  const up = await wx.cloud.uploadFile({
    cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
    filePath,
  })
  return up.fileID
}

/** updateProfile 失败按码提示（云端 actions/user.ts updateProfile）：IMG_RISKY＝头像违规；
 *  SEC_CHECK_FAIL＝文字（昵称/签名）没过，或带了头像时头像没校成（云端同码）——按这次送了什么提。
 *  文案直接写在 fxHint(...) 里：提示是系统字，字体子集扫描据此不收（scripts/lib/brand-font-charset.mjs）。 */
export function hintProfileFail(page: Parameters<typeof fxHint>[0], error: unknown, sent: { text: boolean; avatar: boolean }): void {
  const err = String(error)
  fxHint(
    page,
    err === 'IMG_RISKY'
      ? '这张头像不能用，换一张'
      : err !== 'SEC_CHECK_FAIL'
        ? '保存没成功，稍后再试'
        : sent.text && sent.avatar
          ? '昵称或头像没通过审核，换一个再试'
          : sent.avatar
            ? '头像没通过审核，换一张再试'
            : '昵称没通过审核，换一个'
  )
}
