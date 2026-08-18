/** 临时测试用：解析 @/ 别名与无扩展名相对导入（Node ESM 兼容 webpack 风格） */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ALIASES = {
  '@/utils': '../src/utils/index.js',
  '@/mock': '../src/mock/index.js',
  '@/store': '../src/store/index.js',
  '@/permission': '../src/permission.js',
  '@/permission-table': '../src/permission-table.js'
}

/** @/ 子路径别名：@/mock/flow → src/mock/flow(.js | /index.js) */
function resolveAtSubpath(specifier) {
  const rel = '../src/' + specifier.slice(2)
  for (const cand of [rel, rel + '.js', rel + '/index.js']) {
    const u = new URL(cand, import.meta.url).href
    if (existsSync(fileURLToPath(u))) return u
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
