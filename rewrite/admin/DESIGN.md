# rewrite/admin · UI 用法合同（给写代码的代理）

> **只覆盖管理控制台。** 小程序 / 内容站密度不同，勿把本文件放到仓根或其它包。
> 色值与字体真源＝`src/styles/tokens.css`。本文只写角色和用法，不抄 hex。
> 冲突时以 `tokens.css` 为准，回来改本文。

## 声口

控制台：紧、素、紫只做强调。禁止营销摄影、毛玻璃、第二品牌色。

## 色（角色 → token；禁抄 hex）

| 角色 | token |
|---|---|
| 强调 / 主操作 | `--ld-brand`；按下 `--ld-brand-active` |
| 标题 | `--ld-ink` |
| 正文 | `--ld-content` |
| 次要 | `--ld-content-2` |
| 底 | `--ld-bg` |
| 浅紫底 | `--ld-bg-lilac` |
| 灰底 | `--ld-bg-grey` |
| 线 | `--ld-line` |
| 紫描边 | `--ld-purple-line` |
| 成功 / 危险 / 预警 | `--ld-green` / `--ld-red` / `--ld-amber`；浅底 `--ld-bg-green-soft` / `--ld-bg-red-soft` / `--ld-bg-amber-soft` |

禁止：裸 hex（守卫 `rw-admin-theme-single-source`）、第二强调色、渐变底、玻璃拟态。换皮只改 `tokens.css`。

## 字

- 字体 `--ld-font`（Noto Sans SC）；等宽 `--ld-font-mono`
- 默认约 14；页标题约 18 / 600
- 禁营销大英雄字；字重只用 400 / 600

## 间距

台阶：4 / 8 / 12 / 16 / 24。卡内 16；区块 24。表格与工具条用紧密度、按钮 `sm`；独立主操作才用默认尺寸。

## 圆角

- 卡 `--ld-radius`（12）
- 按钮 / chip `--ld-radius-sm`（8）
- 禁 pill CTA

## 组件（规则，不另起原语）

- **Button**：一屏一个 primary；行内 ghost / `sm`；破坏性用红，且不与主操作双胞胎并排。页面用现有 `UiButton`，禁手搓填充主按钮。
- **Table**：表头次要色；行高紧；操作列右对齐。
- **Form**：标签在上；危险确认单独一步。
- **Empty**：短文案 + 一个主操作，禁插画堆砌。

## 要 / 不要

要：色走 `var(--ld-*)`；新色先问、不私加 token；主操作少、信息密、文案短；危险操作两步确认。

不要：第二品牌色 / 渐变底 / 毛玻璃；营销摄影、空态插画墙；一屏多个 primary；破坏性按钮和主 CTA 并排；pill 主按钮、英雄级大字；把本文件当调色板（hex 只住 `tokens.css`）。

## 冲突

`DESIGN.md` 与 `tokens.css` 打架 → 以 `tokens.css` 为准，改本文。本文件不覆盖 mp / site。
