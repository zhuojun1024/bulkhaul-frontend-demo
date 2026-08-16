# 项目流程闭环分析报告

> 审计日期：2026-08-16
> 审计范围：全项目源码（17 个 mock 模块 + 30 个页面 + 布局/权限/持久化），逐文件核对业务接线
> 审计方法：不采信既有文档，全部对照代码实测；构建与冒烟测试实际运行
> 状态图例：⚠️ 高危 ｜ 🐛 缺陷 ｜ 🔧 一致性 ｜ 📐 工程 ｜ ➕ 待补充

## 一、验证结果（实测）

| 验证项 | 结果 |
|---|---|
| `npm run build` 生产构建 | ✅ 通过（无错误） |
| `node --import ./scripts/register.mjs scripts/verify-flow.mjs` 冒烟测试 | ✅ 75/75 通过 |
| 主链路页面接线（合同→计划→调度→磅单→结算→发票） | ✅ 与 `src/mock/flow.js` 中枢一致 |

> 说明：75 项断言**全部覆盖 mock 数据层**，Vue 页面接线（RBAC 按钮、弹窗、状态分支）零覆盖。本文列出的问题均位于测试盲区。

## 二、总体结论

**作为"可演示的闭环"：成立，完成度高于一般 AI 生成项目。** 主链路（合同审批→拆批→派车→装货→在途→卸货→磅单→结算→对账→收款→逾期→开票）端到端可跑通，异常/仓储/安全/司机端/报表/持久化均有真实联动，不是"页面孤岛"。

**作为"可用的产品"：闭环约完成 70%。** 断点集中在四处：

1. **权限体系半失效**（角色管理空壳 + 未知角色默认放行 + 详情页漏控）
2. **异常上报入口类型被锁死**（事故类异常 UI 不可达，安全联动成死代码）
3. **安全模块种子数据脱钩**（事故与异常单无关联）
4. **客户侧与成本侧完全缺失**

## 三、问题清单

### A. 功能性缺陷（闭环断裂点）

| # | 级别 | 问题 | 位置 |
|---|------|------|------|
| A1 | ⚠️ | **角色管理页是"空壳"，RBAC 实际不可配置**：`savePerm()` 只弹"权限已更新"提示，不写任何数据；权限表硬编码在 `permission.js`，页面抽屉纯摆设。新增角色只 push 进 `db.roles`，不注册进 `ROLE_MENUS/ROLE_ACTIONS` → `menuAllowed/actionAllowed` 对未知角色返回 `true`（`menus === undefined → return true`）→ **新建角色默认全权限** | `src/views/system/role.vue:108`、`src/permission.js:50` |
| A2 | ⚠️ | **未知/空角色默认"放行"，账号停用不生效**：路由守卫 `if (role && ...)` 在 role 为空时跳过全部校验；停用某账号后该用户刷新页面 → store 恢复查不到 active 用户 → `role = ''` → 守卫放行 + 侧边栏也放行 → **被停用用户保留全部访问权**。默认应为 deny | `src/router/index.js:287` |
| A3 | 🐛 | **新建用户永远无法登录**：创建用户时不写 `password` 字段，登录校验 `user.password !== form.password` 必然失败；且无账号重复校验 | `src/views/system/user.vue:191`、`src/views/login/index.vue:136` |
| A4 | 🐛 | **确认结算会"吞掉"预付款**：种子"对账中"账单带 50% 预付且已生成预付流水，但 `confirmSettle` 直接 `paidAmount = 0` → 预付流水还在、已付金额归零 → 收款流水合计 ≠ 已付金额（冒烟测试只断言种子态，测不到此路径） | `src/mock/flow.js:566`、`src/mock/settlement.js:33` |
| A5 | 🐛 | **异常上报入口类型被锁死，事故联动是"死代码"**：唯一上报入口是调度页"报异常"，`type` 恒为 `'other'`、`level` 恒为 `'medium'` → UI 上永远无法产生事故类异常 → 事故记录生成/结案/车辆转检修逻辑界面上不可达；安全模块 15 条种子事故与异常单无 `exceptionId` 关联，两模块在种子数据层面仍是孤岛 | `src/views/dispatch/list.vue:298`、`src/mock/safety.js` |
| A6 | 🐛 | **状态机无前置守卫**：`confirmLoad/depart/arrive/confirmUnload` 直接覆盖 `status`，不校验当前状态（UI 的 `v-if` 是唯一防线）。司机端强制"先接单后装货"，但 PC 端可跳过接单直接确认装货，两端规则不一致 | `src/mock/flow.js`、`src/views/driver/app.vue:50` |
| A7 | 🐛 | **合同提前终止不拦在途**：只取消 `status === 'pending'` 的计划；"已调度/执行中"计划及其待装货车次继续执行并照常结算，UI 文案"待执行计划批次将一并取消"与行为不符 | `src/mock/flow.js:696` |
| A8 | 🐛 | **无重算/调整结算机制**：结算金额生成时固化；`exceptionLoss` 只统计已关闭异常。结算时异常未关闭 → 损失永不扣减；结算后异常才关闭 → 账单不调整。缺"结算调整单"或重新对账入口 | `src/mock/flow.js:440` |
| A9 | 🐛 | **派车资源可重复占用**：`createDispatches` 不从池中移除已分配车辆/司机（按模选取）→ 同一车/司机可被派多张待装货单，占用推迟到发车 | `src/mock/flow.js:343` |
| A10 | 🐛 | **月度报表逾期口径错误**：`overdueCount` 未按月过滤，是全量逾期账单数，在 6 个月每行重复显示 | `src/mock/report.js:28` |

### B. 权限（RBAC）漏洞

| # | 问题 | 位置 |
|---|------|------|
| B1 | 合同详情页"审批通过"按钮**无权限控制**（列表页有 `can('contract-approve')`）；变更/延期/终止/归档按钮同样无 `can('contract')` → 结算专员（有 /contract 菜单但无 contract 操作权）可在详情页改合同；只读用户可在详情页审批 | `src/views/contract/detail.vue:17-27` |
| B2 | 详情页审批只有"通过"无"驳回"、无审批意见，与列表页弹窗不一致 | 同上 |
| B3 | 资源类操作**无按钮权限、无审计日志**：车辆报修/恢复、司机停用/启用、客户冻结/解冻、库存锁定/解锁/临期、计划取消、发票页开具/红冲（`issue/redFlush` 直改 row，不走 flow，无 `logAction`） | `src/views/warehouse/inventory.vue:168`、`src/views/settlement/invoice.vue:180` 等 |
| B4 | 导航语义错误：顶栏通知"查看全部"跳 `/exception`；工作台公告"更多"跳操作日志页 | `src/layout/components/Navbar.vue:178`、`src/views/dashboard/workbench.vue:85` |

### C. 数据一致性 / 口径

| # | 问题 | 位置 |
|---|------|------|
| C1 | **皮重口径分裂**：种子磅单按调度单随机 10-16t，运行时补录按车辆确定性派生 `tareOf` → 同一车辆进/出磅皮重不一致（"与预置口径一致"只在区间层面成立） | `src/mock/weighing.js:18`、`src/mock/flow.js:65` |
| C2 | **种子数据质量**：已完成合同约 28% 挂着"待执行"计划（按日期而非合同状态生成）；T008 场站"维修中"却是 2 条 ROUTES 起点；结算种子周期单月但聚合车次跨多月 | `src/mock/plan.js:13`、`src/mock/base.js:78` |
| C3 | **硬编码残留**：`safeDays: 386`、培训覆盖率 96.5%、看板/监控页各"较昨日/同比"趋势值（12.5、-2.1、8.4、11.2…）全部写死 | `src/mock/dashboard.js:107`、各 StatCard |
| C4 | **文案与数据不符**：客户详情"累计运量"实为合同计划量之和；`genInvoiceNo` 注释写"20 位"实为 16 位 | `src/views/customer/detail.vue:159`、`src/mock/flow.js:34` |
| C5 | **运行时消费种子 rng**：`pushWeighing` 的 `randomName()`、`generateSettlements` 的 `tollFee/surcharge`、`depart` 的速度都消耗全局种子序列 → 运行时数值依赖本次会话已调用次数，不可复现（种子数据本身确定，混用属设计异味） | `src/mock/flow.js` |
| C6 | **日志无上限**：`db.logs` 只增不减 + 深度监听全量序列化写 localStorage，长期使用有配额风险（异常被静默吞掉）；`logAction` 的 IP 固定 `192.168.1.100` | `src/mock/persist.js`、`src/mock/flow.js:59` |
| C7 | 红冲后重开票，结算详情发票面板 `find` 取到的是旧的红冲发票 | `src/views/settlement/detail.vue:237` |

### D. 工程质量

| # | 问题 |
|---|------|
| D1 | **测试只覆盖 mock 层**：75 项断言全在数据层，UI 接线零覆盖——此前"ROLE_MENUS 路径不符导致非管理员菜单全灭"的回归正是 UI 层问题，测试完全无能力捕获 |
| D2 | 在途监控页每 3 秒 interval 直接改 db（progress/speed）并触发持久化写入——仅打开监控页就在修改"业务数据"（`src/views/track/index.vue:479`） |
| D3 | 多处假加载（`setTimeout 200-300ms + v-loading`）；`plan/create`、`contract/create` 候选列表 setup 时一次性过滤（非响应式），合同审批通过后页面不刷新看不到 |
| D4 | 计划详情"立即调度"写死 3 车次，与列表页可配置不一致；磅单补录候选 `.slice(0,100)` 静默截断；登录框提示"用户名/手机号"但只校验用户名 |
| D5 | 根目录残留调试产物：`debug-login.mjs`、`diagnose-menu.mjs`、`verify.mjs`、`sidebar-diag.png` |

## 四、需要补充的环节（产品完整度缺口）

按对"闭环"的贡献排序：

1. **真实后端/API 层**（最根本）：当前纯前端 mock + localStorage，无服务端校验、无多用户并发、权限改个 localStorage 即可绕过。persist.js 的快照结构可直接作为数据模型雏形
2. **客户侧门户**：发货方（货主）是结算对象却没有任何入口看合同/账单/回款进度；对账流程里的"客户确认"只是静态步骤条。大宗物流的"闭环"缺少客户这一端
3. **成本与利润侧**：只有收入侧（运费/结算/收款），`vehicle.monthlyCost` 是孤字段，无成本归集、无毛利分析、无单车/单线效益报表
4. **多级审批**：目前仍单级通过/驳回，合同审批流（部门→公司）与审批链可视化未做
5. **异常上报完整入口**：独立"上报异常"（选调度单+类型+级别+描述），打通事故类异常的 UI 可达性（对应 A5）
6. **司机端深化**：扫码确认装/卸货、轨迹上报接口化、消息推送（当前是"下拉框模拟登录"）
7. **电子围栏业务化**：围栏参数可配置、围栏事件（偏离/超时）自动写入异常单——目前围栏只是监控页视觉效果
8. **安全模块操作闭环**：事故/培训/检查三张表全只读，无新增入口、无培训报名、无检查登记；车辆年检到期/驾照到期无业务拦截（字段存在但未联动）
9. **消息中心**：通知只有顶栏下拉，无已读/未读、无历史页
10. **数据导入**（Excel 导入客户/商品/车辆），目前只有 CSV 导出

## 五、修复优先级建议

### P0（正确性/安全，建议立即修）

| # | 事项 | 对应问题 | 状态 |
|---|------|---------|------|
| 1 | RBAC 默认改 deny：`menuAllowed/actionAllowed` 对未知角色返回 false，路由守卫对空 role 也校验 | A1/A2 | ✅ 已修（2026-08-16，另：停用账号刷新后强制回登录页） |
| 2 | 合同详情页补齐按钮级权限 + 驳回入口 | B1/B2 | ✅ 已修（2026-08-16，审批弹窗与列表页同口径：意见 + 通过/驳回） |
| 3 | 新建用户补默认密码 + 账号查重 | A3 | ✅ 已修（2026-08-16，默认密码 123456 + 查重 + id 防冲突） |
| 4 | `confirmSettle` 保留预付（不重置 `paidAmount`，或同步冲销预付流水） | A4 | ✅ 已修（2026-08-16，保留已收预付并补"对账中"前置守卫） |
| 5 | 异常上报增加类型/级别选择，种子事故与异常单建立关联 | A5 | ✅ 已修（2026-08-16，列表/详情页上报弹窗含类型+级别；safety.js 种子事故与事故类异常单双向关联） |
| 6 | flow 状态机加前置状态守卫，PC 端装货确认校验 `accepted` | A6 | ✅ 已修（2026-08-16，六个流转函数全部加守卫并返回 `{error}`；种子待装货单视为已接单，新派车单须司机端接单） |
| 7 | `monthlyReport` 逾期数按月过滤 | A10 | ✅ 已修（2026-08-16） |

> P0 修复后冒烟测试 75 → 85 项（新增守卫/预付保留/RBAC 默认拒绝/逾期口径/事故关联断言），全部通过；持久化快照版本升至 2 以丢弃旧结构快照。

### P1（一致性）

| # | 事项 | 对应问题 | 状态 |
|---|------|---------|------|
| 8 | 角色管理做真（权限表数据化） | A1 | ✅ 已修（2026-08-16，权限表下沉 `permission-table.js` 并种子化到 `db.rolePerms`，权限抽屉真实读写、保存即生效并持久化；新建角色默认 deny，删除角色同步清权限；角色卡片用户数改为按用户表实时统计） |
| 9 | 皮重统一为 `tareOf`（种子也按车辆派生） | C1 | ✅ 已修（2026-08-16，`tareOf` 下沉 `mock/base.js`，种子磅单与运行时补录/交互磅单同一口径，同车进/出磅皮重一致） |
| 10 | 资源类操作补按钮权限 + 审计日志 | B3 | ✅ 已修（2026-08-16，新增 vehicle/driver/customer 操作码；车辆报修/恢复、司机停用/启用、客户冻结/解冻、库存锁定/解锁/临期、计划取消全部补 `can()` + `logAction`；发票开具/红冲改走 flow（`issueInvoiceRow/redFlushInvoiceRow`，状态守卫 + 日志）） |
| 11 | 合同终止口径明确 + 拦截新增调度 | A7 | ✅ 已修（2026-08-16，口径：待执行计划取消、在途车次继续完成并正常结算、终止后不可再新建计划/下发调度单（`createDispatches` 守卫拦截）；列表/详情终止弹窗文案同步） |
| 12 | 派车时排除已有未完结车次的车辆/司机 | A9 | ✅ 已修（2026-08-16，`createDispatches` 排除待装货/装货中/异常车次的车辆与司机；计划页手动选车候选同口径过滤） |
| 13 | 结算调整机制（异常关闭补扣 + 重算入口） | A8 | ✅ 已修（2026-08-16，`closeException` 对已入账单补扣损失并记 `adjustments` 调整记录（`settleApplied` 防重复）；新增 `recalcSettlement` 重算入口（仅待对账账单，列表/详情页"重算"按钮，差异记调整记录）；结算详情页展示调整记录） |

> P1 修复后冒烟测试 85 → 103 项（新增角色权限数据化/皮重口径/发票走 flow/派车互斥/终止拦截/结算调整断言），全部通过；持久化快照版本升至 3。

### P2（产品完整度）

- 客户门户、成本侧、多级审批、扫码确认、围栏事件化（见第四节）
- UI 层 e2e 冒烟：至少覆盖"登录→主链路操作→权限拦截"，弥补 D1
- 清理调试脚本、硬编码文案与假加载（D3-D5、C3、C4）

## 六、验收路径（端到端演示脚本，回归用）

正向主链路，任何一步卡住即为断点：

```
新建合同 → 提交审批 → 审批通过 → 拆批计划 → 调度派车
→ 确认装货(进磅) → 发车 → 在途推进 → 到达(开始卸货)
→ 确认卸货(出磅) → 生成结算单 → 对账 → 结算收款 → 开票
```

反向验证异常闭环：

```
上报异常(含事故类) → 受理指派 → 处置完成 → 关闭归档
→ 调度单恢复运输 → 损失进入结算 → 事故记录结案
```

权限回归（P0 修复后新增）：

```
只读用户登录 → 菜单/按钮只读 → 直改 URL 访问受限页被拦截
新建角色 → 默认无任何菜单（deny）→ 授权后按授权显示
停用账号 → 该用户刷新后无法访问任何业务页
```

## 七、验证记录

- **2026-08-16（本轮审计）**：`npm run build` 构建通过；冒烟测试 75/75 通过（覆盖预置数据一致性、状态机全流程、异常闭环、结算闭环、收款/信用、模块互联、P3 产品完整度 7 大类）。UI 层问题（A1-A10、B1-B4、C、D）为人工代码审计发现，冒烟测试未覆盖。
- **2026-08-16（P0 修复）**：P0 七项全部修复（见第五节状态列）。改动文件：`src/permission.js`、`src/router/index.js`、`src/mock/flow.js`、`src/mock/dispatch.js`、`src/mock/safety.js`、`src/mock/report.js`、`src/mock/persist.js`（快照版本 1→2）、`src/views/contract/detail.vue`、`src/views/system/user.vue`、`src/views/dispatch/list.vue`、`src/views/dispatch/detail.vue`、`src/views/driver/app.vue`、`src/views/settlement/list.vue`、`src/views/settlement/detail.vue`、`src/views/exception/list.vue`、`scripts/verify-flow.mjs`。冒烟测试 85/85 通过，`npm run build` 通过（仅既有 vendor 体积警告）。注意：P0-6 起新派车单须司机端接单后方可确认装货（种子待装货单不受影响），演示主链路在"派车"与"确认装货"之间多一步司机端接单。
- **2026-08-16（P1 修复）**：P1 六项全部修复（见第五节状态列）。改动文件：新增 `src/permission-table.js`（权限表唯一数据源）；`src/permission.js`（判定改为 db.rolePerms 优先）、`src/mock/base.js`（db.rolePerms、tareOf 下沉）、`src/mock/system.js`（rolePerms 种子）、`src/mock/weighing.js`（种子皮重按车辆派生）、`src/mock/flow.js`（派车互斥/终止拦截/异常关闭补扣/recalcSettlement/issueInvoiceRow/redFlushInvoiceRow）、`src/mock/persist.js`（快照版本 2→3）、`src/views/system/role.vue`（权限抽屉真实读写）、`src/views/vehicle/list.vue`、`src/views/driver/list.vue`、`src/views/customer/list.vue`、`src/views/warehouse/inventory.vue`、`src/views/plan/list.vue`、`src/views/settlement/invoice.vue`、`src/views/settlement/list.vue`、`src/views/settlement/detail.vue`、`src/views/contract/list.vue`、`src/views/contract/detail.vue`、`scripts/verify-flow.mjs`、`scripts/alias-loader.mjs`。冒烟测试 103/103 通过，`npm run build` 通过（仅既有 vendor 体积警告）。注意：① 角色权限改在角色管理页"权限"抽屉中维护并持久化，内置角色默认值与原硬编码一致；② 合同终止口径为"在途车次继续完成并正常结算"（已发生业务照常履约）；③ 派车互斥按"待装货/装货中/异常"未完结车次排除车辆与司机，种子数据不受影响。
