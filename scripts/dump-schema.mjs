/**
 * 一次性工具：dump 种子数据各集合的字段结构（字段名 + 值类型 + 样例值）
 * 用途：反推后端 MySQL DDL（docs/backend-plan.md 阶段 1）
 * 运行：node --import ./scripts/register.mjs scripts/dump-schema.mjs
 */
import { db } from '../src/data/index.js'
import { writeFileSync } from 'node:fs'

function typeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return 'object'
  return typeof v
}

const out = {}
for (const [key, val] of Object.entries(db)) {
  if (Array.isArray(val)) {
    if (!val.length) {
      out[key] = { kind: 'array', size: 0, fields: [] }
      continue
    }
    const fields = {}
    for (const item of val) {
      for (const [f, v] of Object.entries(item)) {
        const t = typeOf(v)
        if (!fields[f]) fields[f] = { types: new Set(), sample: v }
        fields[f].types.add(t)
      }
    }
    out[key] = {
      kind: 'array',
      size: val.length,
      fields: Object.fromEntries(
        Object.entries(fields).map(([f, m]) => [f, { types: [...m.types].sort(), sample: m.sample }])
      )
    }
  } else if (typeof val === 'object' && val !== null) {
    // rolePerms / dnd / dataScopes / fenceConfig / escalateConfig
    out[key] = { kind: 'object', sample: JSON.parse(JSON.stringify(val)).toString().slice(0, 200) }
  }
}

const text = JSON.stringify(out, null, 2)
writeFileSync(new URL('./dump-schema.json', import.meta.url), text)
console.log('collections:', Object.keys(out).length)
for (const [k, v] of Object.entries(out)) {
  console.log(`${k.padEnd(18)} ${v.kind.padEnd(6)} size=${v.size ?? '-'} fields=${v.fields ? Object.keys(v.fields).length : '-'}`)
}
