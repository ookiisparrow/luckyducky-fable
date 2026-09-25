/**
 * ESLint 配置（新版 flat config，ESLint 9）。
 * 作用：自动揪出潜在错误（未用变量、拼写错的变量、误用等），统一代码质量。
 * Prettier CLI/配置已按 ADR §409 退役；不再依赖 eslint-config-prettier。
 * 排版类 vue recommended 规则在下面显式关掉——lint 管对错，不管排版。
 *
 * 命令：npm run lint（只报）；npm run lint:fix（自动修可修的）
 */
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'

export default [
  // 不检查的目录/文件
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // vitest --coverage 产物（B8·vendor 生成的 lcov-report/*.js 会触发误报 warning）
      'coverage/**',
      'console-assets/**',
      // git worktree 隔离副本（.claude/worktrees/*）＝仓库另一份拷贝，非本仓 lint 源——
      // eslint . 递归进去会用错解析器把 .vue 里的 TS 当纯 JS 报解析错，且重复扫一遍全仓。
      '.claude/**',
      // 变异测试运行时沙盒（npm run mutation·StrykerJS 把仓复制进去跑）＝同上「仓库另一份拷贝」
      '.stryker-tmp/**',
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
        // 原生小程序全局对象（声明为只读，避免被报「未定义」）
        wx: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
      },
    },
    rules: {
      // 组件名允许单个单词（Hero.vue / Icon.vue / index.vue）
      'vue/multi-word-component-names': 'off',
      // 占位 / 预留代码里允许「定义但暂未使用」的参数（以 _ 开头则完全忽略）
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 无 Prettier（ADR §409）。vue recommended 自带排版规则，不靠已卸的 eslint-config-prettier 闭嘴。
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-closing-bracket-newline': 'off',
    },
  },

  // 配置文件本身用 Node 环境
  {
    files: ['**/*.config.js', '**/vite.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  // 后台与坐席台的 .vue 里 <script lang="ts"> 用 TS 解析器（espree 解不了 TS 语法）；后台禁 alert。
  {
    files: ['rewrite/admin/src/**/*.vue', 'rewrite/agent/src/**/*.vue'],
    languageOptions: { parserOptions: { parser: tsParser } },
    rules: { 'no-alert': 'error' },
  },

  // .ts 进 lint：类型与未用变量归 tsc strict 管（这里关掉会与 TS 语义打架的 JS 版规则），
  // lint 负责 tsc 管不到的——函数复杂度与嵌套深度的硬上限，超了就拆。
  {
    files: ['rewrite/**/*.ts'],
    languageOptions: { parser: tsParser },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      complexity: ['error', 35],
      'max-depth': ['error', 5],
    },
  },
]
