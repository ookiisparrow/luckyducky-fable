# 证书运维（ops/certs）

腾讯云免费 SSL 续签 + CloudBase HTTP 访问换绑 + 周检。脚本只在**已登录 runner** 上执行（今天是 Omarchy），本目录不含密钥。

## 前置

- runner 上已装并登录 `tccli`、`tcb`（密钥留本机，不入库）。
- `luckyducky.cn` 的 DNS 在同一腾讯云 DNSPod 账号，续签才能走 `DNS_AUTO`；否则会卡在验证、被周检发现。
- `cert-rebind.py` 探活还要本机有 `openssl`。

日志/快照默认写到当前目录 `./logs`，或环境变量 `CERT_OPS_LOG_DIR`。Omarchy 现网仍用 `~/Work/logs`：

```bash
export CERT_OPS_LOG_DIR="$HOME/Work/logs"
```

## 生产域名与换绑参数

| 域名 | path | 上游 | 脚本 |
|---|---|---|---|
| `www.luckyducky.cn` | `/` | STATIC_STORE `staticstore` | renew → rebind |
| `kf.luckyducky.cn` | `/kfcallback` | SCF `kfCallback` | renew → rebind |
| `q.luckyducky.cn` | `/` | STATIC_STORE `staticstore` | renew → rebind |
| `vod.luckyducky.cn` | CDN | （点播控制台） | **只 renew/周检，不要跑 cert-rebind.py** |

默认环境：`cloudbase-d4gcssqbv06865479`。

## 流程

1. `cert-renew.py` 申请免费证（DNS_AUTO）并等到签发，记下新 `CertificateId`。
2. `cert-rebind.py` 换绑上线：删路由 → 解绑域名 → 绑新证 → 重建路由 → 探活。该域名 HTTPS 会闪断约 30–60 秒。
3. 每周式检查用 `cert-dns-watch.py`：证书剩余天数（不足 30 天告警）、DNSPod 快照对比、CloudBase 套餐到期常量、域名是否还在账号里、密钥标签满 90 天提醒。

谁喊 / 谁跑：Grok Bot / 巡检官到期前提醒；**runner 执行这三个脚本**。不是 Omarchy Agent OS 管家的活。

套餐到期日是脚本顶部常量（`CLOUDBASE_PACKAGE_EXPIRY`），不是接口读数。续完套餐后改常量，否则周检一直按旧日喊。密钥日期（`KEY_DATES`）同理，只是标签。

## 示例

```bash
# 续签（可多个域名）
python3 ops/certs/cert-renew.py www.luckyducky.cn kf.luckyducky.cn q.luckyducky.cn

# 换绑（把 <新证ID> 换成 renew 打出来的 CertificateId）
python3 ops/certs/cert-rebind.py www.luckyducky.cn <新证ID> / STATIC_STORE staticstore
python3 ops/certs/cert-rebind.py kf.luckyducky.cn <新证ID> /kfcallback SCF kfCallback
python3 ops/certs/cert-rebind.py q.luckyducky.cn <新证ID> / STATIC_STORE staticstore

# 周检（Omarchy）
CERT_OPS_LOG_DIR="$HOME/Work/logs" python3 ops/certs/cert-dns-watch.py
```

`vod.luckyducky.cn` 只跑 renew（或周检），换绑走 CDN/点播控制台，别用 `cert-rebind.py`。

台账：`docs/人工配置清单.md`「SSL 证书台账」· 下一轮到期见 Issue #139。
