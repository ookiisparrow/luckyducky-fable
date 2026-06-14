/**
 * 默认头像库：一键登录的新用户随机分配一个（4 选 1，规格 §四-1）。
 * 素材在 static/avatars/（SVG，和品牌一致），将来想换成真设计直接替换这 4 个文件即可。
 */
export const DEFAULT_AVATARS = [
  '/static/avatars/duck-1.svg',
  '/static/avatars/duck-2.svg',
  '/static/avatars/duck-3.svg',
  '/static/avatars/duck-4.svg',
]

// 随机取一个默认头像（新用户登录时分配；已有头像不调用）
export function randomAvatar() {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)]
}
