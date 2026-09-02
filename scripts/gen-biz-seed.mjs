/**
 * 一次性工具：dump 全量种子数据 → 生成 V3__biz_tables.sql（biz_* 表 + 种子）
 * 策略：每个集合一张 biz_<coll> 表（id 标量 + payload JSON 整条记录）
 * 运行：node --import ./scripts/register.mjs scripts/gen-biz-seed.mjs
 */
import { db } from '../src/data/index.js'
import { writeFileSync } from 'node:fs'

const COLL = [
  'commodities','customers','terminals','vehicles','drivers','contracts','transportRequests',
  'plans','dispatches','weighings','warehouses','inventories','settlements','payments',
  'prepayments','payables','dunnings','bankRecords','invoices','messages','exceptions',
  'accidents','trainings','inspections','rateCards','insurance','safetyStocks','users','roles',
]
// 对象型（非数组）集合：rolePerms / fenceConfig / escalateConfig / dnd / dataScopes
// 注：业务逻辑读 biz_users/biz_roles（mock 原样，含明文 password 字段，与前端同态）；
//     sys_user/sys_role（V2，bcrypt）仅服务鉴权层 AuthService，两套数据同源（均 dump 自 mock）。
const OBJ = ['rolePerms','fenceConfig','escalateConfig','dnd','dataScopes']

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''")

let sql = '-- 业务数据表 + 种子（整条记录 JSON payload，与前端 mock 同态）\n'
sql += 'SET NAMES utf8mb4;\n\n'

for (const c of COLL) {
  sql += `DROP TABLE IF EXISTS \`biz_${c}\`;\n`
  sql += `CREATE TABLE \`biz_${c}\` (\n  \`id\` VARCHAR(64) NOT NULL,\n  \`payload\` JSON NOT NULL,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`
  const rows = db[c] || []
  for (const r of rows) {
    const id = r.id
    const payload = JSON.stringify(r)
    sql += `INSERT INTO \`biz_${c}\` (\`id\`, \`payload\`) VALUES ('${esc(id)}', '${esc(payload)}');\n`
  }
}

// 对象型集合 → 单行 KV 表
for (const c of OBJ) {
  sql += `DROP TABLE IF EXISTS \`biz_${c}\`;\n`
  sql += `CREATE TABLE \`biz_${c}\` (\n  \`id\` VARCHAR(64) NOT NULL,\n  \`payload\` JSON NOT NULL,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;\n\n`
  const val = db[c]
  sql += `INSERT INTO \`biz_${c}\` (\`id\`, \`payload\`) VALUES ('${c}', '${esc(JSON.stringify(val))}');\n`
}

writeFileSync(new URL('./V3__biz_tables.sql', import.meta.url), sql)
const counts = COLL.map(c => `${c}=${(db[c]||[]).length}`).join(' ')
console.log('collections:', COLL.length, '+ obj:', OBJ.length)
console.log(counts)
console.log('bytes:', sql.length)
