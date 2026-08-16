# 流程闭环审计与修复记录

> 审计日期：2026-08-15
> 审计范围：全项目业务流程（客户/合同 → 计划 → 调度 → 磅单 → 异常 → 结算 → 发票）
> 状态图例：✅ 已修复 ｜ 🔧 修复中 ｜ ⏳ 待修复
>
> **当前进度（2026-08-16）：P0 5/5、P1 5/5、P2 7/7、P3 10/10 全部修复；全链路"登录鉴权→合同全生命周期→派车（分方式）→司机端执行→轨迹回放/电子围栏→仓储联动→异常/事故→结算→收款→逾期/信用→报表中心"端到端可跑通，数据 localStorage 持久化（见第五节验证记录）。**

## 一、总体结论

主链路设计合理（合同 → 计划 → 调度 → 磅单 → 结算 → 发票），页面覆盖完整，但闭环仅完成一半：

- **前半程**（合同审批 → 计划拆批 → 调度派车）可操作；
- **执行环**（装货 → 在途 → 卸货）状态机断裂，新产生的调度单永远无法走到"已完成"；
- **后半程**（结算 → 发票）数据为预生成随机值，与调度/磅单执行数据完全脱钩。

## 二、问题清单与修复进度

### P0 主链路闭环（状态机 / 回卷 / 资源）

| # | 问题 | 位置 | 状态 | 说明 |
|---|------|------|------|------|
| P0-1 | 调度单状态机断裂：`loading→intransit`、`intransit→unloading` 无操作入口，新调度单无法完成 | dispatch/list.vue、dispatch/detail.vue、track/index.vue | ✅ 已修复（08-15） | 调度列表/详情页新增"发车""到达"动作；状态机统一收敛到 `src/mock/flow.js`（confirmLoad/depart/arrive/confirmUnload） |
| P0-2 | 异常关闭后调度单永久停在 `exception`，无恢复路径 | exception/list.vue | ✅ 已修复（08-15） | 异常抽屉新增"恢复运输"按钮；关闭归档时若关联调度单仍处异常，弹窗询问恢复（已装货→intransit，未装货→loading） |
| P0-3 | 计划/合同状态与进度不回卷：调度完成后计划仍"已调度"、合同进度为静态随机值、合同无路径进入"已完成" | plan/list.vue、mock/contract.js | ✅ 已修复（08-15） | flow.js 事件驱动回卷：调度完成→计划进度/状态→合同执行进度；合同量达成自动 completed；启动时 recalcAll 全量校准 |
| P0-4 | 车辆/司机状态与执行不同步：派车不占用、完成不释放 | plan/list.vue、dispatch/list.vue | ✅ 已修复（08-15） | flow.js occupyResource/releaseResource：发车/恢复时占用（inuse/onduty），完成且无其他执行中任务时释放（idle/available） |
| P0-5 | 预置数据量级脱节：合同 5000-50000 吨 vs 单车 30-40 吨，进度口径失真 | mock/contract.js、mock/plan.js、mock/dispatch.js | ✅ 已修复（08-15） | 合同/计划量级调整为车次口径（每批 3-8 车）；调度单按车次拆分且状态与计划一致；合同计划量按拆批总量回填，进度=实际完成运量/合同量 |

### P1 结算闭环

| # | 问题 | 位置 | 状态 | 说明 |
|---|------|------|------|------|
| P1-1 | 结算单与执行数据脱钩：车次/运量为随机数，与调度、磅单无关 | mock/settlement.js | ✅ 已修复（08-15） | 结算单改为按合同实际完成车次汇总（车次/运量/运费均取自调度数据），与磅单口径一致 |
| P1-2 | 无"生成结算单"入口（操作日志有此动作但界面无） | settlement/list.vue | ✅ 已修复（08-15） | 列表页新增"生成结算单"：按「合同+月份(卸货时间)」聚合已完成且未入账单车次，弹窗勾选生成；车次以 settled/settlementId 标记防重复结算 |
| P1-3 | "对账"仅为状态翻转，未实际比对调度/磅单数据 | settlement/list.vue、settlement/detail.vue | ✅ 已修复（08-15） | flow.buildReconciliation 三方比对（调度量 vs 进/出磅净重 vs 结算量，容差 0.5t）；详情页新增"对账明细"面板逐车次展示差异；确认结算时差异车次弹窗提示；预置非待对账账单已预生成比对结果 |
| P1-4 | 磅单损耗（1-3%）与异常损失不进入结算 | mock/settlement.js、flow.js | ✅ 已修复（08-15） | 结算量改按出磅净重（磅单结算）；`calcSettlementFees` 统一计算运费/杂费/损耗扣减/异常损失扣减，费用明细与对账明细均体现损耗与异常损失 |
| P1-5 | 无收款记录：结算即全额"已付"，无部分收款/回款核销；客户信用额度字段未使用 | settlement/detail.vue、mock/customer.js、contract.js | ✅ 已修复（08-15） | 新增收款流水 `db.payments` 与"登记收款"（部分/付清、超收截断）；合同增加账期 `paymentDays`，超账期未付清自动转逾期、付清回已结算；`creditCheck` 在派车与提交合同时校验客户授信额度，客户详情展示未付余额与授信占用 |

### P2 模块互联

| # | 问题 | 位置 | 状态 | 说明 |
|---|------|------|------|------|
| P2-1 | 仓储库存孤岛：装/卸货不增减库存 | mock/warehouse.js、mock/terminal.js | ✅ 已修复（08-15） | 场站增加 warehouseId 关联（5 个场站配仓库）；确认装货→装货场站出库（扣最早批次+占用），确认卸货→卸货场站入库（按出磅净重生新批次+占用），写审计日志 |
| P2-2 | 安全模块与异常脱钩：事故类异常不生成事故记录，事故结案不更新车辆状态 | mock/safety.js、exception/list.vue | ✅ 已修复（08-15） | 事故类异常上报同步生成事故记录（关联 exceptionId）；处置完成同步事故处理/损失；关闭异常→事故结案，空闲车辆转检修 |
| P2-3 | 操作日志为静态数据，用户操作不写日志 | mock/system.js、flow.js | ✅ 已修复（08-15） | flow.js 新增 logAction/setOperator 审计中枢，登录/派车/装货/发车/到达/卸货/异常/结算/收款/审批/开票/磅单补录等动作实时写日志（操作人+详情）；日志页新增"详情"列 |
| P2-4 | 登录无真实鉴权（任意账号密码可进），角色权限无菜单/按钮级控制 | login/index.vue、mock/system.js | ✅ 已修复（08-15；08-16 补修路径回归） | 登录按 用户名+密码(123456)+账号状态 真实校验，失败写日志；新增 src/permission.js（ROLE_MENUS/ROLE_ACTIONS），侧边栏按角色过滤菜单、路由守卫拦截无权限路径、关键操作按钮级控制（结算/派车/异常/审批/磅单等）。**08-16 补修**：ROLE_MENUS 原用 `/transport/contract` 等错误路径与实际路由 `/contract` 不符，导致非管理员角色菜单全被过滤、所有页面被守卫打回工作台，已改为真实路由路径（/workbench、/driver-app 对全部登录角色豁免） |
| P2-5 | 无通知中心：待办/异常/逾期/到站无消息推送 | workbench.vue | ✅ 已修复（08-15） | 顶栏铃铛通知扩展为：未关闭异常、待审批合同、逾期结算、3 小时内到站车辆、待装货调度单待办，点击跳转对应页面 |
| P2-6 | 合同审批只有"通过"无"驳回"，无审批意见/多级审批 | contract/list.vue | ✅ 已修复（08-15） | 审批改为弹窗（审批意见必填于驳回）：通过→执行中、驳回→回草稿，均记录审批人/时间/意见并写日志；多级审批留待 P3 |
| P2-7 | 磅单只能由调度确认动作产生，场站操作员无独立录单/修正入口；交互生成皮重固定 13t 与预置 10-16t 不一致 | terminal/weighing.vue、dispatch/list.vue | ✅ 已修复（08-15） | 磅单记录页新增"磅单补录"（选调度单+类型+净重，皮重按车辆档案自动带出，重复补录拦截）；皮重改为按车辆 id 确定性派生 10-16t，与预置口径一致 |

### P3 产品完整度

| # | 问题 | 位置 | 状态 | 说明 |
|---|------|------|------|------|
| P3-1 | 无数据持久化，刷新即重置 | 全项目 | ✅ 已修复（08-16） | 新增 `src/mock/persist.js`：localStorage 快照（版本号防脏数据），启动 hydrateDb 恢复、深度监听防抖 800ms 自动保存、resetDb 重置（Navbar"重置演示数据"入口）；Node 环境自动降级 |
| P3-2 | 新建计划不校验合同剩余量，批次可超合同总量 | plan/create.vue | ✅ 已修复（08-16） | flow.contractRemaining（合同总量-未取消计划量）；合同信息条实时展示剩余量，表单校验器+切换合同回落+提交兜底三重拦截 |
| P3-3 | 调度车次固定 35 吨、距离固定 300km，不按线路/批次计算 | plan/list.vue、plan/detail.vue | ✅ 已修复（08-15） | createDispatches 按批次均摊数量、取 ROUTES 实际线路距离；调度弹窗默认车次按 35 吨/车估算 |
| P3-4 | 铁路/水运/管道合同只能派公路车，多式联运名不副实 | plan/list.vue、dispatch/*、weighing.vue | ✅ 已修复（08-16） | flow.isRoadMode/unitNoOf：公路/多式联运派车辆+司机+磅单，铁路/水运/管道按运输单元（车号/船名/管段）执行、不占资源、无公路磅单（结算按调度量）；派车弹窗/调度列表/详情/磅单补录/合同详情全部按方式分支展示 |
| P3-5 | 无司机端（接单/扫码确认/电子签收），确认动作全在调度员 PC | — | ✅ 已修复（08-16） | 新增司机端 H5 演示页 `/driver-app`（手机框）：模拟司机登录→接单→确认装货→发车→到达→电子签收（QS- 签收码），与 PC 端共用 flow 状态机；调度详情页"司机端视图"入口（携带司机+聚焦单号）、详情展示电子签收单 |
| P3-6 | 登录页宣传"GPS 轨迹 + 电子围栏"未实现，仅示意地图 | login/index.vue、track/index.vue | ✅ 已修复（08-16） | 在途监控页：按单号确定性派生 21 点轨迹（与实时点位同口径），回放控制（播放/暂停/1x-4x/进度拖拽）+ 已走过轨迹线；卸货场电子围栏圈（进入高亮）、轨迹偏离线路预警（>15m）、超时预警（ETA 已过） |
| P3-7 | 合同无变更/延期/提前终止结算/归档流程 | contract/* | ✅ 已修复（08-16） | flow.changeContract/extendContract/terminateContract/archiveContract：变更（数量/单价/截止日，金额重算）、延期、提前终止（取消待执行计划+可选已完成车次提前结算单）、归档；列表/详情双入口弹窗操作，变更记录页签+审计日志 |
| P3-8 | 无报表中心（仅 CSV 导出）；看板 KPI 部分随机（准时率）、车辆利用率口径不合理 | monitor.vue、mock/dashboard.js | ✅ 已修复（08-16） | 新增报表中心 `/report`（月度运营/客户经营含授信占用/商品运量含损耗率/场站吞吐，支持 CSV 导出）；KPI 口径修正：准时率=已完成车次实际运输时长≤理论时长(50km/h×120%+1h缓冲) 的比例、利用率=运输中车辆/非报废车辆；db 派生指标改 getter 实时汇总 |
| P3-9 | 发票号用 Math.random，与全局种子随机体系不一致 | settlement/invoice.vue | ✅ 已修复（08-16） | flow.genInvoiceNo 按 结算单ID-发票ID 确定性派生 16 位发票号（2410 开头，与种子口径一致），刷新/重开结果一致 |
| P3-10 | 公告/天气等为硬编码静态内容 | workbench.vue、mock/dashboard.js | ✅ 已修复（08-16） | 公告移入 `db.announcements`（数据源化，随持久化保存）；天气按日期确定性派生（weatherOf：天气/温度/出行提示），工作台实时读取 |

## 三、验收路径（端到端演示脚本）

补全后按以下路径验收，任何一步卡住即为断点：

```
新建合同 → 提交审批 → 审批通过 → 拆批计划 → 调度派车
→ 确认装货(进磅) → 发车 → 在途推进 → 到达(开始卸货)
→ 确认卸货(出磅) → 生成结算单 → 对账 → 结算收款 → 开票
```

反向验证异常闭环：

```
上报异常 → 受理指派 → 处置完成 → 关闭归档 → 调度单恢复运输 → 损失进入结算
```

## 四、修改文件清单

### 第一轮（P0 主链路闭环）

| 文件 | 变更 |
|------|------|
| `src/mock/flow.js` | 新增：业务流转中枢（状态机 confirmLoad/depart/arrive/confirmUnload/reportException/resumeDispatch、计划/合同回卷、车辆司机占用释放、createDispatches、启动全量校准 recalcAll） |
| `src/mock/contract.js` | 合同计划量调整为车次口径（8-30 车 × 35 吨） |
| `src/mock/plan.js` | 计划批次量调整为 3-8 车；执行窗口放宽至 7 天；按拆批总量回填合同计划量与金额 |
| `src/mock/dispatch.js` | 重写为按计划车次拆分生成（每车 30-40 吨），车次状态与计划状态一致；兜底保证在途 ≥15、异常 ≥7 |
| `src/mock/settlement.js` | 结算单改为按合同实际完成车次汇总（车次/运量/费用取自调度数据） |
| `src/mock/index.js` | 导入 flow 模块（导入时执行全量校准） |
| `src/views/dispatch/list.vue` | 新增"发车/到达/恢复"操作；动作逻辑改为调用 flow 中枢 |
| `src/views/dispatch/detail.vue` | 头部新增"发车/到达/恢复运输"按钮；动作逻辑改为调用 flow 中枢 |
| `src/views/exception/list.vue` | 抽屉新增"恢复运输"按钮；关闭归档时联动询问恢复关联调度单 |
| `src/views/plan/list.vue` | 调度弹窗默认车次按批次量估算、显示每车均摊量；生成逻辑改为 flow.createDispatches |
| `src/views/plan/detail.vue` | "立即调度"改为 flow.createDispatches |
| `scripts/verify-flow.mjs` 等 | 新增：流程闭环冒烟测试（17 项断言，`node --import ./scripts/register.mjs scripts/verify-flow.mjs`） |

### 第二轮（P1-2 生成结算单 / P1-3 对账三方比对）

| 文件 | 变更 |
|------|------|
| `src/mock/flow.js` | 新增结算流转：`settlementCandidates`（按合同+月份聚合未入账完成车次）、`generateSettlements`（生成账单并标记 settled/settlementId）、`buildReconciliation`（调度量 vs 磅单净重 vs 结算量三方比对，容差 0.5t）、`startReconcile`、`confirmSettle` |
| `src/mock/settlement.js` | 种子账单车次标记 settled/settlementId 防重复结算；新增 reconciliation 字段；非待对账账单预生成对账比对结果 |
| `src/views/settlement/list.vue` | 页头新增"生成结算单"按钮 + 候选勾选弹窗；"对账/结算"动作改为调用 flow 中枢，结算确认时展示磅单差异提示 |
| `src/views/settlement/detail.vue` | 新增"对账明细"面板（逐车次三方比对表：调度量/进磅/出磅/结算量/差异/结果）；"发起对账/确认结算"改为调用 flow 中枢 |
| `scripts/verify-flow.mjs` | 新增第 4 节结算闭环断言（12 项），总数 17 → 29 |

### 第三轮（P1-4 磅单结算/损耗扣减、P1-5 收款流水/信用校验）

| 文件 | 变更 |
|------|------|
| `src/mock/base.js` | db 新增 `payments`（收款流水） |
| `src/mock/contract.js` | 合同新增账期 `paymentDays`（30/45/60，确定性派生不消耗全局 rng） |
| `src/mock/flow.js` | 新增 `settleQtyOf`（按出磅净重结算）、`calcSettlementFees`（运费/杂费/损耗扣减/异常损失扣减统一计算）、`recordPayment`（收款流水，超收截断）、`recalcSettlementStatus`（超账期未付清→逾期，付清→已结算）、`outstandingOf`/`creditCheck`（授信校验）；`confirmSettle` 改为进入收款（不再直接全额已付）；`buildReconciliation` 增加损耗列与损耗汇总；`generateSettlements`/种子改用 `calcSettlementFees`；`recalcAll` 增加账单逾期校准 |
| `src/mock/settlement.js` | 种子重构：按磅结算（出磅净重）+ 损耗/异常损失扣减；状态规则化（超账期未付清→逾期）；生成收款流水（已结算=预付+尾款，对账中=预付） |
| `src/mock/index.js` | 导入顺序调整：exception 先于 settlement（异常损失扣减依赖异常单） |
| `src/views/settlement/detail.vue` | 费用明细增加"损耗扣减/异常损失"行；对账明细增加"损耗"列与损耗汇总；新增"收款记录"面板 + "登记收款"弹窗；头部/流程展示账期与已付进度；结算确认提示损耗扣减与账期 |
| `src/views/settlement/list.vue` | 结算确认文案同步（损耗扣减/不一致提示） |
| `src/views/plan/list.vue`、`src/views/plan/detail.vue` | 派车前 `creditCheck` 授信校验，超限拦截 |
| `src/views/contract/create.vue` | 新增"结算账期"字段；提交审批时 `creditCheck` 授信校验 |
| `src/views/customer/detail.vue` | 业务概览新增未付余额、授信占用进度条 |
| `scripts/verify-flow.mjs` | 断言更新为按磅结算口径；新增第 5 节收款/逾期/信用断言（8 项）与 4 项一致性断言，总数 29 → 39 |

### 第四轮（P2 模块互联）

| 文件 | 变更 |
|------|------|
| `src/mock/flow.js` | 新增审计中枢 `logAction`/`setOperator`；仓储联动 `warehouseOut`/`warehouseIn`（确认装/卸货调用）；异常处置 `acceptException`/`finishException`/`closeException`（事故联动+车辆状态）；合同审批 `approveContract`/`rejectContract`；开票 `issueInvoice`；磅单补录 `manualWeighing`；皮重 `tareOf`（按车辆派生 10-16t）；全部流转动作写审计日志 |
| `src/mock/terminal.js` | 场站新增 `warehouseId` 关联（T001/T002/T006/T007/T012 → 对应仓库） |
| `src/mock/system.js` | 用户新增 `password`（演示统一 123456） |
| `src/permission.js` | 新增：RBAC 权限表（ROLE_MENUS 菜单级 / ROLE_ACTIONS 按钮级）+ `usePerm` |
| `src/store/index.js` | 登录态保存完整用户信息（含角色），刷新后按用户名从用户表恢复 |
| `src/views/login/index.vue` | 真实登录校验（用户名+密码+账号状态），失败写日志，成功写操作人 |
| `src/router/index.js` | 路由守卫增加菜单级权限拦截（无权限回工作台） |
| `src/layout/components/Sidebar/index.vue` | 侧边栏按角色过滤菜单 |
| `src/layout/components/Navbar.vue` | 通知扩展：到站提醒（3h 内）+ 待装货待办 |
| `src/views/contract/list.vue` | 审批改弹窗（通过/驳回+审批意见），驳回回草稿；按钮级权限 |
| `src/views/exception/list.vue` | 受理/处置/关闭改调 flow 函数（事故联动+日志）；按钮级权限 |
| `src/views/terminal/weighing.vue` | 新增"磅单补录"弹窗（皮重自动带出、重复拦截） |
| `src/views/system/log.vue` | 日志表新增"详情"列 |
| `src/views/settlement/*`、`dispatch/*`、`plan/*` | 关键操作按钮接入 `usePerm` 按钮级权限；开票改调 flow.issueInvoice |
| `scripts/verify-flow.mjs` | 新增第 6 节 P2 断言（13 项：审计日志/仓储联动/事故联动/审批驳回/磅单补录/皮重口径），总数 39 → 52 |

### 第五轮（P3 产品完整度）

| 文件 | 变更 |
|------|------|
| `src/mock/flow.js` | 多式联运口径：`ROAD_MODES`/`isRoadMode`/`unitNoOf`（运输单元号确定性派生）；`createDispatches` 分方式派车（非公路无车辆/司机/磅单）；`confirmLoad`/`confirmUnload`/`manualWeighing` 按方式分支；司机端 `acceptDispatch`/`signReceipt`（QS- 签收码）；合同生命周期 `changeContract`/`extendContract`/`terminateContract`（取消待执行计划+可选提前结算单）/`archiveContract`（均记录变更历史+审计日志）；`contractRemaining`（剩余可计划量）；`genInvoiceNo`（发票号确定性派生）；`recalcAll` 启动时校准预置非公路车次 |
| `src/mock/persist.js` | 新增：localStorage 持久化（版本化快照 hydrateDb/saveDb/enableAutoSave 防抖 800ms/resetDb） |
| `src/mock/report.js` | 新增：月度运营/客户经营（授信占用）/商品运量（磅单损耗率）/场站吞吐 4 类报表口径化汇总 |
| `src/mock/dashboard.js` | KPI 口径修正（准时率按实际运输时长 vs 理论时长、利用率=运输中/非报废车辆）；db 派生指标改 getter 实时汇总；公告导出移除；新增 `weatherOf`（按日期确定性派生天气） |
| `src/mock/system.js` | 公告移入 `db.announcements`（不消耗全局 rng） |
| `src/mock/index.js` | 种子加载完成后 hydrateDb 恢复快照；导出 dashboard/workbenchTodos/weatherOf |
| `src/permission.js` | **补修 P2-4 回归**：ROLE_MENUS 改为真实路由路径；结算专员菜单补 `/report` |
| `src/router/index.js` | 新增 `/report`（报表中心）与隐藏路由 `/driver-app`（司机端）；守卫对 /workbench、/driver-app 豁免 |
| `src/main.js` | 启动 enableAutoSave 自动保存 |
| `src/views/report/index.vue` | 新增：报表中心（4 页签 + 图表 + CSV 导出） |
| `src/views/driver/app.vue` | 新增：司机端 H5 演示页（模拟登录/接单/装货/发车/到达/电子签收） |
| `src/views/plan/create.vue` | 剩余量校验：合同信息条展示剩余可计划量、数量三重拦截（校验器/切换回落/提交兜底） |
| `src/views/plan/list.vue` | 派车弹窗按方式分支：非公路显示运输单元提示、隐藏选车、默认 1 单元 |
| `src/views/dispatch/list.vue` | "车辆/单元"列（unitNo 优先）、关键字支持单元号、操作提示按方式分支、导出增"方式"列 |
| `src/views/dispatch/detail.vue` | 车辆/运输单元面板分支、时间线按方式分支、电子签收展示、"司机端视图"入口、打印单兜底 |
| `src/views/terminal/weighing.vue` | 磅单补录候选仅公路口径 |
| `src/views/contract/list.vue` | 变更/延期/终止（提前结算勾选）/归档操作弹窗；状态与统计增"已归档" |
| `src/views/contract/detail.vue` | 变更/延期/终止/归档操作入口；新增"变更记录"页签；审批改调 flow.approveContract；调度表"车辆/单元"兜底 |
| `src/views/track/index.vue` | 轨迹回放（21 点确定性轨迹/播放暂停/倍速/拖拽/轨迹线）+ 电子围栏（卸货场围栏圈/偏离预警/超时预警/进入围栏提示） |
| `src/views/settlement/invoice.vue` | 开票改 genInvoiceNo 确定性发票号 |
| `src/layout/components/Navbar.vue` | 用户菜单新增"重置演示数据"（确认→resetDb） |
| `src/views/dashboard/workbench.vue` | 公告/天气接入新数据源（db.announcements + weatherOf） |
| `src/views/vehicle/detail.vue`、`src/views/dispatch/detail.vue` | 顺带修复：`<Truck />` 图标不存在（静默不渲染），改为 `Van` |
| `scripts/alias-loader.mjs` | 别名扩展：@/mock、@/store、@/permission |
| `scripts/verify-flow.mjs` | 新增第 7 节 P3 断言（23 项：剩余量/多式联运全流程/司机端签收/合同生命周期/KPI 口径/发票号/公告天气/报表/RBAC 路径），总数 52 → 75 |

## 五、验证记录

- **2026-08-15（第一轮）**：`npm run build` 构建通过；冒烟测试 17/17 通过，覆盖：
  1. 预置数据一致性（计划/合同/结算与调度数据对齐、单车运量区间、异常车次数量）
  2. 状态机全流程（派车→装货→发车→到达→卸货→磅单→资源释放→计划/合同回卷）
  3. 异常闭环（上报→恢复运输）
- **2026-08-15（第二轮）**：`npm run build` 构建通过；冒烟测试 29/29 通过，新增第 4 节结算闭环：
  4. 结算闭环（预置账单车次标记一致、完成车次=已入账+候选无遗漏无重复、生成结算单→防重复→三方比对与磅单一致→损耗差异判定→确认结算全额入账）
- **2026-08-15（第三轮）**：`npm run build` 构建通过；冒烟测试 39/39 通过，新增/更新：
  5. 按磅结算口径（结算量=出磅净重之和、金额恒等式含损耗/异常损失扣减、收款流水与已付一致、逾期=超账期未付清）
  6. 收款与信用（部分收款→流水生成、超收截断、超账期未付清→逾期、付清→已结算、授信额度校验通过/拒绝）
- **2026-08-15（第四轮）**：`npm run build` 构建通过；冒烟测试 52/52 通过，新增第 6 节模块互联（13 项）：
  7. 审计日志（状态变更实时写日志、含操作人/详情、时间倒序）
  8. 仓储联动（装货出库占用减少、卸货入库新批次+占用增加）
  9. 安全联动（事故异常生成事故记录、处置同步、关闭结案）
  10. 审批驳回（回草稿+审批意见、通过→执行中）
  11. 磅单补录（补录成功、重复拦截、皮重 10-16t 与预置口径一致）
- **2026-08-16（第五轮，P3 产品完整度）**：`npm run build` 构建通过（无 lint 错误）；冒烟测试 75/75 通过，新增第 7 节 P3 断言（23 项）：
  12. 合同剩余可计划量口径（总量-未取消计划量）
  13. 多式联运（铁路合同按运输单元派车、无车辆/司机、全流程完成且无公路磅单、manualWeighing 拦截非公路车次）
  14. 司机端（接单标记 accepted、电子签收单 QS- 码+签收人+时间）
  15. 合同生命周期（变更重算金额+记录历史、延期更新截止日、提前终止取消待执行计划、归档）
  16. KPI 口径（准时率 0-100 区间、利用率=运输中/非报废车辆）
  17. 发票号确定性派生（16 位 2410 开头、同种子同结果、不同结算单不同号）
  18. 公告/天气数据源化（db.announcements、weatherOf 按日期确定性）
  19. 报表中心（月度 6 个月、客户授信占用、商品损耗率、场站吞吐）
  20. RBAC（报表中心结算专员可访问/调度员不可访问、路径与实际路由一致）
- **2026-08-16（第五轮内）**：修复 P2-4 回归（ROLE_MENUS 路径与实际路由不符导致非管理员菜单全被过滤）；修复 `<Truck />` 图标不存在（2 处改 `Van`）

## 六、下一步建议（按优先级）

P0-P3 全部闭环，当前为完整可演示版本。后续可选方向：

1. **真实后端接入**：以 persist.js 为边界替换为 API（快照结构即数据模型雏形）
2. **报表增强**：自定义报表配置（维度/指标/时间范围自选）、报表定时导出
3. **司机端深化**：扫码确认（装/卸货扫码）、轨迹上报接口化、消息推送
4. **电子围栏深化**：围栏参数可配置（半径/偏离阈值按线路差异化）、围栏事件写入异常单
5. **多级审批**：合同审批流（部门→公司）与审批链可视化
