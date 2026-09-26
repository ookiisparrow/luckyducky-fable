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

def parse_tcb_output(out):
    """从命令输出里抠出第一段 JSON。抠不出或解析不了就当没有回包。

    只解第一段、忽略其后的文字：stderr 拼在 stdout 后，成功回包后跟一条 Node 警告
    就整体解析失败的话，第 1 步云端已删路由、脚本却判失败退出，线上域名断在半路。
    """
    try:
        return json.JSONDecoder().raw_decode(out, out.index("{"))[0]
    except Exception:
        return None

def tcb_step_ok(parsed, returncode):
    """这一步能不能接着干下一步。

    成功回包的内容随 CLI 版本变：3.7.3 是 {"data": {..., "message": "成功删除 1 个路由"}}，
    3.8.x 是 {"data": {"RequestId": "..."}}。只认不随版本变的部分，
    否则换个 CLI 版本，第 1 步云端已删路由、脚本却判失败退出，线上域名就断在半路。
    失败时 CLI 打 {"error": {...}} 且退出码非 0；data 里的 message 可能是成功文案，不能当失败信号。
    """
    if returncode != 0 or not isinstance(parsed, dict):
        return False
    if "error" in parsed or "Error" in parsed:
        return False
    data = parsed.get("data")
    # 各版本成功时 data 都有内容，空的说明没拿到真回包
    if not isinstance(data, dict) or not data:
        return False
    if "error" in data or "Error" in data:
        return False
    # 归属权没过时接口照样成功返回，域名其实没绑上；判法与 CLI 3.8.4 一致
    ownership = data.get("OwnershipVerification")
    if isinstance(ownership, dict) and ownership.get("DnsVerification"):
        return False
    return True

def _step_detail(parsed, out):
    if isinstance(parsed, dict):
        err = parsed.get("error")
        if not isinstance(err, dict):
            err = parsed.get("Error")
        if isinstance(err, dict):
            msg = err.get("message") or err.get("Message")
            if msg:
                return str(msg)
        data = parsed.get("data")
        if isinstance(data, dict):
            detail = data.get("RequestId") or data.get("message")
            if isinstance(detail, str) and detail.strip():
                return detail.strip()
    return (out or "")[-200:]

def run(*args):
    r = subprocess.run(args, capture_output=True, text=True,
                       timeout=120, input="y\n")
    out = r.stdout + r.stderr
    return parse_tcb_output(out), out, r.returncode

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
        d, out, code = run(*cmd)
        ok = tcb_step_ok(d, code)
        print(f"[{name}] {'✅' if ok else '❌'} {_step_detail(d, out)}")
        if not ok:
            print(f"!! {name} 失败，中止。本脚本不留备份；停在失败这一步，到云开发控制台按当前域名和路由状态手工恢复。")
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
