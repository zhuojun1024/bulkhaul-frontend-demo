/**
 * 一次性工具：dump-schema.json → Flyway V1__init.sql
 * 类型推断规则：
 *  - array/object → JSON（MySQL 8 原生 JSON 列）
 *  - string 且样例匹配日期 → DATE / DATETIME
 *  - number → 金额类字段（配置表）DECIMAL(16,2)；整数类 INT；其余 DECIMAL(14,3)
 *  - string → VARCHAR(255)（样例超长的升 TEXT）
 * 运行：node scripts/gen-ddl.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const schema = JSON.parse(readFileSync(new URL('./dump-schema.json', import.meta.url), 'utf8'))

// 金额字段（业务上必须 DECIMAL 精确）
const MONEY = new Set([
  'price', 'creditLimit', 'totalBusiness', 'amount', 'unitPrice',
  'grossWeight', 'tareWeight', 'netWeight', 'quantity', 'weight',
  'paid', 'unpaid', 'balance', 'amountDue', 'amountReceived',
  'cost', 'fee', 'totalFee', 'discount', 'deduction', 'loss', 'profit',
  'unitCost', 'totalCost', 'payable', 'received', 'used', 'available',
  'settleAmount', 'settleQty', 'planQty', 'execQty', 'settledQty',
  'claimAmount', 'paidAmount', 'premium', 'monthlyCost', 'freight',
  'totalAmount', 'prepayAmount', 'deductAmount', 'fine', 'reward',
  'loadingFee', 'unloadingFee', 'lossDeduction', 'qualityDeduction', 'tollFee', 'surcharge',
])
// 整数类数值字段
const INTS = new Set([
  'capacity', 'mileage', 'totalTrips', 'totalMileage', 'paymentDays',
  'todayThroughput', 'queueVehicles', 'version', 'count', 'seq',
  'totalVolume', 'stockQty', 'lockedQty', 'minQty', 'qty', 'rounds',
  'level', 'priority', 'days', 'hours', 'limit', 'delayMinutes',
  'deviateLimit', 'exceptionHours', 'contractHours', 'distance',
  'dispatchCount', 'participants', 'userCount',
])
// 小数比率类
const RATIO = new Set(['density', 'rating', 'variance', 'ratio', 'rate', 'progress', 'score'])
// 长文本类
const TEXTS = new Set(['content', 'description', 'handling'])
// 特殊字段（无法从样例推断）
const SPECIAL = { eta: 'DATETIME' }
// 可空字段（种子中可能为 null；dump 只记录首个非空样例的类型，无法自动识别）
const NULLABLE = new Set([
  'customerId', 'driverId', 'lastLogin', 'email', 'warehouseId',
  'contractId', 'rejectReason', 'accidentId', 'settlementId',
  'matchTime', 'matchBy', 'exceptionId', 'policyNo', 'insurer',
  'settledAt', 'paidDate', 'to',
])

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/

function snake(name) {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase()
}

function inferType(field, meta) {
  if (SPECIAL[field]) return SPECIAL[field]
  const types = meta.types
  const sample = meta.sample
  if (types.includes('array') || types.includes('object')) return 'JSON'
  if (types.includes('number')) {
    if (MONEY.has(field)) return 'DECIMAL(16,2)'
    if (INTS.has(field)) return 'INT'
    if (RATIO.has(field)) return 'DECIMAL(5,3)'
    // 兜底：样例是整数且 >100 用 INT，否则 DECIMAL
    const n = typeof sample === 'number' ? sample : 0
    if (Number.isInteger(n) && Math.abs(n) > 100) return 'INT'
    return 'DECIMAL(14,3)'
  }
  if (types.includes('string')) {
    const s = String(sample ?? '')
    if (DATETIME_RE.test(s)) return 'DATETIME'
    if (DATE_RE.test(s)) return 'DATE'
    if (TEXTS.has(field)) return 'TEXT'
    if (s.length > 255) return 'TEXT'
    return 'VARCHAR(255)'
  }
  if (types.includes('boolean')) return 'TINYINT'
  return 'VARCHAR(255)'
}

// 表名映射（集合名 → 表名）
const TABLE_NAMES = {
  commodities: 'commodity', customers: 'customer', terminals: 'terminal',
  vehicles: 'vehicle', drivers: 'driver', contracts: 'contract',
  transportRequests: 'transport_request', plans: 'transport_plan',
  dispatches: 'dispatch', weighings: 'weighing', warehouses: 'warehouse',
  inventories: 'inventory', settlements: 'settlement', payments: 'payment',
  prepayments: 'prepayment', payables: 'payable', dunnings: 'dunning',
  bankRecords: 'bank_record', invoices: 'invoice', messages: 'message',
  exceptions: 'exception', accidents: 'accident', trainings: 'training',
  inspections: 'inspection', users: 'sys_user', roles: 'sys_role',
  safetyStocks: 'safety_stock', rateCards: 'rate_card', insurance: 'insurance_claim',
  logs: 'op_log', announcements: 'announcement',
}

// 空集合（运行时才产生）：按 flow.js 语义补字段
const EMPTY_TABLES = {
  payables: [
    ['id', 'VARCHAR(32)'], ['dispatchId', 'VARCHAR(32)'], ['driverId', 'VARCHAR(32)'],
    ['vehicleId', 'VARCHAR(32)'], ['commodityId', 'VARCHAR(32)'],
    ['tripFee', 'DECIMAL(16,2)'], ['freight', 'DECIMAL(16,2)'], ['totalAmount', 'DECIMAL(16,2)'],
    ['status', 'VARCHAR(32)'], ['dueDate', 'DATE'], ['paidDate', 'DATETIME'],
    ['remark', 'VARCHAR(255)'],
  ],
  dunnings: [
    ['id', 'VARCHAR(32)'], ['settlementId', 'VARCHAR(32)'], ['customerId', 'VARCHAR(32)'],
    ['roundNo', 'INT'], ['level', 'VARCHAR(32)'], ['amount', 'DECIMAL(16,2)'],
    ['sentAt', 'DATETIME'], ['dueDate', 'DATE'], ['remark', 'VARCHAR(255)'],
  ],
  insurance: [
    ['id', 'VARCHAR(32)'], ['accidentId', 'VARCHAR(32)'], ['exceptionId', 'VARCHAR(32)'],
    ['policyNo', 'VARCHAR(64)'], ['insurer', 'VARCHAR(128)'], ['claimAmount', 'DECIMAL(16,2)'],
    ['liability', 'VARCHAR(64)'], ['status', 'VARCHAR(32)'],
    ['reportedAt', 'DATETIME'], ['settledAt', 'DATETIME'], ['remark', 'VARCHAR(255)'],
  ],
}

// 对象型集合 → 单行配置表（字段类型硬编码，dump 中对象 sample 为字符串无法推断）
const CONFIG_TABLES = {
  fenceConfig: [['enabled', 'TINYINT'], ['deviateLimit', 'INT'], ['delayMinutes', 'INT']],
  escalateConfig: [['exceptionHours', 'INT'], ['contractHours', 'INT']],
}

let sql = '-- 大宗物流综合管理平台 初始化表结构（从前端种子数据 dump-schema.json 反推）\n'
sql += '-- 生成工具：scripts/gen-ddl.mjs；复核后手工微调金额/日期精度\n\n'
sql += 'SET NAMES utf8mb4;\n\n'

const summary = []

for (const [coll, meta] of Object.entries(schema)) {
  const table = TABLE_NAMES[coll]
  if (!table) {
    if (CONFIG_TABLES[coll]) {
      const tbl = coll === 'fenceConfig' ? 'fence_config' : 'escalate_config'
      const cols = CONFIG_TABLES[coll].map(([f, t]) => `  \`${f}\` ${t}`)
      sql += `CREATE TABLE \`${tbl}\` (\n  id INT PRIMARY KEY DEFAULT 1,\n${cols.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`
      summary.push(`${tbl}: config(${CONFIG_TABLES[coll].map((c) => c[0]).join(',')})`)
    }
    continue
  }

  const hasFields = meta.fields && Object.keys(meta.fields).length > 0
  const fields = hasFields ? meta.fields : Object.fromEntries((EMPTY_TABLES[coll] || []).map(([f, t]) => [f, { types: ['x'], sample: '', _t: t }]))
  const lines = []
  const idxLines = []
  for (const [f, m] of Object.entries(fields)) {
    const col = snake(f)
    if (col === 'created_at' || col === 'updated_at') continue // 统一由框架列提供
    let type = m._t || inferType(f, m)
    let nullFlag = (m.types.includes('null') || NULLABLE.has(f)) ? 'NULL' : 'NOT NULL'
    let def = ''
    if (f === 'id') {
      lines.push(`  \`${col}\` VARCHAR(32) NOT NULL COMMENT '业务ID（前缀+序列，删除不复用）'`)
      continue
    }
    if (type === 'JSON') { nullFlag = 'NULL'; def = '' }
    else if (type === 'VARCHAR(255)') { def = " DEFAULT ''" }
    else if (type === 'TEXT') { nullFlag = 'NULL' }
    else if (type === 'DECIMAL(16,2)' || type === 'DECIMAL(14,3)' || type === 'DECIMAL(10,2)' || type === 'DECIMAL(5,3)') { def = ' DEFAULT 0' }
    else if (type === 'INT') { def = ' DEFAULT 0' }
    else if (type === 'DATE' || type === 'DATETIME') { nullFlag = 'NULL' }
    else if (type === 'TINYINT') { def = ' DEFAULT 0' }
    lines.push(`  \`${col}\` ${type} ${nullFlag}${def}`)
    // 外键式字段加索引
    if (/^VARCHAR\(32\)$/.test(type) && /Id$/.test(f)) idxLines.push(`  KEY \`idx_${col}\` (${col})`)
  }
  lines.push(`  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
  lines.push(`  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`)
  if (table === 'op_log') lines.splice(lines.length - 2, 0, `  \`detail\` TEXT NULL COMMENT '操作详情（logAction detail 字段）'`)
  lines.push(`  PRIMARY KEY (\`id\`)`)
  for (const i of idxLines) lines.push(i)
  sql += `CREATE TABLE \`${table}\` (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`
  summary.push(`${table}(${meta.size ?? 0}): ` + Object.entries(fields).map(([f, m]) => `${f}:${m._t || inferType(f, m)}`).join(' '))
}

// 角色权限表（rolePerms 对象：角色名 → {menus, actions}，null=全部）
sql += `CREATE TABLE \`sys_role_perm\` (
  \`id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`role_name\` VARCHAR(64) NOT NULL,
  \`menus\` JSON NULL COMMENT 'null=全部菜单，[]=无',
  \`actions\` JSON NULL COMMENT 'null=全部操作码，[]=无',
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uk_role\` (\`role_name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`
// 消息免打扰 / 数据权限（按 username 的 KV）
sql += `CREATE TABLE \`user_dnd\` (
  \`username\` VARCHAR(64) PRIMARY KEY,
  \`enabled\` TINYINT NOT NULL DEFAULT 0,
  \`quiet_start\` VARCHAR(8) NOT NULL DEFAULT '22:00',
  \`quiet_end\` VARCHAR(8) NOT NULL DEFAULT '08:00',
  \`muted_types\` JSON NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`
sql += `CREATE TABLE \`user_data_scope\` (
  \`username\` VARCHAR(64) PRIMARY KEY,
  \`regions\` JSON NULL COMMENT '空/缺省=全量数据'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`

writeFileSync(new URL('./V1__init.sql', import.meta.url), sql)
console.log(sql.split('\n').length, 'lines SQL')
console.log('===== 类型映射复核 =====')
for (const s of summary) console.log(s)
