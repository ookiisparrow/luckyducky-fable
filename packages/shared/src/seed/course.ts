/**
 * 课程种子单一来源 · 三层结构（规格 v2 §三：chapter / lesson / segment）。
 * 根因账本 #5：原 miniapp data/course.js + cloud seedCourses 各一份（连 buildSegments 派生逻辑
 * 与 mmss/parseDur 都三处复制）。此处为唯一 canonical，两侧 import 派生。
 *
 * - 目录只显 chapter + lesson 两层；segment 只在播放页（顶部分段进度条）。
 * - 每个 segment 将来是独立视频文件（videoFileId）；素材未剪前为 null，播放页按时长等分回退。
 * - 用户学习进度（done/watched）是用户态，不在课程内容里（样例 SAMPLE_PROGRESS 留 miniapp data/course）。
 */
export interface SeedSegment {
  id: string
  name: string
  dur: string
  videoFileId: string | null
  free: boolean
}
export interface SeedLesson {
  id: string
  name: string
  dur: string
  segments: SeedSegment[]
}
export interface SeedChapter {
  id: string
  title: string
  lessons: SeedLesson[]
}
export interface SeedCourse {
  id: string
  title: string
  sort: number
  chapters: SeedChapter[]
}

// 时长 mm:ss ↔ 秒（种子模块自带，与 miniapp utils/format 的同名显示工具分属不同层，各自自洽）
const parseDur = (s: string): number => {
  const [m, sec] = String(s).split(':').map(Number)
  return m * 60 + sec
}
const mmss = (t: number): string => {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 样例分段步骤（真实素材剪好后按课各自命名）
const SEG_STEPS = ['先看成品长啥样', '这个玩偶是什么', '需要的材料工具', '关键针法慢动作', '收尾与自检']

// 把一节课时长按样例步骤等分成 segments（余数并入最后一段）
function buildSegments(lessonId: string, dur: string, free?: boolean): SeedSegment[] {
  const total = parseDur(dur)
  const n = SEG_STEPS.length
  const base = Math.floor(total / n)
  return SEG_STEPS.map((name, i) => ({
    id: `${lessonId}-s${i + 1}`,
    name,
    dur: mmss(i === n - 1 ? total - base * (n - 1) : base),
    videoFileId: null,
    free: !!free,
  }))
}

interface RawLesson {
  id: string
  name: string
  dur: string
  free?: boolean
}
const CHAPTERS: { id: string; title: string; lessons: RawLesson[] }[] = [
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

// 多课数组（当前一门；id 与云端 _id 一致，products.courseId 关联到这里）
export const SEED_COURSES: SeedCourse[] = [
  {
    id: 'course-duck',
    title: '零基础 · 钩织你的第一只小棉鸭',
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
