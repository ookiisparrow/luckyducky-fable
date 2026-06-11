// 一次性灌入课程种子数据（三层：chapter / lesson / segment，规格 v2 §三）。
// 部署后调用一次即可；再次调用也安全（幂等）。
// 幂等原理：用业务 id（course-duck）作为文档 _id，doc(id).set 是 upsert——
// 记录存在则整体覆盖、不存在则创建，所以重复 seed 不会产生重复数据。
//
// ⚠️ 这份种子要与前端 src/data/course.js 保持一致：
//    course.js 是 H5 / App 端的本地回退源，这里是小程序端的云端真源，两边字段同形。
//    segment 字段：id / name / dur / videoFileId（素材剪好前为 null）/ free（试看）。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// —— 以下数据与构建逻辑同 src/data/course.js（CommonJS 版） ——

const parseDur = (s) => {
  const [m, sec] = String(s).split(':').map(Number)
  return m * 60 + sec
}
const mmss = (t) => {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 样例分段步骤（真实素材剪好后按课各自命名）
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

const COURSES = [
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

exports.main = async () => {
  // 管理闸（与 genQrcodes 同模式）：CLI / 控制台 invoke 无 openid 放行；
  // 小程序端任意登录用户调用须 users.isAdmin，否则拒——防客户端覆盖生产课程数据。
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    const u = await db.collection('users').where({ _openid: OPENID }).get()
    if (!u.data.length || u.data[0].isAdmin !== true) return { ok: false, error: 'ADMIN_ONLY' }
  }

  const ids = []
  for (const c of COURSES) {
    await db
      .collection('courses')
      .doc(c.id)
      .set({ data: { ...c, updatedAt: db.serverDate() } })
    ids.push(c.id)
  }
  return { ok: true, count: ids.length, ids }
}
