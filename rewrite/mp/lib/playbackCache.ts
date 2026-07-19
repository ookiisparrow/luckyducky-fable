// 播放地址缓存单例（批3·取址缓存跨页迁出·根因#15）：原为 pages/player/player.ts 内私有实例，播放页专属，
// 目录页/我页在用户点开播放器前的停留窗口白白浪费（进播放器才现取地址一个云往返压在关键路径上·实测 0.7-1.4s）。
// 迁到 lib 供 catalog.onShow / me.refresh 落续播目标后 prefetch 预热，进播放器时 peek 命中零云往返——
// 单例须跨页共享同一实例，拆回页面私有即断跨页预热（守卫 rw-mp-player-prefetch-cache 焊死单例在场+被 import）。
// fetcher 的 NOT_ENTITLED/FETCH_FAIL 分流原样随迁（守卫 rw-mp-list-loadfailed-state 认这里为 fetcher 新家）。
// 响应形状哨兵见 rewrite/cloud/tests/contract-shape.test.ts·cloud 改键该测试会红·同步时两头一起改（批B10）。
import { getPlaybackUrl } from '../api/learning'
import { createPlaybackCache } from './player'

export const playbackCache = createPlaybackCache({
  fetcher: async (courseId, segmentId) => {
    const r = await getPlaybackUrl(courseId, segmentId)
    if (!r.ok && String(r.error || '') === 'NOT_ENTITLED') throw new Error('NOT_ENTITLED')
    // 取址失败分流（根因#14·守卫 rw-mp-list-loadfailed-state）：网络/服务失败抛 FETCH_FAIL 落 error 态
    // （有重试入口），不再折进空串——空串专属「素材未剪 url:null」的诚实空态，两者不可混同。
    if (!r.ok) throw new Error('FETCH_FAIL')
    return String(r.url || '')
  },
})
