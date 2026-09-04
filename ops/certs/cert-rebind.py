#!/usr/bin/env python3
"""证书换绑到 CloudBase HTTP 访问服务：删路由 → 解绑 → 绑新证 → 重建路由 → 探活
用法: cert-rebind.py <domain> <certId> <path> <upstreamType> <upstreamName> [envId]
示例: cert-rebind.py www.luckyducky.cn a2uTYnxU / STATIC_STORE staticstore
      cert-rebind.py kf.luckyducky.cn a2iU1Djn /kfcallback SCF kfCallback

与 cert-renew.py 配套（renew 签新证 → rebind 换绑上线）。
注意：换绑窗口内该域名 HTTPS 中断约 30-60 秒（边缘生效延迟）。
"""
import json, subprocess, sys, time, ssl, socket

ENV_DEFAULT = "cloudbase-d4gcssqbv06865479"

def run(*args):
    r = subprocess.run(args, capture_output=True, text=True,
                       timeout=120, input="y\n")
    out = r.stdout + r.stderr
    try:
        return json.loads(out[out.index("{"):]), out
    except Exception:
        return None, out

def live_cert(domain):
    """返回线上证书 notAfter 的日期字符串，失败返回 None"""
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection((domain, 443), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=domain) as s:
                der = s.getpeercert(binary_form=True)
        import datetime
        r = subprocess.run(["openssl", "x509", "-noout", "-enddate"],
                           input=ssl.DER_cert_to_PEM_cert(der),
                           capture_output=True, text=True)
        return r.stdout.strip().split("=", 1)[-1]
    except Exception as e:
        print(f"  探活失败: {e}")
        return None

def rebind(domain, cert_id, path, upstream_type, upstream_name, env):
    route_cfg = json.dumps({"domain": domain, "routes": [{
        "path": path, "upstreamResourceType": upstream_type,
        "upstreamResourceName": upstream_name,
        "enable": True, "enableSafeDomain": True}]})

    steps = [
        ("删旧路由", ["tcb", "routes", "delete", domain, "-p", path, "-e", env, "--json"]),
        ("解绑域名", ["tcb", "domains", "rm", domain, "-e", env, "--json"]),
        ("绑新证",   ["tcb", "domains", "add", domain, "--certid", cert_id, "-e", env, "--json"]),
        ("重建路由", ["tcb", "routes", "add", "-d", route_cfg, "-e", env, "--json"]),
    ]
    for name, cmd in steps:
        d, out = run(*cmd)
        ok = d is not None and "message" in str(d)
        print(f"[{name}] {'✅' if ok else '❌'} {(d or {}).get('data', {}).get('message', '') or out[-200:]}")
        if not ok:
            print(f"!! {name} 失败，中止。回滚参考备份目录（runner 本地 logs/cert-rebind-backup-*/）")
            sys.exit(1)

    print("等待边缘生效…")
    for i in range(8):  # 最多 4 分钟
        time.sleep(30)
        end = live_cert(domain)
        if end:
            import datetime
            exp = datetime.datetime.strptime(end, "%b %d %H:%M:%S %Y GMT")
            # Prefer: new cert should be >45 days out (free DV ~90d). Avoid hardcoding calendar year forever.
            if exp > datetime.datetime.utcnow() + datetime.timedelta(days=45):
                print(f"✅ [{domain}] 新证已上线，到期 {end}")
                return True
            print(f"  第{i+1}次探测：仍是旧证({end})，继续等…")
        else:
            print(f"  第{i+1}次探测：未取到证书，继续等…")
    print(f"⏳ [{domain}] 4 分钟内未见新证生效，人工复查 tcb domains ls")
    return False

if __name__ == "__main__":
    if len(sys.argv) < 6:
        print(__doc__); sys.exit(2)
    env = sys.argv[6] if len(sys.argv) > 6 else ENV_DEFAULT
    ok = rebind(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], env)
    sys.exit(0 if ok else 1)
