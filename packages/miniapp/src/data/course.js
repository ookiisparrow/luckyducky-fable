/**
 * 课程数据 · 三层结构（规格 v2 §三：chapter 大章节 / lesson 中章节 / segment 小片段）。
 *
 * - 目录只显示 chapter + lesson 两层；segment 只在播放页出现（顶部分段进度条）。
 * - 每个 segment 将来是独立视频文件（videoFileId）；素材未按段剪辑前为 null，
 *   播放页回退「共用占位视频 + 按时长等分」。
 * - 课程内容与用户学习进度分离：本文件只放内容；done/watched 是用户态，
 *   样例进度见 SAMPLE_PROGRESS（将来由云端进度记忆按 segment 粒度替换）。
 * - 本文件是 H5 / App 端回退源；小程序端云端真源在 cloudfunctions/seedCourses，
 *   两边字段同形，改这里要同步种子。
 */
import { mmss, parseDur } from '@/utils/format.js'

// 样例分段步骤（与原播放页知识点一致；真实素材剪好后按课各自命名）
const SEG_STEPS = ['先看成品长啥样', '这个玩偶是什么', '需要的材料工具', '关键针法慢动作', '收尾与自检']

// 把一节课时长按样例步骤等分成 segments（余数并入最后一段）
function buildSegments(lessonId, dur, free) {
  const total = parseDur(dur)
  const n = SEG_STEPS.length
  const base = Math.floor(total / n)
  return SEG_STEPS.map((name, i) => ({
    id: `${lessonId}-s${i + 1}`,
    name,
    dur: mmss(i === n - 1 ? total - base * (n - 1) : base),
    videoFileId: null, // 素材按段剪好后填云存储 fileID
    free: !!free,
  }))
}

// 课时源表（内容身份：id / name / dur；free = 试看，落到 segment 级）
const CHAPTERS = [
  {
    id: 'c1',
    title: '开始之前 · 备好工具和心情',
    lessons: [
      { id: 'l1', name: '认识你的钩织工具包', dur: '03:20' },
      { id: 'l2', name: '毛线与钩针怎么挑选', dur: '04:05' },
      { id: 'l3', name: '看懂图解里的符号', dur: '05:12' },
      { id: 'l4', name: '起手 · 钩一个魔术环', dur: '06:40', free: true },
    ],
  },
  {
    id: 'c2',
    title: '基础针法 · 一看就会',
    lessons: [
      { id: 'l5', name: '锁针：所有花样的地基', dur: '04:48' },
      { id: 'l6', name: '短针：钩出圆滚滚的身体', dur: '07:10' },
      { id: 'l7', name: '加针与减针的小秘密', dur: '06:25' },
      { id: 'l8', name: '收尾藏线，看不出针脚', dur: '05:30' },
    ],
  },
  {
    id: 'c3',
    title: '钩出小鸭的身体',
    lessons: [
      { id: 'l9', name: '从鸭头开始，一圈一圈', dur: '08:15' },
      { id: 'l10', name: '鸭身与鸭尾的过渡', dur: '07:40' },
      { id: 'l11', name: '钩一对小翅膀', dur: '05:55' },
      { id: 'l12', name: '塞棉花的力道与手感', dur: '04:20' },
    ],
  },
  {
    id: 'c4',
    title: '组装 · 给小鸭一个表情',
    lessons: [
      { id: 'l13', name: '缝上鸭喙与小脚', dur: '06:05' },
      { id: 'l14', name: '定位眼睛，神态全靠它', dur: '05:18' },
      { id: 'l15', name: '系上幸运小围巾', dur: '04:02' },
      { id: 'l16', name: '完成 · 拍张照晒晒你的鸭', dur: '03:36' },
    ],
  },
]

// 多课数组（当前一门；id 与云端 _id 一致，products.courseId 将来关联到这里）
export const COURSES = [
  {
    id: 'course-duck',
    title: '零基础 · 钩织你的第一只幸运小鸭',
    sort: 0,
    chapters: CHAPTERS.map((c) => ({
      id: c.id,
      title: c.title,
      lessons: c.lessons.map((l) => ({
        id: l.id,
        name: l.name,
        dur: l.dur,
        segments: buildSegments(l.id, l.dur, l.free),
      })),
    })),
  },
]

// 单课快捷导出（契约测试用；页面已改经 store/courses.js 取数，不直接 import 这里）
export const COURSE = COURSES[0]

// 拍平成一维课时表，并补 chapter 归属（契约测试用；页面用 store 的 allLessons）
export const ALL_LESSONS = COURSE.chapters.flatMap((c) =>
  c.lessons.map((l) => ({ ...l, chapter: c.id }))
)

// 用户学习进度 · 样例（用户态，不属于课程内容，云端不存这份）
// done = 已学完；watched = 0~1 观看进度
export const SAMPLE_PROGRESS = {
  l1: { done: true },
  l2: { done: true },
  l3: { watched: 0.42 },
}
