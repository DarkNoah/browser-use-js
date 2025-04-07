import fs from 'fs';
import { BrowserStateHistory } from '../browser/views';
import path from 'path';
import { ActionModel } from '../controller/registry/views';
import z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class AgentStepInfo {
  stepNumber: number;
  maxSteps: number;
  constructor(stepNumber: number, maxSteps: number) {
    this.stepNumber = stepNumber;
    this.maxSteps = maxSteps;
  }
}

/**
 * 动作结果
 * 描述一个动作的执行结果
 */
export class ActionResult {
  /**
   * 提取的内容
   */
  extractedContent?: string;
  
  /**
   * 错误信息
   */
  error?: string;
  
  /**
   * 是否任务完成
   */
  isDone?: boolean = false;
  
  /**
   * 是否将结果包含在记忆中
   */
  includeInMemory: boolean = true;
  
  /**
   * 创建ActionResult实例
   */
  constructor(init?: Partial<ActionResult>) {
    Object.assign(this, init);
  }
}









/**
 * 代理大脑
 */
export interface AgentBrain {
  /**
   * 页面摘要
   */
  page_summary: string;

  /**
   * 上一个目标的评估
   */
  evaluation_previous_goal: string;

  /**
   * 记忆
   */
  memory: string;

  /**
   * 下一个目标
   */
  next_goal: string;
}

/**
 * 代理输出
 */
export interface AgentOutput {
  /**
   * 当前状态
   */
  current_state: AgentBrain;

  /**
   * 动作列表
   */
  action: ActionModel[];
}

/**
 * 代理输出静态方法
 */
export namespace AgentOutput {

  export function typeWithCustomActions(customActions: any): any {
    // TypeScript实现会有所不同，这里只是占位
    return AgentOutput;
  }
  export function getSchema(actionModel: any) { 

    const actionModelSchema =  z.object({
      'current_state': z.object({
        'page_summary': z.string(),
        'evaluation_previous_goal': z.string(),
        'memory': z.string(),
        'next_goal': z.string()
      }),
      'action': z.array(z.object(actionModel))
    });

    const jsonSchema = zodToJsonSchema(actionModelSchema);

    return actionModelSchema;
  }
}


/**
 * 代理历史记录
 */
export interface AgentHistory {
  /**
   * 模型输出
   */
  modelOutput?: AgentOutput;
  
  /**
   * 结果列表
   */
  result: ActionResult[];
  
  /**
   * 浏览器状态历史
   */
  state: BrowserStateHistory;
}

/**
 * 代理历史静态方法
 */
export namespace AgentHistory {
  /**
   * 获取交互的元素
   * @param modelOutput 模型输出
   * @param selectorMap 选择器映射
   */
  export function getInteractedElement(modelOutput: AgentOutput, selectorMap: any): any[] {
    const elements = [];
    for (const action of modelOutput.action) {
      const index = action.getIndex();
      if (index && index in selectorMap) {
        const el = selectorMap[index];
        elements.push(el); // 简化实现
      } else {
        elements.push(null);
      }
    }
    return elements;
  }

  /**
   * 导出模型数据
   */
  export function modelDump(history: AgentHistory): Record<string, any> {
    let modelOutputDump = null;
    if (history.modelOutput) {
      const actionDump = history.modelOutput.action.map(action => {
        return {...action}
      });
      
      modelOutputDump = {
        current_state: history.modelOutput.current_state,
        action: actionDump
      };
    }

    return {
      modelOutput: modelOutputDump,
      result: history.result.map(r => ({ ...r })),
      state: history.state.toDict()
    };
  }
}

/**
 * 代理历史记录列表
 */
export class AgentHistoryList {
  /**
   * 历史记录
   */
  history: AgentHistory[] = [];
  
  /**
   * 创建AgentHistoryList实例
   * @param init 初始值
   */
  constructor(init?: Partial<AgentHistoryList>) {
    Object.assign(this, init || {});
  }

  /**
   * 字符串表示
   */
  toString(): string {
    return `AgentHistoryList(allResults=${this.actionResults()}, allModelOutputs=${this.modelActions()})`;
  }

  /**
   * 保存到文件
   * @param filepath 文件路径
   */
  saveToFile(filepath: string): void {
    try {
      // 确保父目录存在
      const dirPath = path.dirname(filepath);
      if (dirPath && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      // 导出模型数据
      const data = this.modelDump();
      
      // 写入文件
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      throw e;
    }
  }

  /**
   * 导出模型数据
   */
  modelDump(): any {
    return {
      history: this.history.map(h => {
        return AgentHistory.modelDump(h);
      })
    };
  }

  /**
   * 从文件加载
   * @param filepath 文件路径
   * @param outputModel 输出模型类型
   */
  static loadFromFile(filepath: string, outputModel: any): AgentHistoryList {
    try {
      // 从文件读取JSON数据

      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      
      // 遍历历史记录并验证输出模型动作，以丰富自定义动作
      for (const h of data.history) {
        if (h.modelOutput) {
          if (typeof h.modelOutput === 'object') {
            // 使用输出模型验证数据
            h.modelOutput = new outputModel(h.modelOutput);
          } else {
            h.modelOutput = null;
          }
        }
        
        // 确保state中包含interactedElement字段
        if (!('interactedElement' in h.state)) {
          h.state.interactedElement = null;
        }
      }
      
      // 创建并返回一个新的AgentHistoryList实例
      return new AgentHistoryList(data);
    } catch (error) {
      console.error(`加载历史记录失败: ${error}`);
      throw error;
    }
  }

  /**
   * 获取最后一个动作
   */
  lastAction(): any | undefined {
    if (this.history.length > 0 && this.history[this.history.length - 1].modelOutput) {
      const actions = this.history[this.history.length - 1].modelOutput!.action;
      if (actions.length > 0) {
        const lastAction = actions[actions.length - 1];
        return (lastAction as any).modelDump 
          ? (lastAction as any).modelDump({ excludeNone: true }) 
          : lastAction;
      }
    }
    return undefined;
  }

  /**
   * 获取所有错误
   */
  errors(): string[] {
    const errors: string[] = [];
    for (const h of this.history) {
      for (const r of h.result) {
        if (r.error) {
          errors.push(r.error);
        }
      }
    }
    return errors;
  }

  /**
   * 获取最终结果
   */
  finalResult(): string | undefined {
    if (this.history.length > 0) {
      const lastHistory = this.history[this.history.length - 1];
      if (lastHistory.result.length > 0) {
        const lastResult = lastHistory.result[lastHistory.result.length - 1];
        return lastResult.extractedContent || undefined;
      }
    }
    return undefined;
  }

  /**
   * 是否完成
   */
  isDone(): boolean {
    if (this.history.length > 0) {
      const lastHistory = this.history[this.history.length - 1];
      if (lastHistory.result.length > 0) {
        return !!lastHistory.result[lastHistory.result.length - 1].isDone;
      }
    }
    return false;
  }

  /**
   * 是否有错误
   */
  hasErrors(): boolean {
    return this.errors().length > 0;
  }

  /**
   * 获取所有URL
   */
  urls(): string[] {
    return this.history
      .filter(h => h.state.url)
      .map(h => h.state.url as string);
  }

  /**
   * 获取所有截图
   */
  screenshots(): string[] {
    return this.history
      .filter(h => h.state.screenshot)
      .map(h => h.state.screenshot as string);
  }

  /**
   * 获取所有动作名称
   */
  actionNames(): string[] {
    const actionNames: string[] = [];
    const actions = this.modelActions();
    
    for (const action of actions) {
      const keys = Object.keys(action);
      if (keys.length > 0) {
        actionNames.push(keys[0]);
      }
    }
    
    return actionNames;
  }

  /**
   * 获取所有模型思考
   */
  modelThoughts(): AgentBrain[] {
    return this.history
      .filter(h => h.modelOutput)
      .map(h => h.modelOutput!.current_state);
  }

  /**
   * 获取所有模型输出
   */
  modelOutputs(): AgentOutput[] {
    return this.history
      .filter(h => h.modelOutput)
      .map(h => h.modelOutput!);
  }

  /**
   * 获取所有模型动作
   */
  modelActions(): any[] {
    const outputs: any[] = [];
    
    for (const h of this.history) {
      if (h.modelOutput) {
        for (let i = 0; i < h.modelOutput.action.length; i++) {
          const action = h.modelOutput.action[i];
          const interactedElement = h.state.interactedElement && h.state.interactedElement[i];
          
          let output: any = {...action};
            
          output.interactedElement = interactedElement;
          outputs.push(output);
        }
      }
    }
    
    return outputs;
  }

  /**
   * 获取所有动作结果
   */
  actionResults(): ActionResult[] {
    const results: ActionResult[] = [];
    for (const h of this.history) {
      results.push(...h.result.filter(r => r));
    }
    return results;
  }

  /**
   * 获取所有提取的内容
   */
  extractedContent(): string[] {
    const content: string[] = [];
    for (const h of this.history) {
      content.push(
        ...h.result
          .filter(r => r.extractedContent)
          .map(r => r.extractedContent as string)
      );
    }
    return content;
  }

  /**
   * 获取过滤后的模型动作
   * @param include 包含的动作类型
   */
  modelActionsFiltered(include: string[] = []): any[] {
    const outputs = this.modelActions();
    const result: any[] = [];
    
    for (const o of outputs) {
      const keys = Object.keys(o);
      if (keys.length > 0) {
        for (const i of include) {
          if (i === keys[0]) {
            result.push(o);
          }
        }
      }
    }
    
    return result;
  }
} 


/**
 * 代理错误
 */
export class AgentError extends Error {
  /**
   * 验证错误信息
   */
  static VALIDATION_ERROR = '无效的模型输出格式。请遵循正确的架构。';

  /**
   * 速率限制错误信息
   */
  static RATE_LIMIT_ERROR = '已达到速率限制。等待重试中。';

  /**
   * 无有效动作错误信息
   */
  static NO_VALID_ACTION = '未找到有效动作';

  /**
   * 创建AgentError实例
   * @param message 错误信息
   */
  constructor(message: string) {
    super(message);
    this.name = 'AgentError';
  }

  /**
   * 格式化错误信息
   * @param error 错误对象
   * @param includeTrace 是否包含堆栈跟踪
   */
  static formatError(error: Error, includeTrace: boolean = false): string {
    if (error.name === 'ValidationError') {
      return `${AgentError.VALIDATION_ERROR}\n详情: ${error.message}`;
    }
    if (error.name === 'RateLimitError') {
      return AgentError.RATE_LIMIT_ERROR;
    }
    if (includeTrace) {
      return `${error.message}\n堆栈跟踪:\n${error.stack}`;
    }
    return `${error.message}`;
  }
}