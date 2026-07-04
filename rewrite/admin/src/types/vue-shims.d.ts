// .vue 模块声明（tsc 只查 .ts·SFC 类型由 vite 编译期负责——vue-tsc 全量校验留 M3 收口评估）
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
