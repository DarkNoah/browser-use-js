import logger from './logging_config';
import TurndownService from 'turndown';
import html2md from 'html-to-md'

/**
 * 记录异步函数执行时间的装饰器函数
 * @param label 日志标签
 */
export async function timeExecutionAsync<T>(
  fn: () => Promise<T>,
  label: string = 'execution'
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const end = Date.now();
    logger.debug(`${label} took ${end - start}ms`);
  }
}

/**
 * 记录同步函数执行时间的工具函数
 * @param fn 要执行的函数
 * @param label 日志标签
 */
export function timeExecutionSync<T>(
  fn: () => T,
  label: string = 'execution'
): T {
  const start = Date.now();
  try {
    return fn();
  } finally {
    const end = Date.now();
    logger.debug(`${label} took ${end - start}ms`);
  }
}

/**
 * 安全解析JSON字符串
 * @param jsonString JSON字符串
 * @param defaultValue 解析失败时的默认值
 */
export function safeJsonParse<T>(jsonString: string, defaultValue: T): T {
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    logger.error(`Failed to parse JSON: ${error}`);
    return defaultValue;
  }
}

/**
 * 延迟指定的毫秒数
 * @param ms 毫秒数
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 深度合并对象
 * @param target 目标对象
 * @param source 源对象
 */
export function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      const targetValue = (target as any)[key];
      const sourceValue = (source as any)[key];
      
      if (isObject(sourceValue) && targetValue && isObject(targetValue)) {
        (result as any)[key] = deepMerge(targetValue, sourceValue);
      } else if (sourceValue !== undefined) {
        (result as any)[key] = sourceValue;
      }
    });
  }
  
  return result;
}

/**
 * 检查值是否是对象
 * @param value 要检查的值
 */
function isObject(value: any): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 将HTML转换为Markdown
 * @param html 要转换的HTML字符串
 * @param options Turndown服务选项
 * @returns 转换后的Markdown字符串
 */
export function convertHtmlToMarkdown(html: string, options?: TurndownService.Options): string {
  try {

    // const dom = new JSDOM(html);
    // const reader = new Readability(dom.window.document);
    // const result = reader.parse();
    // console.log(result);
    // return result?.textContent || '';
    return html2md(html,{skipTags:[
      'div',
      'html',
      'body',
      'nav',
      'section',
      'footer',
      'main',
      'aside',
      'article',
      'header',
      'img'
    ],});
    const turndownService = new TurndownService(options);
    return turndownService.turndown(html);
  } catch (error) {
    logger.error(`转换HTML到Markdown时出错: ${error}`);
    return html; // 如果转换失败，返回原始HTML
  }
} 