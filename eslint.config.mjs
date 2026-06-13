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

export default [
  // 不检查的目录/文件
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'unpackage/**',
      'packages/miniapp/src/uni.scss',
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

  // 放最后：关闭与 Prettier 冲突的排版规则
  configPrettier,
]
