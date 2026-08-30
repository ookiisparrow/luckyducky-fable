# downloadFile 合法域名正册（根因账本 #9 · Issue #104 ③）

> 小程序要从自己的服务器拉文件（品牌字体走 `wx.downloadFile`），域名必须先在微信公众平台白名单里——**这张名单住在微信后台，不在 git**。本文件是其正册。**变更纪律：先改本文件、再动微信后台**（同 README 总纪律）。本批**未打开微信公众平台**，完整名单标「待对照」，不编造域名。

## 真值源

**微信公众平台 → 开发管理 → 服务器域名 → downloadFile 合法域名**

- 后台：https://mp.weixin.qq.com （小程序 AppID `wxcbd2fb68b81bcfb1`）
- 只认这一页。仓内代码里的 URL、CloudBase 托管域名、Issue 口述都是线索，不是完整名单。

## 已知已配（本批能落纸的）

| 域名 | 来源 | 用途 |
|---|---|---|
| `https://cloudbase-d4gcssqbv06865479-1440904924.tcloudbaseapp.com` | CloudBase 静态托管默认域名（`docs/运维手册.md` 2026-07-24 部署实测；`rewrite/mp/utils/brandFont.ts` 的 `FONT_HOST`） | 小程序 `downloadFile` 拉 `/fonts/` 品牌字。Issue #104 写后台已配 `tcloudbaseapp.com` |

刻意不用自有 `www.luckyducky.cn` 拉字体（`brandFont.ts` 注释：默认托管域名走 DigiCert，自有域走 TrustAsia，手机微信对 CA 挑剔）。**本正册不把 `luckyducky.cn` 写成 downloadFile 已配域名**——后台完整名单未抄回，不编。

## 待对照

- [ ] **微信公众平台 downloadFile 完整名单未打开、未逐条抄回**（2026-08-30）。下次有人进后台，把该页全部域名原样贴进本表，去掉本条。
- [ ] 换托管域名 / 换字体 CDN 时：先改 `brandFont.ts` 的 `FONT_HOST` + 本正册，再进微信后台加域名（合法域名修改有额度，别先改后台忘改正册）。

## 怎么核

1. 打开真值源那一页，看 downloadFile 列表是否含上表那条 `tcloudbaseapp.com` 托管域名。
2. 列表里若还有别的域名，抄进本表「已知已配」，不要凭印象补 `luckyducky.cn` / VOD 播放域。
3. 真机冷启动能出品牌字＝这条域名在白名单里且托管 `/fonts/` 文件还在（根因#8：后台勾了 ≠ 真机能下）。

## drift-checklist（并入 README 总单）

- [ ] 微信公众平台 downloadFile 合法域名含 `https://cloudbase-d4gcssqbv06865479-1440904924.tcloudbaseapp.com`。
- [ ] 该页完整名单已抄回本表（本批仍为待对照）。
- [ ] `rewrite/mp/utils/brandFont.ts` 的 `FONT_HOST` 仍指向上表那条托管域名。
