# admin 运营端 / 平台基建 / 元测试域 · 黄金用例（行为断言基准）

> 提炼自旧线 tests/（2026-07-04·M0，兜底域：负责其余五域未认领的全部文件 + 全仓认领核对）。每条为栈无关行为断言 + 源文件。与他册重叠的主题一律指针化不复抄（防复述漂移·病根#5）。

## 一、Admin 前端纯逻辑

**卡面生成（印刷交付物）**
- 卡面正反两面都能从卡片配置生成印刷交付物：正面含尺寸(mm)、底色、品牌角标；反面含标题、二维码占位区、扫码说明。 — `tests/admin/cardSvg.test.js`
- 卡面文案源自后台用户输入且是印刷交付物，渲染前必须做 XSS 转义——含脚本标记的标题绝不能原样进入交付物，须转义成无害文本。 — `tests/admin/cardSvg.test.js`（剔除：SVG 字面断言，语义已栈无关保留）

**发货工作台纯逻辑**
- 发货台配置单源齐全：拣货步骤名、纸张预设、物流公司清单来自单一数据源且非空。 — `tests/admin/fulfill.test.js`
- 人眼短编号：16 位订单号派生「月日-随机尾段」；非 16 位输入原样返回、不报错。 — `tests/admin/fulfill.test.js`
- 拣货汇总：跨订单按产品名合并求和、按数量降序；同名不同规格并成一行（成品不按规格备货）；取最早下单时间、统计费用不符单数；空数组全零、缺条目的脏单容忍跳过、不崩。 — `tests/admin/fulfill.test.js`
- 内部发货标签数据：短编号/收件人/电话/拼接地址/清单/总件数齐全，同名行合并，且**绝不携带金额**等内部字段。 — `tests/admin/fulfill.test.js`
- **扫码分类安全判序（最要命不变量）**：待发货队列内订单号判「订单」（容忍扫码枪回车后缀）；空白判「空」；「订单号形状但不在待发货队列」（已发货箱旧码）单独归类、**绝不落运单号分支**（否则别单箱码会被当运单号发给当前订单）；真运单号形态判「运单」并带号；形似订单号但不可能是订单号者按运单处理。 — `tests/admin/fulfill.test.js`
- 打印页：N 单生成 N 个标签、页面尺寸取所选纸张预设、每标签独立分页；含二维码/短编号/收件人/产品行/总件数，不含金额；收件人/地址特殊字符转义防破版；产品行超 6 行切紧凑缩字号。 — `tests/admin/fulfill.test.js`（剔除：HTML/CSS 字面）

**商品脏数据归一化**
- 脏商品（缺失或为 null 的数组字段）经归一化必降级为安全空数组形状，保留已有字段、已是数组的原样保留，使列表页渲染访问永不因 undefined 抛错致整页白屏。 — `tests/admin/products.test.js`

**课时级批量传视频映射**
- 去扩展名只去最后一段、无扩展原样返回。 — `tests/admin/videoBatch.test.js`
- 批量传视频映射：文件按文件名数字序排序（2 在 10 前），顺序填入现有段、超出部分自动新建段（段名取文件名）、文件少于段则只填不建；保留原始文件引用供上传；空列表得空计划。 — `tests/admin/videoBatch.test.js`

**备货→开单一次性预填** → 见 `inventory-scm.md §M`（同源不复抄）。

## 二、adminApi 云端动作（上新流水线 / 上下架 / 看板 / 批次 / 分片上传）

**HTTP 外壳与首登引导**
- HTTP 外壳：预检请求放行(204)、非 POST 拒(405)、坏 JSON 拒(400)。 — `tests/cloud/adminPipeline.test.js`
- 口令闸：健康探针免口令、其余动作口令错拒。 — `tests/cloud/adminPipeline.test.js`
- 首登引导：必须匹配部署密钥才能首次设口令（未配部署密钥禁引导、不匹配拒），已设口令后其他口令一律被拒（关抢占窗口）。 — `tests/cloud/adminPipeline.test.js`

**商品/课程/内容管线**
- 商品草稿保存：字段白名单清洗（超长截断、丢非白名单字段），落库「筹备中」，可取回。 — `tests/cloud/adminPipeline.test.js`
- 商品上架四道门：缺封面/缺名价/缺 SKU 分别拒、齐全才成功；成功时价格转数字、首次上架默认上首页、草稿转在售。 — `tests/cloud/adminPipeline.test.js`
- 上架价格硬边界：负价拒、超大价拒。 — `tests/cloud/adminMisc.test.js`
- 删除商品：草稿与已上架记录一并删、删除诚实（两处都查不到）。 — `tests/cloud/adminMisc.test.js`
- 首页橱窗保存可改排序/是否精选，列表按排序升序。 — `tests/cloud/adminPipeline.test.js`
- 课程草稿发布：无草稿拒；发布覆盖正式课程、保留三层清洗后文案。 — `tests/cloud/adminPipeline.test.js`
- 课程与帮助视频**再发布做孤儿视频回收**：删「旧发布有、新发布没有」的视频文件（替换/删段留下的孤儿），仍在用的不误删。 — `tests/cloud/adminPipeline.test.js`
- 卡片保存：双面、非法颜色回默认、尺寸夹取上下限；首页内容保存白名单+截断；帮助视频保存两级白名单（限长/主题数封顶/剔除无视频小段与空主题），管理端读回原始视频源（已过口令闸）。 — `tests/cloud/adminPipeline.test.js`

**商品软下架（listed 语义）**
- 只下发在售（含旧无字段兼容）、不下发已停售；下架即从下发列表消失、恢复即重新下发；对不存在商品报无此商品；软下架是翻标记非硬删（记录完整、详情直达与历史订单不受影响）。 — `tests/cloud/productListed.test.js`
- **重新上架不隐式恢复销售**：整文档覆盖上架时保留原停售标记、须显式恢复才复售（防编辑重发把停售商品复活）。 — `tests/cloud/productListed.test.js`
- 草稿列表附带上架三态映射（在售/已下架/筹备中），下架后即时反映。 — `tests/cloud/productListed.test.js`

**批次与建码**
- 建码批次：listBatches 按批次聚合总数/已激活数、listBatchCodes 列出该批全部码；批次读路径分页全取（不再单次截断）、不混入别的课。 — `tests/cloud/adminPipeline.test.js`、`batchesPaging.test.js`
- 建码闸门细则 → 见 `learning-content.md §一`（激活码生成，同源不复抄）。

**分片上传（真实尺寸样本验收）**
- 分片收尾：序号不连续（缺号）拒、不拼损坏文件；序号正好覆盖全量才放行拼接。 — `tests/cloud/adminMisc.test.js`
- 真实尺寸样本（非玩具样本·根因#8）：200KB 真实图多片上传重组后字节数等于原图（全程无截断）；单片体积边界（上限放行、超一字节拒）；回落分片通道容量须覆盖体积闸（约 15MB 视频能重组），但仍设片数上限（防无界回落）。 — `tests/cloud/adminMisc.test.js`

**看板**
- 计数走精确统计（不再内存长度封顶）：用户数、订单数（含未付全量）、码总数/已激活数均精确。 — `tests/cloud/dashboard.test.js`
- 最近动态混合流：订单/激活/进课/退款按事件时间倒序合并、文案带类型。 — `tests/cloud/dashboard.test.js`
- 采样近似值有明确标注形状（GMV 精确故标非近似）；GMV 口径与钱链异常定向查询 → 见 `orders-money.md`（跨域子集）。 — `tests/cloud/dashboard.test.js`
- 设置二次保存不 500：读回文档的内部主键不带回写库；二次保存与首存字段合并保留（非整存覆盖）；非法告警 webhook 仍拒。 — `tests/cloud/adminMisc.test.js`
- 看板交易异常三类（费用不符/退款不符/退款卡单超时未回调，刚触发不算）。 — `tests/cloud/adminMisc.test.js`

**公开目录读**
- 商品列表只读、无闸、按排序升序下发。 — `tests/cloud/getProducts.test.js`
- 首页内容/帮助视频公开读 → 见 `learning-content.md §九`（同源不复抄）。

## 三、鉴权/RBAC/频控/上传消毒/企微免登

→ 全部见 `kit-security.md`（§C 身份闸与会话、§D RBAC 默认拒、§F 频控与锁定、§J 上传路径消毒）与 `cs-agent.md §十`（企微免登与坐席令牌）。同源不复抄。

## 四、商品评价

→ 见 `learning-content.md §七`（提交闸门/汇总口径/列表分页，同源不复抄）。

## 五、用户账户与写入闸门

- 登录存 unionid 桥接：有 unionid 存进用户档（新老用户都补存）、无 unionid（未绑开放平台）不存且登录照常；登录不调外部 API、best-effort 不反噬登录。 — `tests/cloud/login.test.js`
- 登录静默 upsert：无身份拒；首登建档标记为新、再登取回同一档不重复建档；登录与更新资料**并发首写都只建一条用户档**（确定性主键幂等）。 — `tests/cloud/userWrites.test.js`
- 更新资料白名单+截断+归属：非白名单字段忽略、昵称截断、简介去空白、**头像非云存储地址拒收**（防注入任意 URL）。 — `tests/cloud/userWrites.test.js`
- 意见反馈写库过闸：无身份 fail-closed 拒；内容空/非串/纯空白拒且不落库；落库绑本人身份（不信前端）、字段白名单、分类枚举越界归默认、超长截断；超限频拒且被挡的那条不落库。 — `tests/cloud/submitFeedback.test.js`
- 用户端限频细则 → 见 `kit-security.md §F`。

## 六、平台基建兜底

- 事件流水定时清理：只删 90 天以上、保留新档（含边界）、返回删除数；**仅服务端（无身份）触发**，客户端带身份调用一律拒不删；无过期档删 0 不抛。 — `tests/cloud/cleanupEvents.test.js`
- 清理连带清过期频控记录（保活跃窗口）与客服去重痕（保新），无时间戳的令牌/游标不误删。 — `tests/cloud/cleanupEvents.test.js`
- seed/init 管理闸与建表单源对齐 → 见 `learning-content.md §十二`；频控并发正确性 → 见 `kit-security.md §F`；金额/价格/limit 属性不变量 → 见 `kit-security.md §G/§I/§J` 与 `orders-money.md`。

## 七、元测试 · 随治理体系重建（tests/scripts/ 六件·只留思想）

> 判定：这批绑「治理机器本体」，**随守卫体系在新线重建**——按下列思想重新落守卫，不逐条抄旧断言。

- **deploy-drift**：部署产物与源码 hash 对账，防「已提交≠已部署」；钱链敏感函数集合单源。 — `tests/scripts/deploy-drift.test.js`
- **format-hook**：格式交给工具不靠人——编辑落盘即按仓库配置就地格式化，作用范围与手动命令一致、对已规范文件幂等零改动。 — `tests/scripts/format-hook.test.js`
- **genOrderDomain**：单一声明源派生多产物防手改漂移——状态机由声明单源生成类型与流转表，生成器自检已提交态无漂移，流转表 from/to/初末态必在声明集内。 — `tests/scripts/genOrderDomain.test.js`
- **guard-provenance**：每条守卫必有 provenance（roots）与 id，测试型须有反向自检且指向真实文件——没有 provenance 就无法机器核覆盖率。 — `tests/scripts/guard-provenance.test.js`
- **guard-coverage**：框架完整性机器闭环——每条病根必有守卫或明示靠人豁免，删任一即报缺口；守卫体系自身的覆盖率被机器持续核。 — `tests/scripts/guard-coverage.test.js`
- **loadtest**：桩绿≠真证——同一读取须同时兼容云函数桩形状与真库 SDK 形状（0 值不当假值漏读、无记录安全归零），防形状漂移致 CAS 测试假阴。 — `tests/scripts/loadtest.test.js`

## 八、覆盖清点与全仓认领核对

**本域完整收录 38 文件**（admin 前端 5 + adminApi 动作/catalog 16 + 评价账户兜底 11 + 元测试 6），约 99 条断言（重叠主题已指针化到他册）。
**全仓认领核对（六域 + 前端域 = 123 文件，无一静默丢弃）**：
- tests/ 共 **100** 文件：钱链订单 21 + kit 安全 8 + 学习内容 5 + 客服坐席 19 + 库存 SCM 9 + 本域 38 = 100 ✓（各域切片交叠已在各册点名）。
- packages/miniapp/tests/ 共 **23** 文件：学习/内容相关 13 见 `learning-content.md`；其余 10（cart/persist/validate/format/address/auth/orders/orders-pay/aftersales-store/user）见 `frontend-store.md`。23 ✓。
- 点名无测试的源码（不发明断言）：`utils/express.js`（物流编码映射）与 `utils/customerService.js` 无对应测试——新线接手时若保留该功能须补规格。
**归属交叠已点名**（propertyInvariants 跨钱链/kit、confirmEnter 跨学习/钱链、checkpoints 跨学习/客服等）——各册互设指针、单源不复抄。
