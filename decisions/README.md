# Decision Records

> 只记「从代码/测试/Git 无法准确推导」的关键决定。过程手册、可恢复事实不进此目录。

| 编号 | 文件 | 一句话决定 |
|---|---|---|
| 001 | [001-activation-code-no-order-bind.md](001-activation-code-no-order-bind.md) | 备货封码、不绑订单；退货以验收扫码裁决 |
| 002 | [002-print-qr-plain-link.md](002-print-qr-plain-link.md) | 印刷用普通链接 `/q/<码>`，不用小程序码 |
| 003 | [003-rewrite-baseline.md](003-rewrite-baseline.md) | 原生 TS+glass-easel；成交留小程序；本仓=生产源 |
| 004 | [004-cs-wecom-360-dual-track.md](004-cs-wecom-360-dual-track.md) | 企微微信客服 + 自建 360 + 意图双轨；小店仅渠道 |
| 005 | [005-no-casting.md](005-no-casting.md) | 投屏全线取缔；先改决策再退役守卫 |
| 006 | [006-p2-threat-model.md](006-p2-threat-model.md) | P2 防 AI 误操作非防恶意；不追容器级隔离 |
| 007 | [007-coupon-merchant-vs-store.md](007-coupon-merchant-vs-store.md) | 主推商家券、否小店券；真券未落地；现 `COUPON=0` |
| 008 | [008-yagni-no-speculative-abstraction.md](008-yagni-no-speculative-abstraction.md) | 默认拒绝投机抽象（YAGNI） |
| 009 | [009-subtraction-principle.md](009-subtraction-principle.md) | 无消费者即退役；客观事实零副本 |
| 010 | [010-dual-track-lock.md](010-dual-track-lock.md) | 多代理非 red 双轨；常态锁至明说「切换」 |
| 011 | [011-console-assets-registry.md](011-console-assets-registry.md) | git 外控制台资产正册；先 repo 后控制台 |

格式约定：决定 / 背景 / 备选 / 为何不选 / 后果 / 来源。
