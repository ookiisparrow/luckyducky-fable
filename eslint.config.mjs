/**
 * ESLint 配置（新版 flat config，ESLint 9）。
 * 作用：自动揪出潜在错误（未用变量、拼写错的变量、误用等），统一代码质量。
 * 与 Prettier 分工：ESLint 管「对不对」，Prettier 管「排版好不好看」——
 * 末尾的 configPrettier 会关掉与 Prettier 冲突的排版类规则，互不打架。
 *
 * 命令：npm run lint （自动修复可修的）
 */
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import configPrettier from 'eslint-config-prettier'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'

export default [
  // 不检查的目录/文件
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'unpackage/**',
      'packages/miniapp/src/uni.scss',
      'console-assets/**',
      // Skyline 真机 spike：微信原生全局（wx/Page/App）、用完即弃，不入 lint 域
      'rewrite/spike-skyline/**',
      // git worktree 隔离副本（.claude/worktrees/*）＝仓库另一份拷贝，非本仓 lint 源——
      // eslint . 递归进去会用错解析器把 .vue 里的 TS 当纯 JS 报解析错，且重复扫一遍全仓。
      '.claude/**',
    ],
  },

  // JS 推荐规则
  js.configs.recommended,

  // Vue3 推荐规则（含 .vue 解析器、<script setup> 宏识别）
  ...pluginVue.configs['flat/recommended'],

  // 项目级设置
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // uni-app / 小程序全局对象（声明为只读，避免被报「未定义」）
        uni: 'readonly',
        wx: 'readonly',
        plus: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
        // uni-app 页面生命周期（部分通过全局暴露）
        getCurrentInstance: 'readonly',
      },
    },
    rules: {
      // 组件名允许单个单词（Hero.vue / Icon.vue / index.vue）
      'vue/multi-word-component-names': 'off',
      // 占位 / 预留代码里允许「定义但暂未使用」的参数（以 _ 开头则完全忽略）
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // 配置文件本身用 Node 环境
  {
    files: ['**/*.config.js', '**/vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // 日志统一走 utils/logger.js（CLAUDE.md §13），logger 自身是唯一合法 console 出口；
  // cloudfunctions / admin / scripts 不在此列（云函数日志机制就是 console）
  {
    files: ['packages/miniapp/src/**/*.js', 'packages/miniapp/src/**/*.vue'],
    ignores: ['packages/miniapp/src/utils/logger.js'],
    rules: { 'no-console': 'error' },
  },

  // 管理端操作反馈统一走 utils/ui.js（toast/confirmDialog）——禁原生 alert/confirm/prompt
  // （阻塞线程 + 破坏紫色设计体系的灰色原生框·UX 一致性守卫·防回归）
  {
    files: ['packages/admin/src/**/*.js', 'packages/admin/src/**/*.vue'],
    rules: { 'no-alert': 'error' },
  },

  // 重写线后台（M3·Vue3+TS）：.vue 的 <script lang="ts"> 用 TS 解析器（espree 解不了 TS 语法）；
  // 同承旧 admin 的 no-alert 纪律。纯 .ts 文件仍归 tsc strict 管（与全仓 TS 文件同口径·不入 lint）。
  {
    files: ['rewrite/admin/src/**/*.vue', 'rewrite/agent/src/**/*.vue'],
    languageOptions: { parserOptions: { parser: tsParser } },
    rules: { 'no-alert': 'error' },
  },

  // 放最后：关闭与 Prettier 冲突的排版规则
  configPrettier,
]
