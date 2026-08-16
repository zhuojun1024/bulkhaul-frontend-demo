import { db, rng, randInt, randomName, NOW } from './base'
import dayjs from 'dayjs'
import { ROLE_MENUS, ROLE_ACTIONS } from '@/permission-table'

/** 角色 */
db.roles = [
  { id: 'R001', name: '平台管理员', code: 'admin', userCount: 2, description: '系统全部权限', builtIn: true },
  { id: 'R002', name: '调度员', code: 'dispatcher', userCount: 5, description: '计划/调度/在途监控', builtIn: false },
  { id: 'R003', name: '结算专员', code: 'finance', userCount: 3, description: '结算/发票/对账', builtIn: false },
  { id: 'R004', name: '场站操作员', code: 'terminal', userCount: 4, description: '场站/磅单/仓储', builtIn: false },
  { id: 'R005', name: '安全管理员', code: 'safety', userCount: 1, description: '安全/异常/事故', builtIn: false },
  { id: 'R006', name: '只读用户', code: 'viewer', userCount: 0, description: '仅查看权限', builtIn: false }
]

/** 角色权限表（数据化）：内置角色按权限表种子；角色管理页的修改写入此处并随快照持久化 */
db.rolePerms = Object.fromEntries(
  Object.keys(ROLE_MENUS).map((name) => [name, { menus: ROLE_MENUS[name], actions: ROLE_ACTIONS[name] }])
)

/** 用户 */
const roleNames = ['平台管理员', '调度员', '调度员', '结算专员', '场站操作员', '安全管理员']
db.users = Array.from({ length: 15 }, (_, i) => {
  const role = i === 0 ? '平台管理员' : roleNames[i % roleNames.length]
  return {
    id: `U${String(i + 1).padStart(3, '0')}`,
    username: i === 0 ? 'admin' : 'user' + String(i + 1).padStart(2, '0'),
    name: i === 0 ? '张建国' : randomName(),
    role,
    // 演示环境统一密码
    password: '123456',
    phone: '138' + String(randInt(10000000, 99999999)),
    email: (i === 0 ? 'admin' : 'user' + String(i + 1).padStart(2, '0')) + '@blms.com',
    status: i === 12 ? 'disabled' : 'active',
    lastLogin: dayjs(NOW).subtract(randInt(0, 6), 'day').format('YYYY-MM-DD HH:mm'),
    createdAt: dayjs(NOW).subtract(randInt(30, 800), 'day').format('YYYY-MM-DD')
  }
})

/** 平台公告（数据源化：由 mock 统一提供，后续可替换为真实接口） */
db.announcements = [
  { id: 'G001', title: '关于 8 月份煤炭运输旺季运力保障的通知', date: dayjs(NOW).subtract(1, 'day').format('MM-DD'), tag: '重要' },
  { id: 'G002', title: '秦皇岛港 1 号煤仓 8 月 20 日检修，预计影响 2 天', date: dayjs(NOW).subtract(2, 'day').format('MM-DD'), tag: '场站' },
  { id: 'G003', title: '新版磅单系统上线，请各场站操作员完成培训', date: dayjs(NOW).subtract(4, 'day').format('MM-DD'), tag: '系统' },
  { id: 'G004', title: '汛期安全行车提示：关注 G6/G18 沿线雨情预警', date: dayjs(NOW).subtract(6, 'day').format('MM-DD'), tag: '安全' },
  { id: 'G005', title: '7 月结算单已全部完成对账，请各客户核对', date: dayjs(NOW).subtract(8, 'day').format('MM-DD'), tag: '结算' }
]

/** 操作日志 */
const actions = [
  ['登录系统', '系统'],
  ['创建合同', '合同管理'],
  ['提交合同审批', '合同管理'],
  ['新建运输计划', '运输计划'],
  ['下发调度单', '调度管理'],
  ['分配车辆司机', '调度管理'],
  ['确认装货', '场站管理'],
  ['过磅登记', '磅单记录'],
  ['确认卸货', '场站管理'],
  ['上报异常', '异常处理'],
  ['关闭异常单', '异常处理'],
  ['生成结算单', '结算管理'],
  ['确认对账', '结算管理'],
  ['开具发票', '发票管理'],
  ['导出磅单报表', '磅单记录'],
  ['修改用户权限', '系统管理']
]

db.logs = Array.from({ length: 80 }, (_, i) => {
  const [action, module] = actions[randInt(0, actions.length - 1)]
  const user = db.users[randInt(0, db.users.length - 1)]
  return {
    id: `LOG-${String(i + 1).padStart(5, '0')}`,
    time: dayjs(NOW).subtract(randInt(0, 7 * 24), 'hour').minute(randInt(0, 59)).second(randInt(0, 59)).format('YYYY-MM-DD HH:mm:ss'),
    user: user.name,
    username: user.username,
    action,
    module,
    ip: `192.168.${randInt(1, 20)}.${randInt(2, 254)}`,
    result: rng() < 0.96 ? 'success' : 'fail'
  }
})
db.logs.sort((a, b) => (a.time < b.time ? 1 : -1))
