// .vue 模块声明（tsc 只查 .ts·SFC 类型由 vite 编译期负责）
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
