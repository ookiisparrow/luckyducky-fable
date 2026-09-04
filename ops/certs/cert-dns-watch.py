#!/usr/bin/env python3
"""证书/DNS 周检：证剩几天、DNSPod 快照对比、CloudBase 套餐到期、域名在册、密钥年龄。
用法: cert-dns-watch.py
日志/快照默认 ./logs（cwd）或环境变量 CERT_OPS_LOG_DIR。
Omarchy 现网部署仍用 ~/Work/logs（CERT_OPS_LOG_DIR=$HOME/Work/logs）。
有告警 exit 1。
"""
import json, os, subprocess, sys
from datetime import date, datetime

# 套餐到期是人工台账，不是 API 真值。续完必须改这里，否则周检会一直按旧日喊。
CLOUDBASE_PACKAGE_EXPIRY = {
    "cloudbase-d4gcssqbv06865479(生产)": "2026-09-11",
    "yaliceshi-d3get0o7ja6c91f8f(测试)": "2026-09-08",
}

# 日期是轮换标签，不是密钥本身。满 90 天提醒，改日期即可消警。
KEY_DATES = {"tencent-sub": "2026-08-23", "aliyun-dns": "2026-08-23"}

WARN_DAYS = 30
KEY_AGE_DAYS = 90
ZONES = ("luckyducky.cn", "luckyducky.cloud")

LOG_DIR = os.environ.get("CERT_OPS_LOG_DIR") or os.path.join(os.getcwd(), "logs")


def run(*args):
    r = subprocess.run(args, capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout)
    except Exception:
        raise RuntimeError((r.stdout + r.stderr)[:400])


def days_until(iso):
    return (date.fromisoformat(iso[:10]) - date.today()).days


def append_report(lines):
    os.makedirs(LOG_DIR, exist_ok=True)
    path = os.path.join(LOG_DIR, "cert-dns-watch.log")
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"\n===== {stamp} =====\n")
        f.write("\n".join(lines) + "\n")
    return path


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None


def save_json(path, data):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def check_certs(alerts, report):
    report.append("## 证书")
    listed = run("tccli", "ssl", "DescribeCertificates", "--Limit", "100")
    certs = listed.get("Certificates") or listed.get("CertificateSet") or []
    if not certs:
        alerts.append("DescribeCertificates 空列表")
        report.append("❌ 证书列表为空")
        return
    for c in certs:
        cid = c.get("CertificateId") or ""
        try:
            det = run("tccli", "ssl", "DescribeCertificate", "--CertificateId", cid)
        except Exception as e:
            alerts.append(f"DescribeCertificate {cid} 失败: {e}")
            report.append(f"❌ {cid} 读详情失败")
            continue
        domain = det.get("Domain") or c.get("Domain") or "?"
        end = str(det.get("CertEndTime") or c.get("CertEndTime") or "")[:10]
        status = det.get("Status", c.get("Status"))
        if not end:
            alerts.append(f"{domain} {cid} 无到期日")
            report.append(f"❌ {domain} {cid} 无到期日")
            continue
        left = days_until(end)
        line = f"{domain} {cid} 剩 {left} 天（{end}）status={status}"
        if left < WARN_DAYS:
            alerts.append(line)
            report.append(f"🔴 {line}")
        else:
            report.append(f"✅ {line}")


def snap_records(zone):
    recs, offset = [], 0
    while True:
        d = run("tccli", "dnspod", "DescribeRecordList",
                "--Domain", zone, "--Offset", str(offset), "--Limit", "100")
        batch = d.get("RecordList") or []
        for r in batch:
            recs.append({
                "name": r.get("Name"),
                "type": r.get("Type"),
                "value": r.get("Value"),
                "ttl": r.get("TTL"),
                "status": r.get("Status"),
            })
        offset += len(batch)
        total = (d.get("RecordCountInfo") or {}).get("TotalCount") or len(batch)
        if not batch or offset >= total:
            break
    recs.sort(key=lambda x: (x["name"] or "", x["type"] or "", x["value"] or ""))
    return recs


def rec_sig(r):
    return (r.get("name"), r.get("type"), r.get("value"), r.get("ttl"), r.get("status"))


def check_dnspod(alerts, report):
    report.append("## DNSPod 快照")
    snap_path = os.path.join(LOG_DIR, "dnspod-snapshot.json")
    prev = load_json(snap_path) or {}
    curr = {}
    for zone in ZONES:
        try:
            curr[zone] = snap_records(zone)
        except Exception as e:
            alerts.append(f"DNSPod {zone} 拉取失败: {e}")
            report.append(f"❌ {zone} 拉取失败: {e}")
            continue
        report.append(f"{zone}: {len(curr[zone])} 条")
        if zone not in prev:
            report.append(f"  （首次快照，无对比）")
            continue
        old = {rec_sig(r) for r in prev[zone]}
        new = {rec_sig(r) for r in curr[zone]}
        added = new - old
        removed = old - new
        if added or removed:
            msg = f"{zone} DNS 有变 +{len(added)} -{len(removed)}"
            alerts.append(msg)
            report.append(f"🔴 {msg}")
            for item in sorted(added)[:8]:
                report.append(f"  + {item}")
            for item in sorted(removed)[:8]:
                report.append(f"  - {item}")
        else:
            report.append(f"✅ {zone} 与上次快照一致")
    if curr:
        merged = dict(prev)
        merged.update(curr)
        save_json(snap_path, merged)


def check_cloudbase(alerts, report):
    report.append("## CloudBase 套餐到期（人工常量，续完请改脚本顶部）")
    state_path = os.path.join(LOG_DIR, "cloudbase-expiry-state.json")
    prev = load_json(state_path) or {}
    for label, iso in CLOUDBASE_PACKAGE_EXPIRY.items():
        left = days_until(iso)
        line = f"{label} 剩 {left} 天（台账 {iso}）"
        if prev.get(label) and prev[label] != iso:
            report.append(f"ℹ️ {label} 台账从 {prev[label]} 改为 {iso}（视为已续）")
        if left < WARN_DAYS:
            alerts.append(line)
            report.append(f"🔴 {line}")
        else:
            report.append(f"✅ {line}")
    save_json(state_path, CLOUDBASE_PACKAGE_EXPIRY)


def check_domains(alerts, report):
    report.append("## 域名在册")
    try:
        d = run("tccli", "dnspod", "DescribeDomainList")
    except Exception as e:
        alerts.append(f"DescribeDomainList 失败: {e}")
        report.append(f"❌ 域名列表失败: {e}")
        return
    names = set()
    for item in d.get("DomainList") or d.get("DomainSet") or []:
        names.add((item.get("Name") or item.get("Domain") or "").rstrip("."))
    for zone in ZONES:
        if zone in names:
            report.append(f"✅ {zone} 在 DNSPod 账号内")
        else:
            alerts.append(f"{zone} 不在 DNSPod 域名列表")
            report.append(f"🔴 {zone} 不在 DNSPod 域名列表")


def check_keys(alerts, report):
    report.append("## 密钥年龄（标签日期，不是密钥值）")
    for label, iso in KEY_DATES.items():
        age = (date.today() - date.fromisoformat(iso[:10])).days
        line = f"{label} 距标签日 {iso} 已 {age} 天"
        if age >= KEY_AGE_DAYS:
            alerts.append(line)
            report.append(f"🔴 {line}（满 {KEY_AGE_DAYS} 天提醒轮换）")
        else:
            report.append(f"✅ {line}")


def main():
    alerts, report = [], []
    report.append(f"LOG_DIR={LOG_DIR}")
    try:
        check_certs(alerts, report)
        check_dnspod(alerts, report)
        check_cloudbase(alerts, report)
        check_domains(alerts, report)
        check_keys(alerts, report)
    except Exception as e:
        alerts.append(f"巡检中断: {e}")
        report.append(f"❌ 巡检中断: {e}")
    report.append("## 汇总")
    if alerts:
        report.append(f"❌ {len(alerts)} 条告警")
        for a in alerts:
            report.append(f"  - {a}")
    else:
        report.append("✅ 无告警")
    path = append_report(report)
    print("\n".join(report))
    print(f"\n已追加 {path}")
    sys.exit(1 if alerts else 0)


if __name__ == "__main__":
    main()
