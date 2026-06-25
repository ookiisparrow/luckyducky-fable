import { withOpenId, ok, getTempUrl } from '../../kit'

// 取求助面板「辅助视频」列表（全局共用·所有课程同一份；控制台「帮助视频」编辑，存 content 集合 doc 'helpVideos'）。
// 小程序播放页求助面板「遇到问题了」即此列表。审计 P1：videoFileId 不出接口——按 fileID 服务端换短时效
// 临时 URL 下发（同 getPlaybackUrl 单源思路，守卫 help-video-url-via-cloud-only）。求助面板只在播放页内
// 可达（用户均已登录）故走 withOpenId；通用免费内容、无权属闸。无记录 / 某条无视频 → 空列表 / url:null
// （前端回退占位/空态）。
export const main = withOpenId(async ({ db }) => {
  const got = await db
    .collection('content')
    .doc('helpVideos')
    .get()
    .catch(() => null)
  const items = (got?.data?.items || []) as any[]
  const out = await Promise.all(
    items.map(async (it) => ({
      id: String(it.id || ''),
      title: String(it.title || ''),
      sub: String(it.sub || ''),
      desc: String(it.desc || ''),
      dur: String(it.dur || ''),
      // fileID 留服务端：换短时效临时 URL 下发（无视频 → null，前端显占位）
      url: it.videoFileId ? await getTempUrl(String(it.videoFileId)) : null,
    }))
  )
  return ok({ items: out })
})
