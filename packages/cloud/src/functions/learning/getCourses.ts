import { getDb, ok } from '../../kit'

// 取课程目录（三层，按 sort 升序）。只读、公开——逐层**显式白名单**（审计 #10：fail-closed）：段剥除
// videoFileId（付费课视频白嫖防护·只暴露 hasVideo 布尔 + free），课/章/节也只挑客户端要用的字段、不裸
// `...` 展开原始文档——否则哪天往课/课时文档加内部字段（成本价/解锁密钥/运营备注）会静默漏进公开返回，
// 且守卫 video-url-via-cloud-only 只盯 videoFileId 字面量、抓不到对象展开。真实播放地址经 getPlaybackUrl
// 服务端鉴权后发短时效临时 URL。**新增对外字段须显式加进白名单（守卫 getcourses-field-whitelist 挡裸展开）。**
function publicSegment(s: any) {
  return { id: s.id, name: s.name, dur: s.dur, free: !!s.free, hasVideo: !!s.videoFileId }
}
function publicLesson(l: any) {
  return { id: l.id, name: l.name, dur: l.dur, segments: (l.segments || []).map(publicSegment) }
}
function publicChapter(ch: any) {
  return { id: ch.id, title: ch.title, lessons: (ch.lessons || []).map(publicLesson) }
}
function publicCourse(c: any) {
  return { id: c.id, title: c.title, chapters: (c.chapters || []).map(publicChapter) }
}

export const main = async () => {
  const db = getDb()
  const res = await db.collection('courses').orderBy('sort', 'asc').get()
  return ok({ list: res.data.map(publicCourse) })
}
