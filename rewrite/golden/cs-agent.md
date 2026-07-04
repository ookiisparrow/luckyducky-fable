# 客服 / 坐席 / 企微域 · 黄金用例（行为断言基准）

> 提炼自旧线 tests/（2026-07-04·M0）。本域覆盖：微信客服 bot 分流、自建坐席工作台（**在用生产链路**）、外包账号与最小权、客户 360、数据共享同意、会话归档与质检、CSAT、主动召回、身份桥接、企微免登、回调安全。每条为栈无关行为断言 + 源文件；剔除绑实现措辞（确定性 `_id` 字面量、threadKey 格式、错误码串、企微 wire 字段/数字码、可调阈值），仅保留行为本质（见文末清点）。

## 一、会话状态机与认领互斥

- 待接队列只列「待接（pending）」会话，按到达时间先到先接（FIFO）。 — `tests/cloud/agentDesk.test.js`
- 队列读取有界分页（limit + 游标），逐页可取全，不静默挤出任何会话。 — `tests/cloud/agentDesk.test.js`
- 「被甩回商户的会话（escalated）」只有商户超管在队列里看得见并可重接；外包坐席看不见——否则升级会变黑洞。 — `tests/cloud/agentDesk.test.js`
- 认领待接会话：转为「服务中（active）」，绑定本坐席身份与认领时刻，返回会话视图。 — `tests/cloud/agentDesk.test.js`
- 商户可重新接手已升级会话（escalated→active），归属改到重接人。 — `tests/cloud/agentDesk.test.js`
- 认领互斥/幂等：已被他人服务中的会话再认领会被拒，不产生重复认领。 — `tests/cloud/agentDesk.test.js`
- 认领受接待上限约束：在接数达上限时拒绝新认领，会话保持待接不被接走。 — `tests/cloud/agentDesk.test.js`
- 无可信坐席身份时不认领（不信前端）；会话不存在返回未找到。 — `tests/cloud/agentDesk.test.js`
- 放手（release）：服务中→退回待接并清空归属，会话重回队列。 — `tests/cloud/agentDesk.test.js`
- 只有会话所属坐席或超管能放手；非所属外包放手他人会话被拒；对非服务中会话放手是幂等拒绝。 — `tests/cloud/agentDesk.test.js`
- 升级甩回商户（escalate）：服务中→escalated，且记录升级人；非所属被拒、非服务中被拒。 — `tests/cloud/agentDesk.test.js`
- 结束会话（close）：转为终态 closed；非所属被拒；已结束再关是幂等拒绝（终态不可重复关）。 — `tests/cloud/agentDesk.test.js`
- 结束「服务中」会话会触发 CSAT 评分提示；结束「从未接待过（pending）」的会话不触发 CSAT。 — `tests/cloud/agentDesk.test.js`
- 本坐席「我在接」列表只回自己服务中的会话（不含他人服务中、也不含自己 pending/escalated/closed），供刷新后恢复现场，天然按归属收窄。 — `tests/cloud/agentDesk.test.js`
- 坐席状态可写在线/忙碌/离线；首次写建档并带默认接待上限；切换状态不重置已配置的接待上限。 — `tests/cloud/agentDesk.test.js`
- 会话状态是「谁在接待」的单一判定源：pending/active/escalated 视为被接管中，closed/无会话视为空闲——欢迎语、bot 应答等都必须过它。 — `tests/cloud/kfDispatch.test.js`
- 会话直达（推送卡片点入）决策：已在我名下→直接打开（无需认领）；在待接队列→先认领；我的在接优先于队列（同 id 不重复认领）；都不在→未找到；无目标→不硬闯。 — `tests/agent/deepLink.test.js`
- 初始化建库清单必须包含坐席会话与坐席状态两个集合，使控制台能锁权限（防新集合动态建、锁不住的窗口）。 — `tests/cloud/seedGates.test.js`

## 二、外包最小权与 scoped 360 双闸

- 外包坐席角色只有「接待」这一最小权，不含全权、不含裸的「查客户」权——外包不能直接遍历全量客户，看 360 只能走「已认领会话」的收窄路径。 — `tests/cloud/agentDesk.test.js`、`tests/cloud/adminRbac.test.js`
- 外包直接调用客户 360 读、客户检索、会话检索一律被拒（批量导出洞已闭合）。 — `tests/cloud/adminRbac.test.js` 等
- 外包持「接待」权时坐席台各动作能过能力闸；归属收窄由处理器内「会话归属校验」二次把关。 — `tests/cloud/adminRbac.test.js`
- 归属 scope 闸（fail-closed）：会话归本坐席才放行；归他人拒；会话不存在拒；缺坐席或会话标识拒；未认领会话（归属为空）对真实坐席也判为非所属——空归属不放行，防导出未认领会话。 — `tests/cloud/csAccess.test.js`
- 坐席回复、看会话流、看会话 360，非所属外包操作他人会话一律被拒且不产生副作用。 — `tests/cloud/agentDesk.test.js`
- 按会话看客户 360 是外包唯一的 360 读路径，须同时过两道闸：① 归属（是本坐席在接）② 客户已同意数据共享；缺任一即拒。 — `tests/cloud/agentDesk.test.js`
- 双闸细则：所属+已同意→出面板；所属但未同意→拒；非所属→拒；会话未建身份桥接→如实回「无桥接」；会话不存在→未找到。 — `tests/cloud/agentDesk.test.js`
- 超管即数据控制者：可越过「归属」与「同意」两闸看任意会话 360（走既有隐私政策）。 — `tests/cloud/agentDesk.test.js`
- 后台客户 360 读/客户检索/单客户画像/会话检索均须「查客户」权，否则拒；超管过闸。 — `tests/cloud/customer360.test.js`、`tests/cloud/conversations.test.js`

## 三、数据共享同意

- 同意闸默认拒（fail-closed）：无建档/无同意记录拒；空客户标识拒；已撤回拒；显式同意才放行。 — `tests/cloud/csAccess.test.js`
- 同意必须是显式真值，仅仅「真值化」不算同意（防松判）。 — `tests/cloud/csAccess.test.js`
- 同意写侧只写本人：无可信身份拒；同意→建档记录同意与时刻；可撤回；已有档只更新不重复建档、保留原有字段；缺参数默认按未同意。 — `tests/cloud/dataConsent.test.js`
- 写侧与读闸一致：同意后 360 读闸放行，撤回后立即改判为拒。 — `tests/cloud/dataConsent.test.js`

## 四、消息收发与幂等去重

- 客服主动发消息是服务端专用能力：服务端调用+参数齐→发出；客户端（带身份）调用拒；缺参拒；未配置客服密钥拒。 — `tests/cloud/kfSend.test.js`
- 坐席回复须经统一发送接缝发出，并把出站消息归档（带坐席身份、可检索/质检）；发送失败必须回失败并带错误码，且失败消息不归档——绝不把失败当成功静默吞。 — `tests/cloud/agentDesk.test.js`
- 坐席回复越窗保护：只有「服务中」会话能发，未接/已结束会话不发；空文本拒。 — `tests/cloud/agentDesk.test.js`
- 批处理防吞单：单条处理失败不拖垮整批，其余照常处理；失败项撤回「已处理」认领以便下次重试；成功项保留认领去重。 — `tests/cloud/kfDispatch.test.js`
- 去重幂等：已认领处理过的消息再来直接跳过，不重复副作用。 — `tests/cloud/kfDispatch.test.js`
- 认领基建错（非撞号）不当作「重复跳过」：告警并标记本批失败、当条不处理——既不静默吞消息，也不在未认领下重复副作用。 — `tests/cloud/kfDispatch.test.js`
- 入站客户消息与出站回复都落归档，可按客户检索；出站的菜单/卡片也提取成人话文本以便检索。 — `tests/cloud/conversations.test.js`
- 归档幂等：同一条消息重投只留一档；无幂等键的事件类消息不归档；未桥接身份时仍归档（可按外部用户号检索，best-effort）。 — `tests/cloud/conversations.test.js`
- 归档 fail-soft：入参畸形也绝不抛错，不反噬消息处理主流程。 — `tests/cloud/conversations.test.js`
- 平台事件类消息（状态变更等噪声）不进坐席会话流。 — `tests/cloud/agentDesk.test.js`
- 会话流轮询增量合并：游标边界重复回同一条消息时**不产生重复气泡**（去重·永恒语义）；增量批次并入后按时间升序，乱序落库也按时间排；同一时刻不同方向/不同文视为不同条；无时间戳的脏消息不进流；游标只进不退，空批次不倒退。 — `tests/agent/thread.test.js`
- 坐席会话流增量拉取：只取游标之后的新消息，供前端轮询。 — `tests/cloud/agentDesk.test.js`
- 访问令牌带缓存：首取拉取并缓存，有效期内复用；取令牌失败不返回坏令牌。 — `tests/cloud/kfWecom.test.js`

## 五、转人工分流

- 关键词识别是确定性的（低幻觉）：命中类别与命中词，无法归类返回空。 — `tests/cloud/kfDispatch.test.js`
- 自由文本命中关键词→回高亮识别词的分类菜单；根菜单含分类+评价服务+人工入口，并提示可直接打字。 — `tests/cloud/kfDispatch.test.js`
- 菜单路由：人工→转人工；查订单→查订单；FAQ→回知识库单源答案（不写死）；申请售后/打开课程→跳已注册的小程序页；分类→下级菜单；未知→兜底回根菜单。 — `tests/cloud/kfDispatch.test.js`、`tests/cloud/kb.test.js`
- 点「转人工」：会话进入自建待接队列并给顾客转接确认文字，不去动平台会话态（自建队列承接人工，避免平台态被动漂移致无回复）。 — `tests/cloud/kfDispatch.test.js`
- 人工接管期间（pending/active/escalated）bot 不抢话（顾客消息仍归档进坐席会话流，不丢）；会话结束后 bot 恢复应答。 — `tests/cloud/kfDispatch.test.js`
- 已在队列/接待中再点「找人工」：回当前状态，不装死、不重复入队、不重置状态（坐席认领不被顾客重置）。 — `tests/cloud/kfDispatch.test.js`
- 已结束的旧会话再点「找人工」：重开进队列（清旧归属、刷新排队时间＝队尾重排、消息流从重开起算）并给转接确认——老客二次求助不被撞号静默吞。 — `tests/cloud/kfDispatch.test.js`
- 入队幂等：会话已在处理中再入队不覆盖其状态与认领信息；缺外部用户标识不写（不造无主会话）。 — `tests/cloud/kfDispatch.test.js`
- 转人工三态如实回：新入队→已排队、已在队列→已在、基建错→失败（不假装成功）；基建错时顾客收到「稍后再试」而非假「已为你转接」。 — `tests/cloud/kfDispatch.test.js`
- 新会话真正入队时推送在线坐席；重复入队不重复骚扰。 — `tests/cloud/agentPush.test.js`
- 查订单分流：未绑定→引导登录；已绑定→会话内回订单摘要。 — `tests/cloud/kfDispatch.test.js`
- 卡片缺封面素材时降级发文字（防小程序未发布/素材未配导致发送失败）。 — `tests/cloud/kfDispatch.test.js`
- FAQ 答案单源来自知识库：命中→发知识库答案；知识库缺该条→兜底回根菜单（不崩、不写死答案）；停用/空键→无答案。 — `tests/cloud/kb.test.js`

## 六、质检报表口径

- 会话量口径：总消息、入站、出站、客户数。 — `tests/cloud/conversations.test.js`
- 首次响应口径：入站→其后首个出站配对，统计均值/最大值；未答复计入；给出答复率。 — `tests/cloud/conversations.test.js`
- SLA 口径：在阈值下统计超时数与超时占比，并单列未答复数。 — `tests/cloud/conversations.test.js`
- 报表有界：样本量如实反映；仅在触顶时才标记近似。无数据渠道全 0 不报错。 — `tests/cloud/conversations.test.js`
- 质检报表是管理侧 oversight，限权账号默认拒、超管可看，且默认留痕。 — `tests/cloud/conversations.test.js`
- 会话检索按客户返回其会话、按时间倒序；支持有界游标分页、关键词页内子串过滤、按外部用户号检索（未绑定时）、按渠道叠加筛选；无匹配→空列表不报错。 — `tests/cloud/conversations.test.js`

## 七、CSAT（会话满意度）

- 评分只认 1–5；越界/非法不当作评分（落兜底、不脏分）。 — `tests/cloud/csat.test.js`
- 记分 fail-closed：合法分入库并记「最近一条」；越界一律拒、绝不入库（防脏分污染均分）；空客户标识拒。 — `tests/cloud/csat.test.js`
- 备注回写最近一条评分并清「最近」标记；无最近评分则静默跳过（不崩）。 — `tests/cloud/csat.test.js`
- 编排：点评分→记分并回「补充原因」菜单；再点原因标签→回写备注并致谢；伪造越界分→不记分。 — `tests/cloud/csat.test.js`
- 报表口径：均分 + 1–5 分布 + 总数 + 带备注数，忽略越界分；空集总数 0、均分 0，不崩。 — `tests/cloud/csat.test.js`
- 关单闭环：结束服务中会话时写「待评分」标记（限定时窗），并把评分提示文字归档（质检能回看「我们问了什么」）；关未接待过的会话不发提示、不写标记、不归档。 — `tests/cloud/agentDesk.test.js`
- 顾客对「待评分」标记在时窗内回纯数字→记分并消费标记、回可选原因菜单；无标记的纯数字→不记分（防随口数字误当评分）、照常回根菜单；标记过期→不记分。 — `tests/cloud/kfDispatch.test.js`

## 八、召回决策

- 召回是纯决策（与 I/O 分离），四类：催付（待付在「已过冷静期～支付窗口内」才催，太新/过窗不催）、物流（发货超时未签收才召，无发货时间不算）、未开课（激活未进课）、未完课（进课无进度；有进度不召回）。 — `tests/cloud/recall.test.js`
- 总数为四类之和；空输入安全不崩。 — `tests/cloud/recall.test.js`
- 定时扫描是服务端专用：客户端带身份调用→跳过不扫不推（防滥调）；服务端触发→读数据算召回并回各类计数；无推送配置时 fail-soft（不推不崩）。 — `tests/cloud/recall.test.js`

## 九、身份桥接

- 桥接写侧：有 unionid 且配置齐→转换出外部用户号并建「外部用户号→openid」映射（且记 unionid）。 — `tests/cloud/kfBind.test.js`
- 桥接 fail-closed：无 unionid 不写；未配置客服密钥拒；转换返空（无有效会话）不写；无可信身份（伪造）拒。 — `tests/cloud/kfBind.test.js`
- 归档与坐席侧读取都经桥接把外部用户号解析成 openid：能解析则带上，供按客户检索与 360 侧栏；解析不到仍 best-effort 保留外部用户号。 — `tests/cloud/conversations.test.js` 等
- 坐席看会话流/我在接列表时补齐 openid 桥接；会话未桥接时如实回「无桥接」而非假装有数据。 — `tests/cloud/agentDesk.test.js`
- 订单摘要经桥接查本人订单：映射存在返 openid、不存在返空；摘要取最近订单并中文化状态、带出运单号；无单→「没查到」。 — `tests/cloud/kfDispatch.test.js`

## 十、企微免登与坐席会话令牌

- 企微 code 免登：有效 code→查到绑定账号→签发会话令牌并返回能力与操作者身份；令牌以哈希入库、绝不存明文、带过期时刻。 — `tests/cloud/wecomLogin.test.js`
- 签发的令牌可用于后续请求鉴权（免口令）；超管绑定 userid 也可免登得全权。 — `tests/cloud/wecomLogin.test.js`
- 免登 fail-closed：无 code 拒（且不触外部调用）；无缓存令牌拒；OAuth 取不到 userid 拒；userid 未绑账号拒；账号停用拒且不签发。 — `tests/cloud/wecomLogin.test.js`
- 令牌鉴权 fail-closed：过期拒；登录后账号被停用→令牌立即失效；乱造令牌拒；外包令牌解析出「接待」权、令牌≠提权。 — `tests/cloud/wecomLogin.test.js`、`tests/cloud/adminSession.test.js`
- 外包账号管理（超管）：建号口令哈希入库不存明文、白名单回显；校验空名/短口令/撞口令；建号后可登录并派生最小权、带操作者身份（供审计）。 — `tests/cloud/agents.test.js`
- 停用/恢复外包账号即时生效；不许停超管；对非外包/不存在账号操作→未找到。 — `tests/cloud/agents.test.js`
- 列外包账号只列外包、白名单不回口令哈希、回企微 userid 供超管看绑定、排除超管。 — `tests/cloud/agents.test.js`
- 企微 userid 绑定：建号可带、可回填/改绑/解绑；同一 userid 全局唯一（建时与回填时都拒撞、改绑自身不算撞）；超管也可绑 userid 免登。 — `tests/cloud/agents.test.js`

## 十一、回调安全与会话态接管（企微）

- 回调验签 fail-closed（全场最关键）：篡改签名绝不进入处理、返回空并告警；正确签名解出同步令牌与客服 id 并处理。 — `tests/cloud/kfCrypto.test.js`
- 解密是加密的真逆运算（取回原文与接收方 id）；解密边界纵深：声明长度越界抛错，不返回错位切片。 — `tests/cloud/kfCrypto.test.js`
- 跨企业伪造（接收方≠本企业）不处理并告警；同企业照常处理。URL 验证：签名对→回明文回显；签名错→回空。 — `tests/cloud/kfCrypto.test.js`
- 会话态接管防「发出去没回复」：回复前先确保会话处于可发态——未处理态先接管再放行；已是智能助手态直接放行不重复接管；有人工坐席在接则跳过、bot 不抢话；待接入/已结束态跳过且不硬试接管（免告警噪声）；接管失败跳过不硬发。 — `tests/cloud/kfWecom.test.js`
- 反查顾客身份/会话态经平台原生接口，失败时安全兜底（读态失败返「未知」、反查失败返空）。 — `tests/cloud/kfWecom.test.js`
- 客服活体探针为服务端专用：令牌+API 健康不告警；令牌失败/API 异常/未配置→标记不健康并经唯一告警接缝推送；客户端（伪造身份）调用拒（防刷告警）。 — `tests/cloud/kfHealthProbe.test.js`

## 十二、坐席推送提醒

- 应用消息推送经单一接缝发出，多收件人合并、带应用标识与默认按钮文案。 — `tests/cloud/agentPush.test.js`
- 推送编排 fail-soft：无收件人/无应用标识/无缓存令牌→静默跳过；条件齐→发出。 — `tests/cloud/agentPush.test.js`
- 新入队推在线坐席；已在队列/接待中不重复推（不骚扰）；推送失败不反噬入队（入队仍完成）。 — `tests/cloud/agentPush.test.js`
- 超管在线也应收到入队推送（超管在坐席态与其账号档键位不同，须映射后才推得到）。 — `tests/cloud/agentPush.test.js`

## 十三、客户 360 聚合口径

- 客户 360 按客户聚合多面板（画像/订单/激活/学习/节点照片），经 provider 注册表、有界、只本人数据；他人数据不混入。 — `tests/cloud/customer360.test.js` 等
- 画像口径：总消费只计已付款订单、给出单数/已付数/进课率/最近活跃；金额累加精确不漂（分级累加，避免浮点误差）。 — `tests/cloud/customer360.test.js`
- 面板可用开关按配置关闭（关掉的板块不进聚合）；无数据客人面板结构齐全、空集不报错（错误隔离）；缺客户标识拒。 — `tests/cloud/customer360.test.js`
- 客户 360 读为强制审计（即便是查询类也留痕「查了谁」），普通查询类降噪不留痕、动作类照常留痕；检索/单客户画像同样留痕「搜了什么/查了谁」。 — `tests/cloud/customer360.test.js`
- 客户检索精确命中 openid/手机号/昵称/订单号并给出命中依据；缺查询词拒；无匹配空列表不报错。 — `tests/cloud/customer360.test.js`
- 单客户画像走白名单字段（兼容老随机主键档），不回原始档内部字段；无档空不报错。 — `tests/cloud/customer360.test.js`
- 学习位置与节点照片 provider 口径见 `learning-content.md` §四/§八（同源不复抄）。

## 覆盖清点

**读 24 文件**：全域 19（agentDesk 22 条 / kfDispatch 20 / conversations 16 / csat 11 / csAccess 10 / dataConsent 6 / wecomLogin 9 / recall 6 / kfBind 5 / customer360 18 / customer360-learning 4 / kfWecom 13 / kfCrypto 8 / kfSend 4 / kfHealthProbe 5 / agents 11 / agentPush 7 / agent/thread 6 / agent/deepLink 5）+ 边界切片 5（kb 4 条·admin CRUD 归内容域；checkpoints 3 条·拍照上传归学习域；adminRbac 5 条与 adminSession 3 条·通用机制归 kit 安全域；seedGates 1 条·播种闸归学习域）。
**收录约 212 条源断言 → 合并为 ~135 条黄金 bullet；剔除约 69 条**绑实现/绑外部 wire/可调阈值断言（类别：确定性主键字面、threadKey 格式、错误码串、企微 wire 字段与平台数字码、可调阈值数值、加解密算法细节、他域切片归属）——行为本质均已保留，未发明任何测试中不存在的断言。
