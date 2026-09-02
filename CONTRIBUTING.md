# 贡献指南（bulkhaul-manage-web）

## 分支与提交

- 主干开发（master）；提交信息用中文，格式：`{类型}：{摘要}`（类型：功能/修复/重构/测试/文档/构建）
- 一次提交一个内聚变更；大重构按"可独立回滚"切分
- 推送经本地代理（网络环境相关），失败重试 ≤3 次；**推送后必须验证** `git rev-parse HEAD == git rev-parse origin/master`（push 输出有假阳性）

## 验证门槛（提交前全绿）

| 门 | 命令 | 基线 |
|---|---|---|
| 构建 | npm run build | 零错误 |
| 数据层 | npm test（verify-api 35 + verify-collection 20） | 55 通过 |
| 前后端契约 | npm run test:contract | 97/97 |
| UI E2E | npm run build && node scripts/verify-ui.mjs（WSL 全栈） | 110 通过 0 失败 |
| 后端（如涉及） | mvn test（WSL） | 33 通过 |

E2E 环境纪律（详见 bulkhaul-docs/deployment/runbook.md）：
- 浏览器 + 8086 静态 + 8081 后端**全部在 WSL 内**跑（E2E_DIST=/tmp/e2e-dist，每次先 cp -r dist）
- 后端容器 blms-backend 必须 SCHEDULER_AUTO_ENABLED=false（验收栈确定性）
- 场景间 resetDemo() 回种子态，脚本幂等可复跑

## 目录约定

```
src/
├── api/          # 接口层：client（HTTP）/ snapshot（快照同步）/ endpoints（W 写端点契约）/ write（写钩子+乐观锁）/ index（门面）
├── data/         # 本地数据层：base（db 镜像）/ derived（派生读+会话态）/ dashboard（看板聚合）/ document（单证）/ scheduler（tick 桥）
├── composables/  # useCollection（集合读缓存）等
├── views/        # 页面（交叉引用 find 下沉到各视图，仅声明本视图用到的键）
└── store/        # Pinia（应用状态，非业务数据）
```

- 新增写端点：endpoints.js 加 W 映射 + 后端 Controller 同步 + 跑 test:contract
- 新增集合：data/base.js db 结构 + api/snapshot.js LIST/OBJ_COLLS + 后端 DataStore 三处同步
- 视图交叉引用：局部 const find（不引全局）；派生读放 data/derived.js（纯函数）
- 注释口径：后端为唯一权威态；本地 db 是快照镜像（读缓存），不是数据源

## 文档同步

- 架构/契约变更 → 同步 bulkhaul-docs（api-reference.md / 数据字典 / ADR）
- 验收口径变更 → 同步 acceptance/ 三件套
