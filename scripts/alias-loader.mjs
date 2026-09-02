/** 临时测试用：解析 @/ 别名与无扩展名相对导入（Node ESM 兼容 webpack 风格） */
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ALIASES = {
  '@/utils': '../src/utils/index.js',
  '@/data': '../src/data/index.js',
  '@/store': '../src/store/index.js',
  '@/permission': '../src/permission.js',
  '@/permission-table': '../src/permission-table.js'
}

/** @/ 子路径别名：@/data/derived → src/data/derived(.js | /index.js)；@/api → src/api/index.js（目录型模块） */
function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}
function resolveAtSubpath(specifier) {
  const rel = '../src/' + specifier.slice(2)
  // 文件候选优先：裸路径可能是目录（如 src/api），existsSync 对目录为 true 会导致 EISDIR
  for (const cand of [rel + '.js', rel + '/index.js', rel]) {
    const u = new URL(cand, import.meta.url).href
    if (isFile(fileURLToPath(u))) return u
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (ALIASES[specifier]) {
    return { url: new URL(ALIASES[specifier], import.meta.url).href, shortCircuit: true }
  }
  if (specifier.startsWith('@/')) {
    const url = resolveAtSubpath(specifier)
    if (url) return { url, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.js')) {
    try {
      return await nextResolve(specifier + '.js', context)
    } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
}
