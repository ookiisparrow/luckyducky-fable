# 学习 / 激活 / 播放 / 内容域 · 黄金用例（行为断言基准）

> 提炼自旧线 tests/（2026-07-04·M0）。用法：新系统对应域重写时逐条转成新测试；每条为栈无关行为断言 + 旧线源文件；「剔除」= 绑旧实现已转写为行为本质。

## 一、激活：一码一用与并发抢占

- 未登录（无可信身份）扫码激活一律拒绝。 — `tests/cloud/activateCourse.test.js`
- 不存在的码拒绝（无效码）。 — `tests/cloud/activateCourse.test.js`
- 首次激活成功：这张码从此翻为「已激活」并记下激活者，同时为激活者建立一条该课程的激活记录（此时尚未确认进课）。 — `tests/cloud/activateCourse.test.js`
- 激活者本人重扫尚未确认的码：仍是「已激活」态，不重复建激活记录（幂等）。 — `tests/cloud/activateCourse.test.js`
- 激活者本人已确认进课后再扫：识别为「这是我的课」态。 — `tests/cloud/activateCourse.test.js`
- 别人扫一张已被占用的码：拒绝并提示「已被激活」，且必须带回该码对应的课程标识（好让「已被激活」屏能按课程显图）。 — `tests/cloud/activateCourse.test.js`
- 半步失败自愈：若码已翻「已激活」但激活记录缺失（激活函数中途挂掉），本人重扫应把缺失的激活记录补回，恢复到正常「已激活」态。 — `tests/cloud/activateCourse.test.js`
- 老数据兼容：历史激活记录用的是随机标识时，重扫应命中并复用旧记录、不重建（惰性迁移，不产生重复记录）。 — `tests/cloud/activateCourse.test.js`
- 一码一用的本质是抢占式：同一张「未用」码只能被一次激活翻成「已激活」，翻成功者赢，此后无出边（终态）。 — `packages/shared/src/learning.spec.ts`（learning 状态机声明单源）
- 激活码只能从「未用」流转到「已激活」，不允许越流转或写未声明状态。 — `packages/shared/src/learning.spec.ts`

**激活码解析（印刷物料三轨兼容，用户端入口）**
- 激活码解析容错三种来源都认：直连启动参数 `code=`（裸码去空白）、小程序码 scene（`code=XX` 与裸码两写法）、普通链接二维码网址（路径尾段式、`code=` 查询参数式都能提取出码）。 — `packages/miniapp/tests/activation.test.js`
- 无码 / 无法识别的网址 → 返回空串（走通用引导模式，不假装拿到码）。 — `packages/miniapp/tests/activation.test.js`

**激活解锁状态（用户端 store 行为）**
- 加载「我的课程」之前，一切课程默认判为「未解锁」（宁锁勿漏）；加载后按课程标识判定解锁与否，未拥有的课判未解锁。 — `packages/miniapp/tests/activation.test.js`
- 确认进课成功后本地立即同步为已解锁，无需强制刷新。 — `packages/miniapp/tests/activation.test.js`

**激活码生成（管理闸）**
- 生成激活码走管理通道：无登录身份（CLI/后台控制台）放行生成；客户端调用必须是管理员，非管理员一律拒绝且一个码都不生成。 — `tests/cloud/genQrcodes.test.js`
- 防废码：缺课程标识或指向不存在的课程一律拒绝生成。 — `tests/cloud/genQrcodes.test.js`
- 生成数量必须显式且合法：漏传 / 非数字 / 为 0 一律拒绝，不再静默按 1 处理，且一个码都不生成。 — `tests/cloud/genQrcodes.test.js`
- 生成数量有上限保护（超大请求被钳到上限），且每张码标识全局唯一。 — `tests/cloud/genQrcodes.test.js`（剔除：上限具体值 500 属可调阈值，保留「有上限」与「唯一」的行为本质）
- 同一课程同一时刻连生两批，两批标识必须互不相同（不能因时间精度不足撞成同一批而被后台错误合并）。 — `tests/cloud/genQrcodes.test.js`

## 二、进课确认与退货权失效节点

- 未登录拒绝；未激活该码则拒绝（不能凭空确认进课）。 — `tests/cloud/confirmEnter.test.js`
- 确认进课的时间点只写一次：二次确认保留首次的进课时间（幂等）。 — `tests/cloud/confirmEnter.test.js`
- 首次确认进课会失效退货权：把本人已付款订单里「最早一条、仍可退」的对应商品条目翻为不可退。 — `tests/cloud/confirmEnter.test.js`
- 退货权失效要覆盖已发货 / 已完成的订单（真实流程常是收货后才确认进课，不能只认已付款态）。 — `tests/cloud/confirmEnter.test.js`
- 重复确认不多扣退货权：退货权失效只在「首次进课」发生，二次确认不再翻掉第二笔订单条目（其余订单仍保持可退）。 — `tests/cloud/confirmEnter.test.js`
- 送礼场景：确认进课者名下没有相关订单时，正常确认、不失效任何退货权、不报错。 — `tests/cloud/confirmEnter.test.js`
- 数量级进课：买 N 件只进 1 件时，只记 1 件已进课、整行不作废，剩余件数仍可退；进满 N 件后整行才不可退。 — `tests/cloud/confirmEnter.test.js`
- 并发进课不少记件数：两次进课同时写入时，已进课件数必须两件都入账（不能因读-改-写互相覆盖只记 1 件，否则剩余可退件数虚高、会多退一件的钱）。 — `tests/cloud/confirmEnter.test.js`（剔除：版本位 CAS/前置条件属实现机制，保留「并发进课件数不少记、退货权账不虚高」的行为本质）

## 三、播放鉴权 fail-closed（目录不漏源）

**目录不泄露视频源**
- 公开课程目录里每个小段只暴露展示信息与「是否有视频」标记，绝不下发底层视频源标识；整份目录响应里不得出现任何云存储源地址。 — `tests/cloud/getPlaybackUrl.test.js`
- 试看已整条撤除：旧库文档残留的「免费段」标记不出现在公开目录里（陈旧字段不再暴露，也不构成免费入口）。 — `tests/cloud/getPlaybackUrl.test.js`
- 未剪好的段（无视频源）在目录里标记为「无视频」。 — `tests/cloud/getPlaybackUrl.test.js`

**播放地址鉴权（fail-closed）**
- 取播放地址一律要求本人「已确认进课」；未确认进课时任何段都拒绝（不予授权）。 — `tests/cloud/getPlaybackUrl.test.js`
- 旧库残留「免费段」标记不构成授权：未进课时连这种段也拒绝（陈旧字段不放行）。 — `tests/cloud/getPlaybackUrl.test.js`
- 只激活但未确认进课（进课时间为空）：仍拒绝取地址。 — `tests/cloud/getPlaybackUrl.test.js`
- 已确认进课：放行，下发一个短时临时地址（含原「免费段」也放行）。 — `tests/cloud/getPlaybackUrl.test.js`
- 已进课但该段尚未剪好（无视频源）：正常返回、地址为空（表示暂无可播内容，而非报错）。 — `tests/cloud/getPlaybackUrl.test.js`
- 未登录 / 参数缺失 / 段不存在，分别以对应错误拒绝。 — `tests/cloud/getPlaybackUrl.test.js`

## 四、进度折叠与「继续学习」定位

**埋点与进度折叠**
- 埋点未登录拒绝；缺事件类型拒绝；元数据过大拒绝。 — `tests/cloud/trackEvent.test.js`
- 普通事件只记流水，不折叠进学习进度。 — `tests/cloud/trackEvent.test.js`
- 「看完一段」事件会折叠进学习进度：每个用户每门课只维护一条进度，记录该段已完成的标记与「最后看到的位置」；同课后续段折叠进同一条、不新建。 — `tests/cloud/trackEvent.test.js`
- 并发的首个进度事件只产生一条进度记录（不能因并发建成两条）。 — `tests/cloud/trackEvent.test.js`（剔除：「确定性 _id」属实现手段，保留「并发首事件仅一条进度」的行为本质）
- 防刷：未激活/未进课该课的「看完一段」事件不折叠进进度（不污染进度），但事件流水仍照常记录（供分析）。 — `tests/cloud/trackEvent.test.js`

**进度形状（段粒度云进度 → 课时级展示）**
- 云进度未就绪时（mp 端云为唯一源、fail-closed）：不回退演示进度，进度为空、无「最后观看」，以免用错误的「已学完/观看中」误导继续学习。 — `packages/miniapp/tests/progress.test.js`
- 云端有数据但该课无记录：该课进度为空（新用户无进度是事实，不再回退样例）。 — `packages/miniapp/tests/progress.test.js`
- 一节的段全看完 → 该节判「已完成」；只看了部分段 → 按已看段占比给「观看进度」。 — `packages/miniapp/tests/progress.test.js`
- 「最后看到」停在某节但整段没看完时，段内进度要按段数折算成节级比例（段内 50% 不能当整节 50%，否则进度虚高）；没停留的其它节为空。 — `packages/miniapp/tests/progress.test.js`
- 已看完 n 段又停在第 n+1 段中途 → 节级进度 = (n + 段内比例)/总段数；若「最后看到」停在一个已看完的段，则不重复计入（防超过实际）。 — `packages/miniapp/tests/progress.test.js`
- 「最后观看」取最近更新那门课的观看点（喂「我」页继续学习卡）。 — `packages/miniapp/tests/progress.test.js`

**埋点出口**
- 无宿主环境（H5/测试）时埋点是安全空操作、不抛错。 — `packages/miniapp/tests/progress.test.js`
- 有宿主环境时埋点「发了就不管」上报，字段原样收口（类型/页面/目标/元数据）。 — `packages/miniapp/tests/progress.test.js`

**继续学习定位**
- 「继续学习」按观看记录自己的课程标识定位那门课与课时，绝不回退到默认课（否则会出现「进小程序显演示课」的错乱）。 — `packages/miniapp/tests/continueResolve.test.js`
- 无观看记录但有已解锁课 → 定位该课第一课时（开始学，而非演示）；多门已解锁 → 取最近解锁那门。 — `packages/miniapp/tests/continueResolve.test.js`
- 记录里的课时在该课已找不到 → 退回该课第一课时，不串到别的课/演示。 — `packages/miniapp/tests/continueResolve.test.js`
- 无记录且无解锁课 / 课程查不到 → 返回空（卡片走兜底，不假装有课）。 — `packages/miniapp/tests/continueResolve.test.js`

**360 工作站里的学习位置**
- 客户学习位置由进度记录 join 课程结构人话化：显示课/章/节/段名、已完成段数、总段数、完成百分比，且只看本人。 — `tests/cloud/customer360-learning.test.js`
- 无进度的客户 → 空位置、不报错（错误隔离）。 — `tests/cloud/customer360-learning.test.js`
- 进度指向已删课 → 课程标题回退为课程标识、定位不到的层级为空、总段数 0、完成度 0（不崩、不除零）。 — `tests/cloud/customer360-learning.test.js`
- 客户课程进度条数极多时按上界截断并标记「已截断」（不裸取默认条数）。 — `tests/cloud/customer360-learning.test.js`（剔除：具体阈值属调参，保留「有界 + 截断标记」的行为本质）

## 五、我的课程 / 课程数据契约

**进课唯一闸 + 同课去重**
- 未登录拒绝（fail-closed）。 — `tests/cloud/getMyCourses.test.js`
- 只返回「已确认进课」的课；同一门课有多码时取最早的进课时间；未确认的课与他人的课都不返回。 — `tests/cloud/getMyCourses.test.js`

**我的课程列表解析**
- 「我的课程」= 用户已激活课程去重后取课程对象、保序；同一门课多张激活码只出现一次。 — `packages/miniapp/tests/myCourses.test.js`
- 课程查不到 / 空课程标识 → 跳过；空或非数组输入 → 空列表。 — `packages/miniapp/tests/myCourses.test.js`

**多课程聚焦**
- 加载前 getters 是安全空形状（页面不用判空）。 — `packages/miniapp/tests/courses-store.test.js`
- 未指定当前课 → 回退第一门；指定某课 → 当前课就是那门课（激活小熊就看小熊，不再恒显列表第一门）。 — `packages/miniapp/tests/courses-store.test.js`
- 当前课指向不存在的课 / 被清空 → 回退第一门（防脏标识白屏）。 — `packages/miniapp/tests/courses-store.test.js`
- 课程列表透传云端返回；加载后当前课与全部课时（含所属章归属）与课程表一致。 — `packages/miniapp/tests/courses-store.test.js`

**课程三层数据契约**
- 课程是多课数组，每门课有标识/标题/章；三层完整：章 → 课时 → 段，段字段齐全（标识、名、时长可解析为正数、视频源字段必须存在即便占位为空）。 — `packages/miniapp/tests/course.test.js`
- 段字段里不得再有「免费段」标记（试看已整条撤除）。 — `packages/miniapp/tests/course.test.js`
- 每节各段时长之和等于该节总时长（等分 + 余数并入最后一段）。 — `packages/miniapp/tests/course.test.js`
- 课时标识与段标识各自全局唯一。 — `packages/miniapp/tests/course.test.js`
- 进度是用户态：课程内容本身不携带「已完成/已看」等进度字段；样例进度引用的课时标识必须真实存在。 — `packages/miniapp/tests/course.test.js`

## 六、播放器纯逻辑（段间转场 / 拖拽 / 分段导航）

**播放地址解析器（缓存 + 预取 + 去重 + 失效）**
- 有效期内第二次取同一（课,段）地址命中缓存、不重复取址；过期后重新取址。 — `packages/miniapp/tests/playbackCache.test.js`
- 空段标识 → 返回空串、不取址。 — `packages/miniapp/tests/playbackCache.test.js`
- 取址返回空（素材未剪/未授权）不缓存，下次仍重试（不把「空」缓存成结果）。 — `packages/miniapp/tests/playbackCache.test.js`
- 跨课隔离：两门课的同名段各缓存各的地址、互不串味（缓存键必须含课程标识）。 — `packages/miniapp/tests/playbackCache.test.js`
- 并发取同一（课,段）地址只真正取一次（在途去重）。 — `packages/miniapp/tests/playbackCache.test.js`
- 预取能预热缓存，随后取用命中、全程只取一次址；已有新鲜缓存时预取是空操作；空段预取不取址、不崩。 — `packages/miniapp/tests/playbackCache.test.js`
- 主动失效某（课,段）后再取会真重新取址（拿到新地址），且只清本（课,段）、不误伤别课同段。 — `packages/miniapp/tests/playbackCache.test.js`

**进度条拖拽定位（钳位）**
- 触点位置映射为目标时间：条中点→时长一半、条起点→0、条终点→时长；越过左/右边界钳到 0/时长。 — `packages/miniapp/tests/scrub.test.js`
- 无进度条几何 / 时长非正 / 触点非数 → 返回空（不乱 seek）。 — `packages/miniapp/tests/scrub.test.js`

**分段导航（上一段/下一段，连续跨课时）**
- 本课时内向前/向后切段；到本课时末段的下一段自动接下一课时第一段、到首段的上一段自动接上一课时末段（连续跨课时）。 — `packages/miniapp/tests/segNav.test.js`
- 全课末段的下一段 / 全课首段的上一段 → 空（按钮置灰，无处可去）。 — `packages/miniapp/tests/segNav.test.js`
- 空/异常输入 / 步长为 0 → 空（不崩）。 — `packages/miniapp/tests/segNav.test.js`
- 导航跳过无段课时；也跳过「无视频/部分无视频」课时（半上线未传视频的课时不能把控件困死）；全为不可播课时时 → 无处可去。 — `packages/miniapp/tests/segNav.test.js`

## 七、评价规则（提交闸门 + 汇总口径 + 列表分页）

**提交评价闸门**
- 未登录拒绝；评分越界（>5 或 <1）拒绝。 — `tests/cloud/submitReview.test.js`
- 他人订单不可评（订单归属校验）。 — `tests/cloud/submitReview.test.js`
- 订单未完成不可评；商品不在该订单条目内不可评。 — `tests/cloud/submitReview.test.js`
- 成功提交：昵称取云端用户快照落库，评价含商品/规格等快照信息。 — `tests/cloud/submitReview.test.js`
- 一单一品一评：重复提交同一订单同一商品被拒（唯一约束），不产生重复评价。 — `tests/cloud/submitReview.test.js`
- 匿名提交：昵称存为「匿名钩友」。 — `tests/cloud/submitReview.test.js`
- 同一商品多规格（多 SKU）按订单行各自可评，不再互相撞成「已评价」。 — `tests/cloud/submitReview.test.js`

**评价汇总（云端现算）**
- 缺商品标识拒绝。 — `tests/cloud/getReviews.test.js`
- 空集合：条数 0、评分 0、星级分布全 0。 — `tests/cloud/getReviews.test.js`
- 均分保留 1 位小数；星级按百分比分布；1 星并入 2 星档；标签取 Top5；只统计本商品、不计他品。 — `tests/cloud/getReviews.test.js`
- 汇总必须基于全量评价精确计算：即使评价数超过任何采样上限，条数/评分/星级分布仍精确，不标近似。 — `tests/cloud/getReviewsSummaryExact.test.js`（剔除：采样上限/聚合范式属实现，保留「全量精确、永不近似」的行为本质）
- 空商品：条数 0、评分 0、不标近似。 — `tests/cloud/getReviewsSummaryExact.test.js`

**评价列表分页（cursor）**
- 缺商品标识拒绝。 — `tests/cloud/getReviewsPaged.test.js`
- 首页按时间倒序截断返回 + 给出下一页游标 + 标注还有更多；汇总基于全样本（不是当页那几条）。 — `tests/cloud/getReviewsPaged.test.js`（剔除：游标具体键属实现，保留「游标续页可接上」的行为本质）
- 续页带游标接上，不重复返回汇总（前端缓存首页汇总）；到底时无更多、无下一页游标。 — `tests/cloud/getReviewsPaged.test.js`
- 只取本商品评价，不串其它商品。 — `tests/cloud/getReviewsPaged.test.js`

**评价读取（用户端·无云回退，样例零回归）**
- 无云环境时读评价/提交评价均返回空（页面走演示/兜底，不报错）。 — `packages/miniapp/tests/reviews.test.js`
- 加载后拿不到真实评价时仍为空：不会用空数据顶掉样例。 — `packages/miniapp/tests/reviews.test.js`
- 只有「有真实条数」的数据才算有效评价，条数为 0 视同无数据。 — `packages/miniapp/tests/reviews.test.js`

## 八、内容安全 fail-closed（UGC 节点照片）

**图片内容安全接缝（fail-closed）**
- 图安全 → 放行；内容违规 → 拒（判违规）；其它异常（能力未开/网络等非违规错误）→ 一律拒（fail-closed，非违规码也不放行）；空文件 → 不放行。 — `tests/cloud/checkpoints.test.js`

**打卡拍照上传**
- 无可信身份拒绝（fail-closed）。 — `tests/cloud/checkpoints.test.js`
- 缺课程/节点/文件参数拒绝，且不落库。 — `tests/cloud/checkpoints.test.js`
- 未确认进课不能上传（与埋点同闸，防未购造数），不落库。 — `tests/cloud/checkpoints.test.js`
- 已进课且内容安全通过 → 落库为本人的提交，作者身份以云端本人为准、不信前端。 — `tests/cloud/checkpoints.test.js`
- 内容违规 → 拒且一条都不入库（fail-closed）。 — `tests/cloud/checkpoints.test.js`
- 内容安全校验不了（能力未开/网络）→ 拒且不入库（证明安全才放行）。 — `tests/cloud/checkpoints.test.js`
- 幂等：同一节点重传覆盖为最新、不重复建档。 — `tests/cloud/checkpoints.test.js`（剔除：确定性 _id 具体格式属实现，保留「同节点覆盖式、每人每课每节点一条」的行为本质）

**后台策展与节点照片展示**
- 后台保存打卡节点定义按顺序列出（升序）；缺课程标识拒绝。 — `tests/cloud/checkpoints.test.js`
- 整课覆盖式保存：删掉本课不在新列表里的旧定义，但绝不动用户已上传的提交。 — `tests/cloud/checkpoints.test.js`
- 客户 360 里只返回本人各节点照片，并 join 节点定义取标题；无提交的客户 → 空、不报错；节点无定义时标题回退为节点标识（不崩）。 — `tests/cloud/checkpoints.test.js`

## 九、辅助视频 / 首页内容（公开读 + 兜底）

**辅助视频（公开读）**
- 无记录 → 返回空列表。 — `tests/cloud/getHelpVideos.test.js`
- 有记录按两级（主题→小段）返回：主题层原样下发文案、不含底层视频源；小段层换成短时临时地址下发、不含视频源字段；某小段无视频 → 地址为空。 — `tests/cloud/getHelpVideos.test.js`
- 大量视频也能全部换到正确临时地址、映射不串位、能在规模下工作。 — `tests/cloud/getHelpVideos.test.js`（剔除：分批 ≤50/次属实现细节，保留「全量换到、映射不串位」的行为本质）

**首页内容（公开读）**
- 无首页内容记录 → 返回首页为空（前端回退默认文案）。 — `tests/cloud/getContent.test.js`
- 有记录 → 返回该首页文档。 — `tests/cloud/getContent.test.js`

**首页内容（用户端·云端编辑 + 本地默认兜底）**
- 无云环境（H5/测试）时 hero/信任条/FAQ 全回退本地默认。 — `packages/miniapp/tests/content.test.js`
- 云端有内容按块覆盖；空块（空字段/空数组）仍用默认，防误清空线上。 — `packages/miniapp/tests/content.test.js`

**激活欢迎图按「课程×状态」取图**
- 「正在激活」的背景图是全局的；欢迎/欢迎回来/已被激活三态背景按课程取图。 — `packages/miniapp/tests/content.test.js`
- 该课该态配了就用它；该态未配 / 该课未配 / 无课程标识 → 回退全局背景图。 — `packages/miniapp/tests/content.test.js`
- 全都没配 → 返回空串（页面再回退到内置静态图）。 — `packages/miniapp/tests/content.test.js`
- 兼容旧结构：某课的值是字符串时当作「欢迎图」那张，旧结构没有其它态。 — `packages/miniapp/tests/content.test.js`
- 不传状态时默认取「欢迎」态（兼容旧调用）。 — `packages/miniapp/tests/content.test.js`

## 十、隐私授权闸（状态逻辑）

- 触发授权：打开弹窗、记住放行回调，但先不放行。 — `packages/miniapp/tests/privacyGate.test.js`
- 同意：关弹窗并以「同意」放行（带按钮标识）；不同意：关弹窗并以「拒绝」中止。 — `packages/miniapp/tests/privacyGate.test.js`
- 放行回调只回调一次：同意后重复点击不再放行。 — `packages/miniapp/tests/privacyGate.test.js`
- 注册后挂上系统的隐私授权触发钩子，系统触发即开弹窗；无宿主环境时注册安全空转、不抛错。 — `packages/miniapp/tests/privacyGate.test.js`

## 十一、分享（分享卡构造）

- 完整商品：标题取商品名、路径带商品标识、http 图直接透传。 — `packages/miniapp/tests/share.test.js`
- 云存储封面：分享图留空（用页面截图兜底，避免传无效地址）。 — `packages/miniapp/tests/share.test.js`
- 缺商品名 / 名为空白 → 回退默认标题。 — `packages/miniapp/tests/share.test.js`
- 商品标识编码进路径（含特殊字符不破坏链接）。 — `packages/miniapp/tests/share.test.js`
- 空入参：不抛错，给安全兜底（默认标题、空标识路径、空图）。 — `packages/miniapp/tests/share.test.js`

## 十二、seed / init 管理闸（防覆盖生产数据）

- 种商品/种课程/初始化数据库：无登录身份（CLI/控制台）放行，客户端非管理员一律拒绝且不写库，管理员放行。 — `tests/cloud/seedGates.test.js`
- 防任意登录用户覆盖生产商品/课程数据（审计修复 A-1 的回归锁）。 — `tests/cloud/seedGates.test.js`
- 初始化数据库建的集合清单必须与「集合单一源」全量对齐，新增集合无需改初始化函数（防老清单漂移导致新集合「动态建、控制台锁不了」的窗口）。 — `tests/cloud/seedGates.test.js`（剔除：点名具体集合属回归锁样本，保留「清单＝单源全量、加集合不用改」的行为本质）

## 覆盖清点（不静默丢弃）

**收录 29 个文件**：tests/cloud/ 15 个（activateCourse / confirmEnter / getPlaybackUrl / getMyCourses / trackEvent / getHelpVideos / getContent / seedGates / getReviews / getReviewsPaged / getReviewsSummaryExact / submitReview / checkpoints / customer360-learning / genQrcodes）+ packages/miniapp/tests/ 13 个（activation / content / continueResolve / course / courses-store / myCourses / playbackCache / progress / scrub / segNav / privacyGate / share / reviews）+ shared 声明单源 1 个（learning.spec.ts）。
**判归他域 2 个**：`tests/cloud/getProducts.test.js`（商品目录→钱链/订单域）、`packages/miniapp/tests/persist.test.js`（购物车持久化→订单/前端杂项域）。
**已知旧线缺口（如实记录，不虚构断言）**：`getMyProgress` 云函数无独立云测试，行为仅经 miniapp progress store 测试间接覆盖——新线补齐。
**统计**：读 31 文件 → 收录 29、判归他域 2；行为断言约 100 条；6 类绑实现断言已转写为行为本质（版本位 CAS、确定性 _id、limit 阈值、分批上限、游标键、集合点名）。
