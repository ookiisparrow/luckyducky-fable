// 全局声明（页面 .ts 无 import/export 属脚本作用域·共享类型收这里，别在页面里重复声明）
declare interface LdTabBar {
  setActive(id: string): void
  /** 转场 / 开屏铺到底部时让位（px-fx、brand-splash 调）；fade＝回来时淡入 */
  setCovered?(v: boolean, fade?: boolean): void
}
