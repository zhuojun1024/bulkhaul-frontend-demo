import { db, NOW } from './base'
import { toRoles } from './flow'
import dayjs from 'dayjs'

/**
 * 消息中心种子（G6）：按当前业务状态派生，保证消息内容与数据一致
 * 运行期新消息由 flow.notify 写入（审批/调度/异常/结算/需求等事件）
 * M4 修复：种子消息同样按角色定向（to），与运行期 notify 口径一致
 */
const list = []
let seq = 0
function push(title, content, type, path, hoursAgo, read, to = null) {
  seq += 1
  list.push({
    id: `MSG-${String(seq).padStart(4, '0')}`,
    title,
    content,
    type,
    path,
    time: dayjs(NOW).subtract(hoursAgo, 'hour').format('YYYY-MM-DD HH:mm'),
    read: !!read,
    to: to || null
  })
}

// 待审批合同（定向：审批人 + 合同经办角色）
db.contracts
  .filter((c) => c.status === 'pending')
  .slice(0, 2)
  .forEach((c, i) =>
    push(`合同 ${c.id} 待审批`, `${c.name}，请及时处理（部门审批 → 公司审批）`, 'approval', '/contract', 2 + i * 3, i === 1, toRoles('contract-approve', 'contract'))
  )

// 逾期账单（定向：结算角色）
db.settlements
  .filter((s) => s.status === 'overdue')
  .slice(0, 2)
  .forEach((s, i) => {
    const c = db.customers.find((x) => x.id === s.customerId)
    push(
      `结算单 ${s.billNo} 已逾期`,
      `${c ? c.name : ''} 未付余额 ${s.totalAmount - s.paidAmount} 元，请跟进回款`,
      'settlement',
      '/settlement',
      5 + i * 4,
      i === 1,
      toRoles('settlement')
    )
  })

// 未关闭异常（定向：异常处理角色）
db.exceptions
  .filter((e) => e.status !== 'closed')
  .slice(0, 2)
  .forEach((e, i) => push(`异常单 ${e.id} 待处理`, e.description, 'exception', '/exception', 8 + i * 5, i === 1, toRoles('exception')))

// 在途车辆（定向：调度执行角色）
db.dispatches
  .filter((d) => d.status === 'intransit')
  .slice(0, 2)
  .forEach((d, i) => {
    const v = db.vehicles.find((x) => x.id === d.vehicleId)
    const t = db.terminals.find((x) => x.id === d.unloadTerminalId)
    push(
      `车辆 ${v ? v.plate : d.unitNo} 在途`,
      `调度单 ${d.id} 预计 ${d.eta} 到达${t ? t.name : '目的地'}`,
      'dispatch',
      '/dispatch',
      1 + i * 2,
      false,
      toRoles('dispatch')
    )
  })

// 待装货调度单（定向：调度执行角色）
const pendingCount = db.dispatches.filter((d) => d.status === 'pending').length
if (pendingCount) push(`${pendingCount} 张调度单待装货`, '请及时安排装货', 'dispatch', '/dispatch', 3, true, toRoles('dispatch'))

// 系统通知
push('平台系统通知', '新版磅单系统上线，请各场站操作员完成培训', 'system', '/terminal/weighing', 24, true)

// 按时间倒序；兜底保证至少一条未读（顶栏角标可演示）
list.sort((a, b) => (a.time < b.time ? 1 : -1))
if (list.length && !list.some((m) => !m.read)) list[0].read = false
db.messages = list
