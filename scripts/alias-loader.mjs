/** 临时测试用：解析 @/utils 别名与无扩展名相对导入（Node ESM 兼容 webpack 风格） */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@/utils') {
    return { url: new URL('../src/utils/index.js', import.meta.url).href, shortCircuit: true }
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
