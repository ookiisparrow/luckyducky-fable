// 全局声明（页面 .ts 无 import/export 属脚本作用域·共享类型收这里，别在页面里重复声明）
declare interface LdTabBar {
  setActive(id: string): void
}
