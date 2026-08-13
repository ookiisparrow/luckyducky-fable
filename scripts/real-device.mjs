#!/usr/bin/env node
/**
 * luckyducky-fable 一键真机调试脚本
 *
 * 原理：微信开发者工具内置 HTTP MCP 服务（无需 PI 支持 MCP，直接用 HTTP 调用）。
 * 通过 MCP 工具把小程序自动推送到真机运行 / 触发真机调试。
 *
 * 用法：
 *   node scripts/real-device.mjs status              # 检查工具连接状态
 *   node scripts/real-device.mjs preview [pagePath]  # 推送预览到开发者微信（默认 pages/home/home）
 *   node scripts/real-device.mjs debug   [pagePath]  # 触发真机调试（手机端可能需扫码确认）
 *
 * 可选环境变量：WX_DEVTOOLS_PORT 指定工具服务端口（默认自动探测）
 */
import http from 'node:http';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '../rewrite/mp');
const HOME_PAGE = 'pages/home/home';
const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

const KNOWN_PORTS = [9420, 9421, 9422];
const DEFAULT_TIMEOUT = 60000;
const DEBUG_TIMEOUT = 240000; // 真机调试需等待扫码确认，给足 4 分钟

// ---------- 端口探测 ----------
function findListeningPorts() {
  const ports = new Set();
  try {
    const out = execSync('lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null', { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (/wechat|Electron/i.test(line)) {
        const m = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (m) ports.add(Number(m[1]));
      }
    }
  } catch { /* lsof 不可用或超时，返回空列表 */ }
  return [...ports];
}

async function probeMcpPort(port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'real-device', version: '1.0' } },
    });
    const req = http.request({
      host: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        const ok = res.statusCode === 200 && data.includes('mcp-server');
        resolve(ok ? port : null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function findMcpPort() {
  if (process.env.WX_DEVTOOLS_PORT) return Number(process.env.WX_DEVTOOLS_PORT);
  for (const p of KNOWN_PORTS) {
    const found = await probeMcpPort(p);
    if (found) return found;
  }
  for (const p of findListeningPorts()) {
    const found = await probeMcpPort(p);
    if (found) return found;
  }
  return null;
}

// ---------- MCP 会话 ----------
function mcpRequest(port, sessionId, method, params, id, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`MCP 请求超时（${timeoutMs}ms）`)); });
    req.write(body);
    req.end();
  });
}

async function openSession(port) {
  const r1 = await mcpRequest(port, null, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'real-device', version: '1.0' },
  }, 1, 8000);
  if (r1.status !== 200) throw new Error(`MCP initialize 失败: ${r1.status}`);
  const sessionId = r1.headers['mcp-session-id'];
  await mcpRequest(port, sessionId, 'notifications/initialized', {}, null, 8000);
  return sessionId;
}

function parseSse(body) {
  const msgs = [];
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t.startsWith('data: ')) { try { msgs.push(JSON.parse(t.slice(6))); } catch { /* 非 JSON 行跳过 */ } }
    else if (t.startsWith('{')) { try { msgs.push(JSON.parse(t)); } catch { /* 非 JSON 行跳过 */ } }
  }
  return msgs;
}

async function callTool(port, sessionId, name, args, timeoutMs = DEFAULT_TIMEOUT) {
  const r = await mcpRequest(port, sessionId, 'tools/call', { name, arguments: args }, 99, timeoutMs);
  if (r.status !== 200) throw new Error(`工具 ${name} 调用失败: HTTP ${r.status}`);
  const msgs = parseSse(r.body);
  const msg = msgs.find((m) => m.id === 99);
  if (!msg) throw new Error(`工具 ${name} 无响应`);
  if (msg.error) throw new Error(`工具 ${name} 报错: ${JSON.stringify(msg.error)}`);
  const content = msg.result?.content || [];
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return { raw: text, result: msg.result };
}

function parseToolResult(text) {
  try { return JSON.parse(text); } catch { return { success: false, raw: text }; }
}

// ---------- 命令实现 ----------
async function cmdStatus(port) {
  console.log(`\n📡 微信开发者工具 MCP 服务: http://127.0.0.1:${port}/mcp\n`);
  const sid = await openSession(port);
  const r = await callTool(port, sid, 'check_wechatide_status', {});
  const st = parseToolResult(r.raw);
  console.log('  登录状态:', st.loginExpired ? '❌ 已过期，需要重新登录' : '✅ 正常');
  console.log('  当前用户:', st.loginUser || '未知');
  console.log('  CLI 令牌:', st.tokenRequired ? '启用' : '未启用');
  console.log('\n  ✅ 连接正常，可以执行 preview / debug 命令\n');
}

async function cmdPreview(port, pagePath) {
  console.log(`\n🚀 正在编译并推送预览到开发者微信...\n  项目: ${PROJECT}\n  页面: ${pagePath}\n`);
  const sid = await openSession(port);
  const r = await callTool(port, sid, 'auto_preview', {
    project: PROJECT,
    pagePath,
  });
  const res = parseToolResult(r.raw);
  if (res.success) {
    const size = res.info?.size?.total || 0;
    console.log(`\n✅ 预览已推送成功！代码包大小: ${(size / 1024).toFixed(1)} KB`);
    console.log('📱 请打开手机微信 → 找到「微信开发者工具」发来的预览卡片 → 点击即可在真机运行\n');
  } else {
    console.log('\n❌ 推送失败:', r.raw.slice(0, 500));
    process.exitCode = 1;
  }
}

async function cmdDebug(port, pagePath) {
  console.log(`\n🔧 正在准备真机调试环境...\n  项目: ${PROJECT}\n  页面: ${pagePath}\n`);
  // 关键前置：拉起 automation 服务器（真机调试依赖 automation 通道）
  console.log('  ⚙️  启动 automation 服务器...');
  try {
    execSync(`"${CLI_PATH}" agent start --project "${PROJECT}" --port ${port} 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
    console.log('  ✅ automation 服务器就绪');
  } catch { console.log('  ⚠️  automation 服务器启动提示（可忽略，继续尝试）'); }
  const sid = await openSession(port);
  // 确保项目窗口已打开（真机调试依赖窗口环境）
  try {
    await callTool(port, sid, 'open_project_window', { project: PROJECT });
  } catch { /* 窗口已开则忽略 */ }
  // 确保模拟器编译运行（automation 需要小程序在运行）
  try {
    await callTool(port, sid, 'simulator_open_page', { project: PROJECT, page: pagePath });
  } catch { /* 编译失败则继续尝试 */ }
  console.log('  📲 正在触发真机调试（最长等待 4 分钟，请留意手机端）...');
  const r = await callTool(port, sid, 'automation_viewport_action', {
    project: PROJECT,
    action: 'remote',
    auto: true,
  }, DEBUG_TIMEOUT);
  console.log('  MCP 返回:', r.raw.slice(0, 800));
  const parsed = parseToolResult(r.raw);
  if (parsed.taskId) {
    console.log('\n📱 检测到需要确认的任务（taskId: ' + parsed.taskId + '）');
  }
  console.log('\n📱 请检查：');
  console.log('   1. 电脑上微信开发者工具窗口是否弹出「真机调试」二维码 → 用手机微信扫码；');
  console.log('   2. 手机端弹出确认时点击「允许」，等待真机连接调试器。\n');
}

async function cmdOpen(port) {
  console.log(`\n📂 打开项目窗口...\n  项目: ${PROJECT}\n`);
  const sid = await openSession(port);
  const r = await callTool(port, sid, 'open_project_window', { project: PROJECT });
  console.log('  MCP 返回:', r.raw.slice(0, 300));
  console.log('\n✅ 项目窗口已打开（若未弹出请查看微信开发者工具）。\n');
}

// ---------- 主流程 ----------
async function main() {
  const [sub, arg] = process.argv.slice(2);
  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(`
luckyducky-fable 一键真机调试

用法:
  node scripts/real-device.mjs status              # 检查工具连接状态
  node scripts/real-device.mjs open                # 打开项目窗口
  node scripts/real-device.mjs preview [pagePath]  # 推送预览到开发者微信（默认 ${HOME_PAGE}）
  node scripts/real-device.mjs debug   [pagePath]  # 触发真机调试（手机端需扫码确认）

环境变量:
  WX_DEVTOOLS_PORT  指定工具服务端口（默认自动探测 9420/9421/9422 及运行中端口）
`);
    return;
  }

  console.log('🔍 正在探测微信开发者工具服务端口...');
  const port = await findMcpPort();
  if (!port) {
    console.log('\n❌ 未找到微信开发者工具的 MCP 服务。');
    console.log('   请先手动打开微信开发者工具（并确保已登录），再重试本命令。');
    console.log('   （若已打开仍失败：设置 → 安全设置 → 开启「服务端口」）');
    process.exit(1);
  }
  console.log(`✅ 已连接端口 ${port}\n`);

  const pagePath = arg || HOME_PAGE;
  switch (sub) {
    case 'status':  await cmdStatus(port); break;
    case 'open':    await cmdOpen(port); break;
    case 'preview': await cmdPreview(port, pagePath); break;
    case 'debug':   await cmdDebug(port, pagePath); break;
    default:
      console.log(`❌ 未知子命令: ${sub}`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n❌ 执行失败:', e.message || e);
  process.exit(1);
});
