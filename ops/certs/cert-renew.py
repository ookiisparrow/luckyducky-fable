#!/usr/bin/env python3
"""证书自动续签：申请(DNS_AUTO) → 确认签发 → 报告
用法: cert-renew.py <domain> [domain2 ...]
DNS 托管在腾讯云 DNSPod 同账号时全自动；否则会卡在验证环节并被巡检发现。
"""
import json, subprocess, sys, time

def run(*args):
    r = subprocess.run(args, capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout)
    except Exception:
        raise RuntimeError((r.stdout + r.stderr)[:400])

def renew(domain):
    print(f"[{domain}] 申请中(DNS_AUTO)...")
    d = run("tccli", "ssl", "ApplyCertificate",
            "--DomainName", domain, "--DvAuthMethod", "DNS_AUTO",
            "--PackageType", "83")
    cid = d["CertificateId"]
    print(f"[{domain}] id={cid} 轮询签发状态...")
    for i in range(40):  # 最多10分钟
        time.sleep(15)
        det = run("tccli", "ssl", "DescribeCertificate", "--CertificateId", cid)
        status = det.get("Status")
        if status == 1:
            print(f"✅ [{domain}] 已签发 {cid} "
                  f"{str(det.get('CertEndTime'))[:10]} 到期")
            return True
        if status in (5, 8, -1):  # 失败类
            print(f"❌ [{domain}] 签发失败: {det.get('StatusMsg')}")
            return False
    print(f"⏳ [{domain}] 超时未签发，稍后巡检会再查")
    return False

ok = all(renew(d) for d in sys.argv[1:])
sys.exit(0 if ok else 1)
