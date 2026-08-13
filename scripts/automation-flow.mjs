#!/usr/bin/env node
/**
 * luckyducky-fable 自动业务流验证（automator / IPv6）
 *
 * 流程：首页 → 商品详情 → 加入购物车 → 购物车验证 → 截图取证
 * 依赖：微信开发者工具已启动 + automation 服务器已拉起（agent start）
 * 通道：ws://[::1]:9420（IPv6！）
 *
 * 用法：
 *   node scripts/automation-flow.mjs                 # 跑完整业务流
 *   node scripts/automation-flow.mjs probe [page]    # 探查页面元素类名
 *   node scripts/automation-flow.mjs data [page]     # 读页面数据
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '../rewrite/mp');
const AUTOMATOR_WS = 'ws://[::1]:9420'; // IPv6！automator 的 WebSocket 端点
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  // 前置：确保 automation 服务器与项目窗口就绪
  try {
    execSync(`wechatide -c pi-agent agent start --project "${PROJECT}" --port 9420 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
  } catch { /* 已就绪则忽略 */ }
  try {
    execSync(`wechatide -c pi-agent open_project_window --project "${PROJECT}" 2>/dev/null`, { encoding: 'utf8', timeout: 30000 });
  } catch { /* 已打开则忽略 */ }
  const require = createRequire(import.meta.url);
  const automator = require('miniprogram-automator');
  return automator.connect({ wsEndpoint: AUTOMATOR_WS });
}

async function runFlow() {
  const mini = await connect();
  try {
    console.log('🔌 连接成功，开始业务流测试\n');

    // 1️⃣ 首页
    console.log('【1/5】回到首页...');
    await mini.reLaunch('/pages/home/home');
    await sleep(4000);
    const home = await mini.currentPage();
    const homeData = await home.data();
    const products = homeData.products || [];
    console.log(`  ✅ 首页加载，商品 ${products.length} 个`);
    if (!products.length) { console.log('  ❌ 无商品，中止'); process.exit(1); }
    const first = products[0];
    console.log(`  📦 目标商品: ${first.name} (${first.priceLabel})`);

    // 2️⃣ 详情
    console.log('\n【2/5】进入商品详情...');
    await mini.navigateTo(`/pages/detail/detail?id=${first.id}`);
    await sleep(4000);
    const detail = await mini.currentPage();
    console.log(`  ✅ 当前页: ${detail.path}`);
    const dData = await detail.data();
    console.log(`  💰 价格: ${dData.currentPriceNum}`);

    // 3️⃣ 加购
    console.log('\n【3/5】点击「加入购物车」...');
    const cartBtn = await detail.$('.pdp-btn-cart');
    if (!cartBtn) { console.log('  ❌ 找不到加购按钮'); process.exit(1); }
    await cartBtn.tap();
    await sleep(2500);
    console.log('  ✅ 已点击加购');

    // 4️⃣ 购物车验证
    console.log('\n【4/5】切换到购物车...');
    try { await mini.switchTab('/pages/cart/cart'); } catch { await mini.reLaunch('/pages/cart/cart'); }
    await sleep(4000);
    const cart = await mini.currentPage();
    const cartData = await cart.data();
    const items = cartData.items || cartData.cartItems || cartData.list || [];
    console.log(`  ✅ 购物车页: ${cart.path}`);
    if (Array.isArray(items)) {
      console.log(`  🛒 购物车商品数: ${items.length}`);
      items.slice(0, 5).forEach((it, i) => {
        const name = it.name || it.title || it.productName || it.skuName || JSON.stringify(it).slice(0, 60);
        console.log(`     ${i + 1}. ${name}`);
      });
    } else {
      console.log('  原始数据:', JSON.stringify(cartData).slice(0, 400));
    }

    // 5️⃣ 截图取证
    console.log('\n【5/5】截图取证...');
    try {
      await mini.screenshot('/Users/sparrow/Desktop/wx_cart_result.png');
      console.log('  ✅ 截图已存桌面 wx_cart_result.png');
    } catch (e) { console.log('  ⚠️ 截图失败:', e.message); }

    console.log('\n🏁 业务流测试完成');
  } finally { await mini.disconnect(); }
}

async function runProbe(page) {
  const mini = await connect();
  try {
    await mini.reLaunch(page);
    await sleep(4000);
    const cur = await mini.currentPage();
    console.log(`📄 当前页: ${cur.path}`);
    const els = await cur.$$('view, button, image, text, navigator');
    const classes = new Set();
    const texts = new Set();
    for (const el of els) {
      try {
        const c = await el.attribute('class');
        if (c) classes.add(c);
        const t = await el.text();
        if (t && t.trim()) texts.add(t.trim());
      } catch { /* 跳过 */ }
    }
    console.log('🧩 元素总数:', els.length);
    console.log('📋 类名（前30）:', [...classes].slice(0, 30));
    console.log('📝 文本（前15）:', [...texts].slice(0, 15));
  } finally { await mini.disconnect(); }
}

async function runData(page) {
  const mini = await connect();
  try {
    await mini.reLaunch(page);
    await sleep(4000);
    const cur = await mini.currentPage();
    const data = await cur.data();
    console.log(`📄 ${cur.path} 页面数据:`);
    console.log(JSON.stringify(data, null, 2).slice(0, 2000));
  } finally { await mini.disconnect(); }
}

const [sub, arg] = process.argv.slice(2);
const help = `
luckyducky-fable 自动业务流验证（automator / IPv6）

用法:
  node scripts/automation-flow.mjs              # 跑完整业务流（首页→详情→加购→购物车）
  node scripts/automation-flow.mjs probe [page] # 探查页面元素（默认 /pages/home/home）
  node scripts/automation-flow.mjs data [page]  # 读页面数据

示例:
  node scripts/automation-flow.mjs
  node scripts/automation-flow.mjs probe /pages/detail/detail?id=prod-2
  node scripts/automation-flow.mjs data /pages/cart/cart
`;

(async () => {
  if (sub === 'help' || sub === '--help' || sub === '-h') { console.log(help); return; }
  if (!sub) { await runFlow(); return; }
  if (sub === 'probe') { await runProbe(arg || '/pages/home/home'); return; }
  if (sub === 'data') { await runData(arg || '/pages/home/home'); return; }
  console.log(`❌ 未知子命令: ${sub}\n`); console.log(help);
})().catch((e) => { console.error('❌ 执行失败:', e.message); process.exit(1); });
