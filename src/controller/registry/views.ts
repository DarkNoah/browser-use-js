import { z } from 'zod';

/**
 * 动作注册表视图模型
 * 用于表示动作和其参数模型
 */

/**
 * 已注册动作的模型
 */
export interface RegisteredAction {
  name: string;
  description: string;
  function: Function;
  paramModel: any;
  schema: z.ZodSchema;
}

/**
 * 获取动作的提示描述
 * @param action 已注册动作
 * @returns 动作的描述文本
 */
export function getPromptDescription(action: RegisteredAction): string {
  const skipKeys = ['title'];
  let s = `${action.description}: \n`;
  s += '{' + action.name + ': ';
  
  // 构建参数schema描述
  if (action.paramModel?.schema) {
    const schema = action.paramModel.schema();
    const properties = schema.properties || {};
    
    const filteredProps = Object.entries(properties).reduce((acc, [k, v]) => {
      acc[k] = Object.entries(v as any).reduce((propAcc, [subK, subV]) => {
        if (!skipKeys.includes(subK)) {
          propAcc[subK] = subV;
        }
        return propAcc;
      }, {} as Record<string, any>);
      return acc;
    }, {} as Record<string, any>);
    
    s += JSON.stringify(filteredProps);
  }
  
  s += '}';
  return s;
}

/**
 * 动作模型基类
 * 为动态创建的动作模型提供基础
 */
export class ActionModel {
  [key: string]: any;
  
  /**
   * 获取动作的索引
   * @returns 索引值或undefined
   */
  getIndex(): number | undefined {
    // 获取所有设置的参数
    const params = this.getParams();
    if (!params) {
      return undefined;
    }
    
    // 查找包含index的参数
    for (const param of Object.values(params)) {
      if (param && typeof param === 'object' && 'index' in param) {
        return param.index;
      }
    }
    
    return undefined;
  }
  
  /**
   * 设置动作的索引
   * @param index 索引值
   */
  setIndex(index: number): void {
    // 获取动作名称和参数
    const params = this.getParams();
    if (!params) {
      return;
    }
    
    const actionName = Object.keys(params)[0];
    const actionParams = this[actionName];
    
    // 更新索引
    if (actionParams && typeof actionParams === 'object' && 'index' in actionParams) {
      actionParams.index = index;
    }
  }
  
  /**
   * 获取模型的参数
   */
  private getParams(): Record<string, any> | undefined {
    const result: Record<string, any> = {};
    let hasParams = false;
    
    for (const key in this) {
      if (this[key] !== undefined && typeof key === 'string' && !key.startsWith('_')) {
        result[key] = this[key];
        hasParams = true;
      }
    }
    
    return hasParams ? result : undefined;
  }
}

/**
 * 动作注册表
 * 管理所有已注册的动作
 */
export class ActionRegistry {
  actions: Record<string, RegisteredAction> = {};
  
  /**
   * 获取所有动作的提示描述
   * @returns 所有动作的描述文本
   */
  getPromptDescription(): string {
    return Object.values(this.actions)
      .map(action => getPromptDescription(action))
      .join('\n');
  }
}
