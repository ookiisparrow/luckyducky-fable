#!/usr/bin/env node
/**
 * 微信开发者工具官方 Agent API 调用封装
 *
 * 官方调用方式：wechatide -c <clientName> <toolName> [flags...]
 * 文档：docs/运维手册.md「工具」（官方完整手册在本机开发者工具安装目录的 wechatide-skill/）
 *
 * 用法：
 *   node scripts/wechat-agent.mjs status              # 门禁检查（认证）
 *   node scripts/wechat-agent.mjs open                # 打开项目窗口
 *   node scripts/wechat-agent.mjs compile [page]      # 编译并打开页面
 *   node scripts/wechat-agent.mjs debug [page]        # 官方 API 真机调试（自动开窗+编译+触发）
 *   node scripts/wechat-agent.mjs preview [page]      # 推送预览到微信
 *   node scripts/wechat-agent.mjs net                 # 读网络请求
 *   node scripts/wechat-agent.mjs console [pattern]   # 读 console（默认全部）
 *   node scripts/wechat-agent.mjs read-data [page]    # automator 读页面数据（IPv6 连接）
 *   node scripts/wechat-agent.mjs nav <url>           # automator 导航（如 /pages/detail/detail?id=x）
 *   node scripts/wechat-agent.mjs eval <js>           # automator 执行 JS（如 '1+1'）
 *
 * automator 连接：ws://[::1]:9420（IPv6！不是 127.0.0.1）
 * 依赖：node_modules/miniprogram-automator（项目已装）
 *
 * 环境变量：WECHAT_AGENT_CLIENT 客户端名（默认 ldrw-cli，与运维手册一致）
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '../rewrite/mp');
const HOME_PAGE = 'pages/home/home';
const CLIENT = process.env.WECHAT_AGENT_CLIENT || 'ldrw-cli';
const SKILL_VERSION = '0.3.9';
const AUTOMATOR_WS = 'ws://[::1]:9420'; // IPv6！automator 的 WebSocket 端点

// ---------- automator（IPv6 连接，读/操作模拟器运行时） ----------
async function automatorConnect() {
  const require = createRequire(import.meta.url);
  const automator = require('miniprogram-automator');
  // 前置：确保 automation 服务器与项目窗口就绪
  try {
    execSync(`wechatide -c ${CLIENT} agent start --project "${PROJECT}" --port 9420 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
  } catch { /* 已就绪则忽略 */ }
  try {
    execSync(`wechatide -c ${CLIENT} open_project_window --project "${PROJECT}" 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
  } catch { /* 已打开则忽略 */ }
  return automator.connect({ wsEndpoint: AUTOMATOR_WS });
}

function runTool(tool, args = {}, timeoutMs = 120000) {
  const flags = [`-c ${CLIENT}`, tool];
  for (const [k, v] of Object.entries(args)) {
    if (v === true) flags.push(`--${k}`);
    else if (v !== false && v !== undefined && v !== null) flags.push(`--${k}`, String(v));
  }
  const cmd = `wechatide ${flags.join(' ')} 2>/dev/null`;
  const out = execSync(cmd, { encoding: 'utf8', timeout: timeoutMs });
  // wechatide 返回整体是一个 JSON 对象（可能多行）；先整体解析，失败再找尾部 JSON
  try { return JSON.parse(out.trim()); } catch { /* 继续 */ }
  const lines = out.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* 继续向上找 */ }
  }
  return { ok: false, raw: out };
}

function fmt(r) {
  if (r.ok !== false && r.result) return JSON.stringify(r.result, null, 2);
  return JSON.stringify(r, null, 2);
}

async function cmdStatus() {
  console.log(`\n🔐 门禁检查（client=${CLIENT}）...\n`);
  const r = runTool('check_wechatide_status', { 'skill-version': SKILL_VERSION }, 30000);
  const st = r.result || {};
  console.log('  登录:', st.loginExpired ? '❌ 过期' : '✅ 正常');
  console.log('  用户:', st.loginUser?.nickName || '未知');
  console.log('  版本关系:', st.versionRelation);
  console.log('  CLI 令牌:', st.tokenRequired ? '需要' : '不需要');
  if (r.ok === false) { console.log('\n⚠️ 完整返回:', JSON.stringify(r).slice(0, 300)); process.exitCode = 1; }
  console.log('');
}

async function cmdOpen() {
  console.log(`\n📂 打开项目窗口...\n  项目: ${PROJECT}\n`);
  const r = runTool('open_project_window', { project: PROJECT });
  console.log('  ', fmt(r));
}

async function cmdCompile(page) {
  console.log(`\n⚙️  编译并打开页面: ${page}\n`);
  const r = runTool('simulator_open_page', { project: PROJECT, page });
  console.log('  ', fmt(r));
}

async function cmdDebug(page) {
  console.log(`\n🔧 官方 API 真机调试流程...\n  项目: ${PROJECT}\n  页面: ${page}\n`);
  console.log('  1/3 门禁检查');
  runTool('check_wechatide_status', { 'skill-version': SKILL_VERSION }, 30000);
  console.log('  2/3 打开窗口 + 编译');
  runTool('open_project_window', { project: PROJECT });
  runTool('simulator_open_page', { project: PROJECT, page });
  console.log('  3/3 触发真机调试（--action remote --auto，局域网模式免扫码）');
  const r = runTool('automation_viewport_action', { project: PROJECT, action: 'remote', auto: true });
  console.log('  ', fmt(r));
  console.log('\n📱 若返回 pending + taskId：');
  console.log('   用 polling_task_result 轮询回调（每 10 秒，最多 10 次）：');
  console.log(`   wechatide -c ${CLIENT} polling_task_result --task-id <taskId>`);
  console.log('\n   二维码可能在 RemoteDebugWindow（远程调试窗口），被主窗口遮挡时找一下。\n');
}

async function cmdPreview(page) {
  console.log(`\n🚀 推送预览到开发者微信...\n  页面: ${page}\n`);
  const r = runTool('auto_preview', { project: PROJECT, 'page-path': page });
  console.log('  ', fmt(r));
  console.log('\n📱 打开手机微信，点开预览卡片即真机运行（零扫码）。\n');
}

async function cmdNet() {
  console.log('\n🌐 网络请求（最近）...\n');
  const r = runTool('get_simulator_network', { project: PROJECT, command: 'grep -n .' });
  const text = r.result?.text || JSON.stringify(r);
  console.log(text.slice(0, 2000));
  console.log('');
}

async function cmdConsole(pattern) {
  console.log('\n📜 Console 日志...\n');
  const cmd = pattern ? `grep -i ${pattern}` : 'grep -n .';
  const r = runTool('get_simulator_console', { project: PROJECT, command: cmd });
  const text = r.result?.text || JSON.stringify(r);
  console.log(text.slice(0, 2000));
  console.log('');
}

async function cmdReadData(page) {
  console.log(`\n📊 读取页面数据: ${page}\n`);
  const mini = await automatorConnect();
  try {
    await execSync(`wechatide -c ${CLIENT} simulator_open_page --project "${PROJECT}" --page ${page} 2>/dev/null`, { encoding: 'utf8', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 5000));
    const cur = await mini.currentPage();
    console.log('📄 当前页面:', cur?.path);
    const data = await cur?.data();
    console.log('📊 页面数据:', JSON.stringify(data, null, 2).slice(0, 2000));
  } finally { await mini.disconnect(); }
}

async function cmdNav(url) {
  console.log(`\n🧭 导航到: ${url}\n`);
  const mini = await automatorConnect();
  try {
    await mini.navigateTo(url);
    await new Promise((r) => setTimeout(r, 3000));
    const cur = await mini.currentPage();
    console.log('✅ 导航完成，当前页面:', cur?.path);
  } catch {
    // navigateTo 失败可能是 tab 页，改试 reLaunch
    try {
      await mini.reLaunch(url);
      await new Promise((r) => setTimeout(r, 3000));
      const cur = await mini.currentPage();
      console.log('✅ reLaunch 完成，当前页面:', cur?.path);
    } catch (e2) { console.error('❌ 导航失败:', e2.message); }
  } finally { await mini.disconnect(); }
}

async function cmdEval(js) {
  console.log(`\n💻 执行 JS: ${js}\n`);
  const mini = await automatorConnect();
  try {
    // automator 的 evaluate 需要函数字符串；纯表达式自动包成函数
    const fnSrc = /^\s*(function|async|\()/.test(js) ? js : `function(){ return ${js} }`;
    const result = await mini.evaluate(fnSrc);
    console.log('✅ 结果:', JSON.stringify(result, null, 2).slice(0, 1500));
  } finally { await mini.disconnect(); }
}

// ---------- 主流程 ----------
const [sub, arg] = process.argv.slice(2);
const help = `
微信开发者工具官方 Agent API 封装

用法:
  node scripts/wechat-agent.mjs status              # 门禁检查（认证）
  node scripts/wechat-agent.mjs open                # 打开项目窗口
  node scripts/wechat-agent.mjs compile [page]      # 编译并打开页面
  node scripts/wechat-agent.mjs debug [page]        # 官方 API 真机调试
  node scripts/wechat-agent.mjs preview [page]      # 推送预览到微信（零扫码）
  node scripts/wechat-agent.mjs net                 # 读网络请求
  node scripts/wechat-agent.mjs console [pattern]   # 读 console（可带 grep 模式）
  node scripts/wechat-agent.mjs read-data [page]    # automator 读页面数据（IPv6）
  node scripts/wechat-agent.mjs nav <url>           # automator 导航
  node scripts/wechat-agent.mjs eval <js>           # automator 执行 JS

环境变量: WECHAT_AGENT_CLIENT 客户端名（默认 ldrw-cli）
`;

if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
  console.log(help);
  process.exit(0);
}

try {
  const page = arg || HOME_PAGE;
  switch (sub) {
    case 'status':  await cmdStatus(); break;
    case 'open':    await cmdOpen(); break;
    case 'compile': await cmdCompile(page); break;
    case 'debug':   await cmdDebug(page); break;
    case 'preview': await cmdPreview(page); break;
    case 'net':     await cmdNet(); break;
    case 'console': await cmdConsole(arg); break;
    case 'read-data': await cmdReadData(page); break;
    case 'nav': if (!arg) { console.log('❌ 请提供导航路径，如 /pages/detail/detail?id=x'); process.exit(1); } await cmdNav(arg); break;
    case 'eval': if (!arg) { console.log('❌ 请提供 JS 表达式，如 "1+1"'); process.exit(1); } await cmdEval(arg); break;
    default:
      console.log(`❌ 未知子命令: ${sub}`);
      console.log(help);
      process.exit(1);
  }
} catch (e) {
  console.error('\n❌ 执行失败:', e.message?.slice(0, 500) || e);
  process.exit(1);
}
