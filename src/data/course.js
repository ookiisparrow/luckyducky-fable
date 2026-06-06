/**
 * 视频教程 · 课程数据。来源：原设计 VideoCatalog 的 COURSE（4 章 × 4 节）。
 * 海报图本阶段用灰色占位（MediaSlot），不在此处放图。
 * 字段：done 已学完 / watched 0~1 观看进度 / free 试看。
 * 以后接后端：改为 api 拉取，保持结构一致即可。
 */
export const COURSE = {
  title: '零基础 · 钩织你的第一只幸运小鸭',
  chapters: [
    {
      id: 'c1',
      title: '开始之前 · 备好工具和心情',
      lessons: [
        { id: 'l1', name: '认识你的钩织工具包', dur: '03:20', done: true },
        { id: 'l2', name: '毛线与钩针怎么挑选', dur: '04:05', done: true },
        { id: 'l3', name: '看懂图解里的符号', dur: '05:12', watched: 0.42 },
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
  ],
}

// 拍平成一维课时表，并补 chapter 归属（供目录/播放页定位用）
export const ALL_LESSONS = COURSE.chapters.flatMap((c) =>
  c.lessons.map((l) => ({ ...l, chapter: c.id }))
)
