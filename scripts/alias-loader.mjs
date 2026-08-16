/** 临时测试用：解析 @/ 别名与无扩展名相对导入（Node ESM 兼容 webpack 风格） */
const ALIASES = {
  '@/utils': '../src/utils/index.js',
  '@/mock': '../src/mock/index.js',
  '@/store': '../src/store/index.js',
  '@/permission': '../src/permission.js'
}

export async function resolve(specifier, context, nextResolve) {
  if (ALIASES[specifier]) {
    return { url: new URL(ALIASES[specifier], import.meta.url).href, shortCircuit: true }
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
