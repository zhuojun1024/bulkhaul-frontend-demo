/**
 * 角色权限表（唯一数据源）
 * 菜单级：ROLE_MENUS 控制侧边栏可见菜单与路由访问；null 表示全部菜单
 * 按钮级：ROLE_ACTIONS 控制关键操作按钮；null 表示全部操作，[] 表示只读
 * 本文件为纯数据、零依赖：permission.js（运行时判定）与 mock/system.js（种子 db.rolePerms）共用，
 * 避免 mock ↔ permission 循环引用。运行时以 db.rolePerms 为准（角色管理页可编辑），此处为内置默认值。
 *
 * 操作码：
 *  contract   新建/变更/延期/终止/归档合同    contract-approve 合同审批（通过/驳回）
 *  plan       新建/取消计划                  dispatch   派车与调度执行（装货/发车/到达/卸货/恢复）
 *  exception  异常受理/处置/关闭             safety     安全管理操作
 *  settlement 结算（生成/对账/结算/收款/重算） invoice   开票/红冲
 *  weighing   磅单补录                       warehouse  库存锁定/解锁/临期
 *  vehicle    车辆报修/恢复                  driver     司机停用/启用
 *  customer   客户冻结/解冻                  customer-confirm 客户确认对账（门户）
 *  customer-request 客户发起运输需求（门户）
 */
/** 注意：路径必须与 router 实际注册路径一致（如 /contract，而非 /transport/contract） */
export const ROLE_MENUS = {
  平台管理员: null,
  只读用户: null,
  调度员: [
    '/workbench',
    '/message',
    '/monitor',
    '/contract',
    '/plan',
    '/dispatch',
    '/track',
    '/exception',
    '/vehicle',
    '/driver',
    '/terminal',
    '/terminal/weighing'
  ],
  结算专员: ['/workbench', '/message', '/monitor', '/contract', '/customer', '/settlement', '/settlement/invoice', '/report'],
  场站操作员: ['/workbench', '/message', '/dispatch', '/terminal', '/terminal/weighing', '/warehouse', '/warehouse/inventory'],
  安全管理员: ['/workbench', '/message', '/dispatch', '/exception', '/safety'],
  客户: ['/workbench', '/portal', '/message'],
  司机: ['/workbench']
}

export const ROLE_ACTIONS = {
  平台管理员: null,
  只读用户: [],
  调度员: ['contract', 'plan', 'dispatch', 'exception', 'vehicle', 'driver'],
  结算专员: ['settlement', 'invoice', 'customer'],
  场站操作员: ['dispatch', 'weighing', 'warehouse'],
  安全管理员: ['dispatch', 'exception', 'safety'],
  客户: ['customer-confirm', 'customer-request'],
  司机: []
}

/** 菜单权限选项（角色管理页勾选用，与 router 注册路径一致） */
export const MENU_OPTIONS = [
  { path: '/workbench', label: '工作台' },
  { path: '/message', label: '消息中心' },
  { path: '/portal', label: '客户门户' },
  { path: '/monitor', label: '数据看板' },
  { path: '/contract', label: '合同管理' },
  { path: '/plan', label: '运输计划' },
  { path: '/dispatch', label: '调度管理' },
  { path: '/track', label: '在途监控' },
  { path: '/exception', label: '异常处理' },
  { path: '/vehicle', label: '车辆管理' },
  { path: '/driver', label: '司机管理' },
  { path: '/terminal', label: '场站管理' },
  { path: '/terminal/weighing', label: '磅单记录' },
  { path: '/warehouse', label: '仓储管理' },
  { path: '/warehouse/inventory', label: '库存管理' },
  { path: '/commodity', label: '商品管理' },
  { path: '/customer', label: '客户管理' },
  { path: '/settlement', label: '结算管理' },
  { path: '/settlement/invoice', label: '发票管理' },
  { path: '/report', label: '报表中心' },
  { path: '/safety', label: '安全管理' },
  { path: '/system/user', label: '用户管理' },
  { path: '/system/role', label: '角色管理' },
  { path: '/system/log', label: '操作日志' }
]

/** 操作权限选项（角色管理页勾选用） */
export const ACTION_OPTIONS = [
  { code: 'contract', label: '合同管理（新建/变更/延期/终止/归档）' },
  { code: 'contract-approve', label: '合同审批（通过/驳回）' },
  { code: 'plan', label: '运输计划（新建/取消）' },
  { code: 'dispatch', label: '调度执行（派车/装货/发车/到达/卸货/恢复）' },
  { code: 'exception', label: '异常受理/处置/关闭' },
  { code: 'safety', label: '安全管理操作' },
  { code: 'settlement', label: '结算（生成/对账/结算/收款/重算）' },
  { code: 'invoice', label: '开票/红冲' },
  { code: 'weighing', label: '磅单补录' },
  { code: 'warehouse', label: '库存锁定/解锁/临期' },
  { code: 'vehicle', label: '车辆报修/恢复' },
  { code: 'driver', label: '司机停用/启用' },
  { code: 'customer', label: '客户冻结/解冻' },
  { code: 'customer-confirm', label: '客户确认对账（门户）' },
  { code: 'customer-request', label: '客户发起运输需求（门户）' }
]
