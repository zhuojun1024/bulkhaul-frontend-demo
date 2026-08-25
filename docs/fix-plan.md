# 修复进度计划（fix-plan）

> 本文件是修复工作的**唯一事实来源**。上下文压缩后，重读本文件 + 代码即可接上进度。
> 纪律：每项先实现 → 补 verify-flow 断言 → `npm test` 全绿 → 才标记 done-verified。
> 状态：pending / in-progress / done-verified / blocked

## 基线（2026-08-25 开工前）

- `npm test`：486 通过，0 失败（verify-flow 环节 1–25）
- 新增断言统一从环节 26 起编号

## 任务清单

### F1 [P0] 卸货中异常恢复分支 — done-verified（环节 26，8 断言）
- 问题：`resumeDispatch`（flow.js:830）只按 loadTime 二分恢复（intransit/loading），
  异常发生在"卸货中"时恢复回 intransit，需重走 到达→卸货，且可能二次过磅。
- 方案：`createException` 记录 `d.exceptionFrom = d.status`（异常前状态）；
  `resumeDispatch` 优先按 exceptionFrom 恢复（loading/intransit/unloading 各自回原态），
  无 exceptionFrom 时回退现有 loadTime 二分逻辑（兼容种子数据）。
  unloading 恢复：progress=96，eta 顺延，不重算 speed（卸货中无车速）。
- 文件：src/mock/flow.js（createException ~777、resumeDispatch ~830）
- 测试：verify-flow 环节 26（unloading 异常→恢复回 unloading→可继续 confirmUnload；
  intransit/loading 恢复行为不变；种子兼容回退）
- 验收：npm test 全绿

### F2 [P0] 仓储手工入库/补库 — done-verified（环节 27，9 断言）
- 问题：装货出库有充足性守卫，但全系统无手工入库入口，库存扣到 0 后装货被拦截且无法补库（死路）。
- 方案：`manualInbound(warehouseId, commodityId, quantity, batch?, remark?)`（RBAC: warehouse）
  - 守卫：仓库存在且 operating、商品存在、quantity>0；
  - 生成批次（batch 缺省 `B{YYMMDD}-M{seq}`），status=normal，inDate=今天；
  - wh.used 累加（不超 capacity，超出报错）；留痕 + 通知仓储角色。
- 文件：src/mock/flow.js（warehouseIn 附近）、src/views/warehouse/inventory.vue（入库按钮 + 对话框）
- 测试：verify-flow 环节 27（正常入库/守卫拦截/used 累加/超容量拦截）
- 验收：npm test 全绿

### F3 [P1] 门户开放对账明细 — done-verified（纯 UI，build 验证）
- 问题：客户门户只展示"差异 N 车次、损耗 X 吨"汇总，看不到逐车次明细，确认/异议缺乏依据。
- 方案：portal/index.vue 账单表格加展开行（el-table type=expand），逐车次展示
  调度单号/车牌/调度量/进磅/出磅/结算量/损耗/质量扣重/差异/签收/比对，
  数据取 s.reconciliation.items；未对账账单显示空态。
- 文件：src/views/portal/index.vue
- 测试：纯 UI 展示，无服务层变更（verify-ui 已有门户场景）
- 验收：build 通过

### F4a [P1] 司机端异常上报 — done-verified（环节 28，5 断言）
- 问题：司机是事故/故障第一知情人，driver/app.vue 无 reportException 入口。
- 方案：`driverReportException(d, description, type, level)`（走 requireDriverApp 身份守卫 +
  createException 内部核心，source='driver'）；H5 车次卡片执行中状态显示"上报异常"按钮 + 对话框。
- 文件：src/mock/flow.js（司机端区块）、src/views/driver/app.vue
- 测试：verify-flow 环节 28（司机本人上报成功/非本人司机拦截/非司机角色拦截/事故类联动）
- 验收：npm test 全绿

### F4b [P1] 司机新增/导入 — done-verified（环节 29，11 断言）
- 问题：司机只有种子数据，无新增表单、无导入，人员变动无法维护。
- 方案：`saveDriver(payload)`（RBAC: driver，新建/编辑，手机号查重）+
  `importDrivers(rows)`（RBAC: driver，按手机号去重，与 importVehicles 同模式）；
  driver/list.vue 加"新增司机"按钮 + 表单对话框 + "导入"按钮（复用 ImportDialog）+ 行内"编辑"。
- 文件：src/mock/flow.js（写操作下沉区块）、src/views/driver/list.vue
- 测试：verify-flow 环节 29（新建/必填拦截/查重/编辑/导入去重/RBAC）
  注意：调度员本身持有 driver 权限，RBAC 反例用结算专员。
- 验收：npm test 全绿

### F4c [P1] 管理员重置密码 — done-verified（环节 30，9 断言）
- 问题：saveUser 编辑不能改密码，用户忘记密码/锁定后无恢复入口。
- 方案：`resetPassword(userId, newPassword)`（RBAC: user）：校验密码非空且 ≥6 位，
  更新 passwordHash，审计留痕（不落新密码明文），通知目标用户角色（停用跳过）。
  system/user.vue 加"重置密码"按钮 + 对话框（二次确认输入）。
- 文件：src/mock/flow.js（saveUser 附近）、src/views/system/user.vue
- 测试：verify-flow 环节 30（重置后旧密码失败/新密码成功/短密码拦截/RBAC/审计留痕）
  注意：审计日志在 db.logs，字段为 action/detail。
- 验收：npm test 全绿

### F5a [P2] 报表运量口径统一 — done-verified（环节 31，3 断言）
- 问题：monthlyReport/customerReport/commodityReport 运量仍用调度量 d.quantity，
  与结算（出磅净重）口径不一致。
- 方案：三报表运量改用 settleQtyOf 口径（出磅净重，无出磅单回退调度量）。
  settleQtyOf 由 flow.js 私有改为导出。report.js 头部口径说明同步更新。
- 文件：src/mock/flow.js（导出 settleQtyOf）、src/mock/report.js
- 测试：verify-flow 环节 31（构造调度量100/出磅98的车次，三报表对应行各 +98 非 +100）
- 验收：npm test 全绿

### F5b [P2] 计划拆车余数修正 — done-verified（环节 32，3 断言）
- 问题：createDispatches 的 per=round(quantity/count) 均摊，100 吨拆 3 车 = 34×3=102 吨超量。
- 方案：每车至少 1 吨，实际拆车数 effCount = min(count, floor(quantity))；
  前 effCount-1 车取 floor 均摊 per，最后一车取余数（quantity - per*(effCount-1)），
  保证 Σ车次量 = 计划量。公路/非公路两分支同改（含 fee 按实际量计算）。
- 文件：src/mock/flow.js（createDispatches）
- 测试：verify-flow 环节 32（100吨拆3车=33/33/34；90吨整除=30/30/30 不变；
  2吨拆3车降级为2车各1吨）
- 验收：npm test 全绿

### FINAL 收尾 — done-verified
- npm test 全绿（环节 1–32，533 断言，0 失败）
- npm run build 成功（vue-cli-service build，dist 可部署）
- 已更新本文件全部状态 + README（辅助流程/功能模块/测试与质量章节）

---

## 第二轮整改（基础数据维护 + 财务核销链路）

> 触发：重新评估"功能完整性/流程闭环/逻辑自洽"后，识别出基础数据维护（场站/仓库）
> 与财务核销（银行流水来源）两类缺口。基线 533 → 目标 554+。

### F6a [P1] 场站新增/编辑 — done-verified（环节 33，8 断言）
- 问题：terminal/list.vue 只读，flow.js 无 saveTerminal；合同强依赖装/卸场站，
  但场站只能靠种子数据，与已补齐的司机/车辆/商品/客户不对称。
- 方案：`saveTerminal(payload)`（RBAC: terminal）：名称必填且查重、类型合法
  （loading/unloading/both）、日能力>0；新建默认 operating/吞吐0/无配套仓库；
  编辑可改配套仓库（影响装卸货仓储联动）。permission-table 加 `terminal` 操作码
  （授场站操作员）。terminal/list.vue 加"新增场站"按钮 + 卡片"编辑" + 表单对话框。
- 文件：src/mock/flow.js（saveTerminal）、src/permission-table.js、src/views/terminal/list.vue
- 测试：verify-flow 环节 33（新建/结构/名称缺失/重名/能力非正/编辑/调度员越权拦截）
- 验收：npm test 全绿

### F6b [P1] 仓库新增/编辑 — done-verified（环节 34，8 断言）
- 问题：warehouse/list.vue 只读，flow.js 无 saveWarehouse；仓库只能靠种子数据。
- 方案：`saveWarehouse(payload)`（RBAC: warehouse-maint）：名称必填且查重、容量>0；
  新建默认 operating/used=0；编辑容量不得低于已用库存（used）。permission-table 加
  `warehouse-maint` 操作码（授场站操作员）。warehouse/list.vue 加"新增仓库"按钮 +
  卡片"编辑" + 表单对话框。
- 文件：src/mock/flow.js（saveWarehouse）、src/permission-table.js、src/views/warehouse/list.vue
- 测试：verify-flow 环节 34（新建/结构/名称缺失/重名/容量非正/容量下限守卫/编辑/越权拦截）
- 验收：npm test 全绿

### F7 [P1] 银行流水录入 — done-verified（环节 35，7 断言）
- 问题：db.bankRecords 只有种子数据，全代码无录入入口；核销流程（手动/自动）逻辑
  完整但"流水从哪来"断链，演示时只能核销种子流水。
- 方案：`addBankStatement(payload)`（RBAC: settlement）：对手方/金额/到账时间必填、
  金额>0；录入后 status=unmatched 进入待核销，可走自动核销（金额=账单未付余额）
  或手动核销，闭合"流水从哪来"。settlement/list.vue 银行对账页加"流水录入"按钮 +
  对话框（对手方下拉可输入/金额/到账时间/摘要）。
- 文件：src/mock/flow.js（addBankStatement）、src/views/settlement/list.vue
- 测试：verify-flow 环节 35（对手方缺失/金额非正/时间缺失/录入成功 unmatched/结构/越权拦截）
- 验收：npm test 全绿

### F8 [P2] 已知取舍（留档 backlog，不实现）
- 说明：以下三项在演示系统层面可接受，作为"已知取舍"留档，暂不实现。
  若走向真实系统再补。
  1. 异常损失单一金额字段：finishException 的 cost 不区分货损/车损/维修费，
     真实理赔责任认定需拆分；演示用单字段+备注可接受。
  2. 客户门户不能自助预付：collectPrepayment 仅平台侧（客户详情页）操作，
     真实系统客户应能自助充值；演示由销售代操作可接受。
  3. 银行自动核销仅精确匹配：一笔流水只核销一张账单、容差 0.01 元，
     真实银行常"一笔付多账/含手续费"会落到人工核销；演示可接受，UI 已说明口径。

### FINAL-2 收尾 — in-progress
- npm test 全绿（环节 1–35，554 断言，0 失败）
- npm run build 成功
- 更新本文件 + README（场站/仓库/银行流水录入）
- commit + push

## 压缩后重入协议

1. 重读本文件，找到第一个非 done-verified 的项；
2. 读 todo() 确认当前 in_progress；
3. 若某项处于 in-progress（改了代码未验证），先跑 `npm test` 判断现状再决定继续或回退；
4. 不凭摘要印象动手，一切以本文件 + 代码现状为准。
