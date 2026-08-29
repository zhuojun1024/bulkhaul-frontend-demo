/**
 * 一次性工具：dump 鉴权相关种子数据 → V2__seed_auth.sql
 * 内容：sys_user（98 账号，密码统一 123456 的 bcrypt 哈希占位 __BCRYPT__）
 *      sys_role / sys_role_perm / user_data_scope / fence_config / escalate_config
 * 运行：node --import ./scripts/register.mjs scripts/gen-seed-auth.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../src/mock/index.js'

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "''")
const sql = (v) => v === null || v === undefined ? 'NULL' : `'${esc(v)}'`

let out = '-- 鉴权种子数据（从前端 mock 种子 dump，密码统一 123456）\n'
out += '-- bcrypt 哈希由 __BCRYPT__ 占位，构建时替换\n\n'

// 用户
out += 'INSERT INTO `sys_user` (`id`,`username`,`name`,`role`,`password_hash`,`phone`,`email`,`status`,`last_login`,`created_at`,`customer_id`,`driver_id`) VALUES\n'
const userRows = db.users.map((u) =>
  `('${esc(u.id)}',${sql(u.username)},${sql(u.name)},${sql(u.role)},'__BCRYPT__',${sql(u.phone)},${sql(u.email)},${sql(u.status)},${sql(u.lastLogin)},${sql(u.createdAt)},${sql(u.customerId)},${sql(u.driverId)})`)
out += userRows.join(',\n') + ';\n\n'

// 角色
out += 'INSERT INTO `sys_role` (`id`,`name`,`code`,`user_count`,`description`,`built_in`) VALUES\n'
const roleRows = db.roles.map((r) =>
  `('${esc(r.id)}',${sql(r.name)},${sql(r.code)},${r.userCount},${sql(r.description)},${r.builtIn ? 1 : 0})`)
out += roleRows.join(',\n') + ';\n\n'

// 角色权限（actions: null=全部 / []=无 / [..]=列表）
out += 'INSERT INTO `sys_role_perm` (`role_name`,`menus`,`actions`) VALUES\n'
const permRows = Object.entries(db.rolePerms).map(([role, p]) => {
  const menus = p.menus === null ? 'NULL' : JSON.stringify(p.menus)
  const actions = p.actions === null ? 'NULL' : JSON.stringify(p.actions)
  return `(${sql(role)},${menus === 'NULL' ? 'NULL' : sql(menus)},${actions === 'NULL' ? 'NULL' : sql(actions)})`
})
out += permRows.join(',\n') + ';\n\n'

// 数据范围
out += 'INSERT INTO `user_data_scope` (`username`,`regions`) VALUES\n'
const scopeRows = Object.entries(db.dataScopes || {}).map(([u, s]) => `(${sql(u)},${s.regions ? sql(JSON.stringify(s.regions)) : 'NULL'})`)
out += scopeRows.join(',\n') + ';\n\n'

// 配置
const fc = db.fenceConfig, ec = db.escalateConfig
out += `INSERT INTO \`fence_config\` (id, enabled, deviateLimit, delayMinutes) VALUES (1, ${fc.enabled ? 1 : 0}, ${fc.deviateLimit}, ${fc.delayMinutes});\n`
out += `INSERT INTO \`escalate_config\` (id, exceptionHours, contractHours) VALUES (1, ${ec.exceptionHours}, ${ec.contractHours});\n`

writeFileSync(new URL('./V2__seed_auth.sql', import.meta.url), out)
console.log('users:', db.users.length, 'roles:', db.roles.length, 'perms:', Object.keys(db.rolePerms).length)
console.log('fenceConfig:', JSON.stringify(fc), 'escalateConfig:', JSON.stringify(ec))
