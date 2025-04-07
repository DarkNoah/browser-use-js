/**
 * 动作注册器
 * 管理所有可用的动作及其处理函数
 */
import logger from '../../utils/logging_config';
import { ActionRegistry, RegisteredAction, ActionModel } from './views';
import { ProductTelemetry } from '../../telemetry/service';
import { ControllerRegisteredFunctionsTelemetryEvent, BaseTelemetryEventImpl } from '../../telemetry/views';
import { BrowserContext } from '../../browser/context';
import z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * 动作处理函数类型
 */
type ActionHandler = (...args: any[]) => Promise<any>;

/**
 * 参数模型接口
 */
interface IActionModel {
  [key: string]: any;
}

/**
 * 动作注册器类
 * 管理所有可用的动作及其处理函数
 */
export class Registry {
  registry: ActionRegistry = new ActionRegistry();
  telemetry: ProductTelemetry = new ProductTelemetry();
  excludeActions: string[];

  /**
   * 创建Registry实例
   * @param excludeActions 要排除的动作列表
   */
  constructor(excludeActions: string[] = []) {
    this.excludeActions = excludeActions;
  }

  /**
   * 注册动作
   * @param description 动作描述
   * @param paramModel 参数模型
   */
  action(description: string, name:string,paramModel:any, schema: z.ZodSchema) {
    return (target: ActionHandler) => {

      
      // 检查是否排除此动作
      if (this.excludeActions.includes(name)) {
        logger.debug(`动作 ${name} 已被排除`);
        return target;
      }
      
      // 创建或使用参数模型
      const actualParamModel = paramModel || ActionModel;
      
      // 注册动作
      this.registry.actions[name] = {
        name,
        description,
        function: target,
        paramModel: actualParamModel,
        schema: schema
      };
      
      logger.debug(`注册动作: ${name}`);
      
      // 返回原始函数，保持不变
      return target;
    };
  }

  /**
   * 执行注册的动作
   * @param actionName 动作名称
   * @param params 参数对象
   * @param browser 浏览器上下文（可选）
   * @param pageExtractionLlm 页面提取LLM（可选）
   * @param sensitiveData 敏感数据（可选）
   * @param availableFilePaths 可用文件路径（可选）
   */
  async executeAction(
    actionName: string,
    params: any,
    browser?: BrowserContext,
    pageExtractionLlm?: any,
    sensitiveData?: Record<string, string>,
    availableFilePaths?: string[]
  ): Promise<any> {
    if (!this.registry.actions[actionName]) {
      throw new Error(`动作 ${actionName} 未找到`);
    }

    const action = this.registry.actions[actionName];
    try {
      // 验证参数
      const validatedParams = this.validateParams(params, action.paramModel);
      
      // 处理敏感数据替换
      if (sensitiveData) {
        this.replaceSensitiveData(validatedParams, sensitiveData);
      }

      // 准备额外参数
      const extraArgs: any = {};
      if (browser) extraArgs.browser = browser;
      if (pageExtractionLlm) extraArgs.pageExtractionLlm = pageExtractionLlm;
      if (availableFilePaths) extraArgs.availableFilePaths = availableFilePaths;
      if (actionName === 'inputText' && sensitiveData) {
        extraArgs.hasSensitiveData = true;
      }

      // 执行动作
      return await action.function(validatedParams, extraArgs);
    } catch (e: any) {
      throw new Error(`执行动作 ${actionName} 出错: ${e.message}`);
    }
  }

  /**
   * 验证参数
   * @param params 参数对象
   * @param model 参数模型
   */
  private validateParams(params: any, model: any): any {

    const schema = model.schema();
    const result = schema.safeParse(params)
    if(!result.success) {
      throw new Error(`参数验证失败: ${result.error.message}`);
    }
    // 简单实现，实际使用中可能需要更复杂的验证逻辑
    return result.data;
  }

  /**
   * 替换敏感数据
   * @param params 参数对象
   * @param sensitiveData 敏感数据映射
   */
  private replaceSensitiveData(params: any, sensitiveData: Record<string, string>): void {
    const secretPattern = /<secret>(.*?)<\/secret>/g;

    const replaceSecrets = (value: any): any => {
      if (typeof value === 'string') {
        let matches;
        let result = value;
        while ((matches = secretPattern.exec(value)) !== null) {
          const placeholder = matches[1];
          if (sensitiveData[placeholder]) {
            result = result.replace(`<secret>${placeholder}</secret>`, sensitiveData[placeholder]);
          }
        }
        return result;
      } else if (Array.isArray(value)) {
        return value.map(v => replaceSecrets(v));
      } else if (value && typeof value === 'object') {
        const result: any = {};
        for (const [k, v] of Object.entries(value)) {
          result[k] = replaceSecrets(v);
        }
        return result;
      }
      return value;
    };

    for (const [key, value] of Object.entries(params)) {
      params[key] = replaceSecrets(value);
    }
  }


  createActionModel(): typeof ActionModel {
    // 收集已注册动作的元数据用于遥测
    const registeredFunctions = Object.entries(this.registry.actions).map(([name, action]) => {
      return {
        name,
        params: action.schema
      };
    });

    this.telemetry.capture(
      new ControllerRegisteredFunctionsTelemetryEvent(registeredFunctions)
    );

    // 在实际实现中，这里可能需要动态创建模型类型
    return ActionModel;
  }
  createActionModelSchema() { 

    const registeredFunctions = Object.entries(this.registry.actions).map(([name, action]) => {
      return {
        name,
        description: action.description,
        params: action.schema
      };
    });
    const actionModelSchema = {} as any;
    registeredFunctions.forEach(func => {
  
      actionModelSchema[func.name] = func.params.describe(func.description).optional()
    });
    const actionModelSchema2 = z.object(actionModelSchema);

    const jsonSchema = zodToJsonSchema(actionModelSchema2);

    console.log(JSON.stringify(jsonSchema, null, 2));


    return actionModelSchema;
  }





  /**
   * 获取提示描述
   * 用于生成LLM提示中的动作描述部分
   */
  getPromptDescription(): string {
    return this.registry.getPromptDescription();
  }

} 