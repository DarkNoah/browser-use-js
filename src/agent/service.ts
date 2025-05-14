/**
 * Agent服务
 * 实现浏览器代理的核心逻辑
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logging_config';
import { Browser, BrowserConfig } from '../browser/browser';
import { BrowserContext, BrowserContextConfig } from '../browser/context';
import { Controller } from '../controller/service';
import { MessageManager } from './message_manager/service';
import { ActionResult, AgentError, AgentHistory, AgentHistoryList, AgentOutput, AgentStepInfo } from './views';
import { AgentMessagePrompt, PlannerPrompt, SystemPrompt } from './prompts';
import { timeExecutionAsync } from '../utils';
import { DomService } from '../dom/service';
import { AgentEndTelemetryEvent, AgentRunTelemetryEvent, AgentStepTelemetryEvent, ProductTelemetry } from '../telemetry';
import { BrowserState, BrowserStateHistory } from '../browser/views';
import { object, z } from 'zod';
import { HistoryTreeProcessor } from '../dom/history_tree_processor';
import { Jimp } from 'jimp';
import { ActionModel } from '../controller/registry/views';



export interface AgentParams {
  /** 任务描述 */
  task: string;
  /** 语言模型 */
  llm: BaseChatModel;
  /** 浏览器实例 */
  browser?: Browser;
  /** 浏览器上下文 */
  browserContext?: BrowserContext;
  /** 控制器 */
  controller?: Controller;
  /** 是否使用视觉 */
  useVision?: boolean;
  /** 是否为规划器使用视觉 */
  useVisionForPlanner?: boolean;
  /** 保存对话路径 */
  saveConversationPath?: string;
  /** 保存对话路径编码 */
  saveConversationPathEncoding?: string;
  /** 最大失败次数 */
  maxFailures?: number;
  /** 重试延迟 */
  retryDelay?: number;
  /** 系统提示类 */
  systemPromptClass?: typeof SystemPrompt;
  /** 最大输入令牌数 */
  maxInputTokens?: number;
  /** 是否验证输出 */
  validateOutput?: boolean;
  /** 消息上下文 */
  messageContext?: string;
  /** 是否生成GIF */
  generateGif?: boolean | string;
  /** 敏感数据 */
  sensitiveData?: Record<string, string>;
  /** 可用文件路径 */
  availableFilePaths?: string[];
  /** 包含的属性 */
  includeAttributes?: string[];
  /** 最大错误长度 */
  maxErrorLength?: number;
  /** 每步最大动作数 */
  maxActionsPerStep?: number;
  /** 是否在内容中使用工具调用 */
  toolCallInContent?: boolean;
  /** 初始动作 */
  initialActions?: Record<string, Record<string, any>>[];
  /** 记录新步骤回调 */
  registerNewStepCallback?: (browserState: any, agentOutput: AgentOutput, step: number) => void;
  /** 完成回调 */
  registerDoneCallback?: (history: AgentHistoryList) => void;
  /** 工具调用方法 */
  toolCallingMethod?: string;
  /** 页面提取语言模型 */
  pageExtractionLlm?: BaseChatModel;
  /** 规划器语言模型 */
  plannerLlm?: BaseChatModel;
  /** 规划器间隔 */
  planningInterval?: number;
}

export class Agent {
  private agentId: string;
  private sensitive_data?: Record<string, string>;
  private page_extraction_llm: BaseChatModel;
  private available_file_paths?: string[];
  private task: string;
  private useVision: boolean;
  private use_vision_for_planner: boolean;
  private llm: BaseChatModel;
  private save_conversation_path?: string;
  private save_conversation_path_encoding?: string;
  private _last_result: any = null;
  private include_attributes: string[];
  private max_error_length: number;
  private generate_gif: boolean | string;
  
  // 规划器相关
  private planner_llm?: BaseChatModel;
  private planning_interval: number;
  private last_plan: string | null = null;
  
  // 控制器
  private controller: Controller;
  private max_actions_per_step: number;
  
  // 浏览器相关
  private injected_browser: boolean;
  private injected_browser_context: boolean;
  private message_context?: string;
  private browser?: Browser;
  private browser_context: BrowserContext;
  
  private system_prompt_class: typeof SystemPrompt;
  
  // 遥测相关
  private telemetry: ProductTelemetry;
  
  private ActionModel: any;
  private AgentOutput: any;
  private max_input_tokens: number;
  
  private modelName?: string;
  private plannerModelName?: string;
  private chatModelLibrary?: string;
  private tool_calling_method?: string;
  
  private message_manager: MessageManager;
  private register_new_step_callback?: (browserState: BrowserState, agentOutput: AgentOutput, step: number) => void;
  private register_done_callback?: (history: AgentHistoryList) => void;
  
  // 跟踪变量
  private history: AgentHistoryList;
  private n_steps: number = 1;
  private consecutive_failures: number = 0;
  private max_failures: number;
  private retry_delay: number;
  private validate_output: boolean;
  private initial_actions?: ActionModel[];
  private action_descriptions: string;
  
  private _paused: boolean = false;
  private _stopped: boolean = false;
  version?: string;
  source?: string;
  ActionModelSchema?: z.ZodObject<any>;
 
  constructor(params: AgentParams)
  {
    this.agentId = uuidv4(); // 为代理生成唯一标识符
    this.sensitive_data = params.sensitiveData;
    this.page_extraction_llm = params.pageExtractionLlm || params.llm;
    this.available_file_paths = params.availableFilePaths;
    this.task = params.task;
    this.useVision = params.useVision ?? true;
    this.use_vision_for_planner = params.useVisionForPlanner ?? false;
    this.llm = params.llm;
    this.save_conversation_path = params.saveConversationPath;
    
    if (this.save_conversation_path && !this.save_conversation_path.includes('/')) {
      this.save_conversation_path = `${this.save_conversation_path}/`;
    }
    
    this.save_conversation_path_encoding = params.saveConversationPathEncoding || 'utf-8';
    this.include_attributes = params.includeAttributes || [
      'title',
      'type',
      'name',
      'role',
      'tabindex',
      'aria-label',
      'placeholder',
      'value',
      'alt',
      'aria-expanded',
    ];
    this.max_error_length = params.maxErrorLength || 400;
    this.generate_gif = params.generateGif ?? true;

    // 初始化规划器
    this.planner_llm = params.plannerLlm;
    this.planning_interval = params.planningInterval || 1;
    
    // 控制器设置
    this.controller = params.controller || new Controller();
    this.max_actions_per_step = params.maxActionsPerStep || 10;

    // 浏览器设置
    this.injected_browser = params.browser !== undefined;
    this.injected_browser_context = params.browserContext !== undefined;
    this.message_context = params.messageContext;

    // 如果需要，先初始化浏览器
    if (params.browser) {
      this.browser = params.browser;
    } else if (!params.browserContext) {
      this.browser = new Browser();
    }

    // 初始化浏览器上下文
    if (params.browserContext) {
      this.browser_context = params.browserContext;
    } else if (this.browser) {
      this.browser_context = new BrowserContext(this.browser, this.browser.config.newContextConfig );
    } else {
      // 如果两者都未提供，则创建新的
      this.browser = new Browser();
      this.browser_context = new BrowserContext(this.browser);
    }

    this.system_prompt_class = params.systemPromptClass || SystemPrompt;

    // 遥测设置
    this.telemetry = new ProductTelemetry();

    // 动作和输出模型设置
    this._setupActionModels();
    this._setVersionAndSource();
    this.max_input_tokens = params.maxInputTokens || 128000;

    this._setModelNames();

    this.tool_calling_method = this.setToolCallingMethod(params.toolCallingMethod || 'auto');

    this.message_manager = new MessageManager({
      llm: this.llm,
      task: this.task,
      actionDescriptions: this.controller.registry.getPromptDescription(),
      systemPromptClass: this.system_prompt_class,
      maxInputTokens: this.max_input_tokens,
      includeAttributes: this.include_attributes,
      maxErrorLength: this.max_error_length,
      maxActionsPerStep: this.max_actions_per_step,
      messageContext: this.message_context,
      sensitiveData: this.sensitive_data,
    });
    
    if (this.available_file_paths) {
      this.message_manager.addFilePaths(this.available_file_paths);
    }
    
    // 步骤回调
    this.register_new_step_callback = params.registerNewStepCallback;
    this.register_done_callback = params.registerDoneCallback;

    // 跟踪变量
    this.history = new AgentHistoryList([]);
    this.consecutive_failures = 0;
    this.max_failures = params.maxFailures || 3;
    this.retry_delay = params.retryDelay || 10;
    this.validate_output = params.validateOutput || false;
    this.initial_actions = params.initialActions ? this._convertInitialActions(params.initialActions) : undefined;
    
    if (this.save_conversation_path) {
      logger.info(`保存对话到 ${this.save_conversation_path}`);
    }

    this.action_descriptions = this.controller.registry.getPromptDescription();
  }

  private _setVersionAndSource(): void {
    // 该方法在Python代码中没有对应实现，保留为空方法
  }


  
  private _setModelNames(): void {
    this.chatModelLibrary = this.llm.lc_id[this.llm.lc_id.length - 1];
		this.modelName = "Unknown"
		
    if ((this.llm as any).modelName) {
      this.modelName = (this.llm as any).modelName
    }
    else if ((this.llm as any).model) {
      this.modelName = (this.llm as any).model
    }
		if (this.planner_llm) {
			if ((this.planner_llm as any).modelName) {
				this.plannerModelName = (this.planner_llm as any).modelName  // type: ignore
			}
			else if ((this.planner_llm as any).model) {
				this.plannerModelName = (this.planner_llm as any).model  // type: ignore
			}
			else {
				this.plannerModelName = 'Unknown'
			}
		}
		else {
      this.plannerModelName = undefined;
		}
  }

  private _setupActionModels(): void {
    this.ActionModelSchema = this.controller.registry.createActionModelSchema();
    this.ActionModel = this.controller.registry.createActionModel()
    // Create output model with the dynamic actions
    this.AgentOutput = AgentOutput.typeWithCustomActions(this.ActionModel)
  }

 

  setToolCallingMethod(toolCallingMethod: string): string | undefined {
    if (toolCallingMethod == 'auto') {
      if (this.chatModelLibrary == 'ChatGoogleGenerativeAI') {
				return undefined
			}
			else if (this.chatModelLibrary == 'ChatOpenAI') {
        return 'functionCalling'
      } else if (this.chatModelLibrary == 'AzureChatOpenAI') {
        return 'functionCalling'
      } else {
        return undefined
      }
    } else {
      return toolCallingMethod
    }
  }

  addNewTask(task: string): void {
    this.message_manager.addNewTask(task);
  }


  

  private _checkIfStoppedOrPaused(): boolean {
    if (this._stopped || this._paused) {
			logger.debug('Agent paused after getting state')
			throw new InterruptedError('Agent paused after getting state')
		}
		return false
  }

  async step(stepInfo?: AgentStepInfo): Promise<void> { 
    await timeExecutionAsync(
      async () => {
        logger.info(`📍 步骤 ${this.n_steps}`);
        let state = undefined;
        let modelOutput = undefined;
        let result: ActionResult[] = [];

        try {
          state = await this.browser_context.getState();

          this._checkIfStoppedOrPaused();
          this.message_manager.addStateMessage(state, this._last_result, stepInfo, this.useVision);

          // 按指定间隔运行规划器（如果已配置）
          if (this.planner_llm && this.n_steps % this.planning_interval === 0) {
            const plan = await this._runPlanner();
            // 在最后一条状态消息之前添加计划
            this.message_manager.addPlan(plan, -1);
          }

          const inputMessages = this.message_manager.getMessages();

          this._checkIfStoppedOrPaused();

          try {
            modelOutput = await this.getNextAction(inputMessages);

            if (this.register_new_step_callback) {
              this.register_new_step_callback(state, modelOutput, this.n_steps);
            }

            this._saveConversation(inputMessages, modelOutput);
            this.message_manager._removeLastStateMessage();  // 我们不希望聊天历史中包含完整状态

            this._checkIfStoppedOrPaused();

            this.message_manager.addModelOutput(modelOutput);
          } catch (e) {
            // 模型调用失败，从历史记录中删除最后一条状态消息
            this.message_manager._removeLastStateMessage();
            throw e;
          }

          result = await this.controller.multiAct(
            modelOutput.action,
            this.browser_context,
            () => this._checkIfStoppedOrPaused(),
            undefined,
            this.page_extraction_llm,
            this.sensitive_data,
            this.available_file_paths
          );
          this._last_result = result;

          if (result.length > 0 && result[result.length - 1].isDone) {
            logger.info(`📄 结果: ${result[result.length - 1].extractedContent}`);
          }

          this.consecutive_failures = 0;

        } catch (e : any) {
          if (e instanceof InterruptedError) {
            logger.debug('代理已暂停');
            this._last_result = [
              {
                error: '代理已暂停 - 现在可能需要重复执行继续的操作',
                includeInMemory: true
              } as ActionResult
            ];
            return;
          } else {
            result = await this._handleStepError(e);
            this._last_result = result;
          }
        } finally {
          const actions = modelOutput ? modelOutput.action.map(a => {
            // 这里模拟Python的model_dump(exclude_unset=True)
            const actionCopy = { ...a };
            // 移除未设置的字段
            Object.keys(actionCopy).forEach(key => {
              if (actionCopy[key] === undefined) {
                delete actionCopy[key];
              }
            });
            return actionCopy;
          }) : [];

          const telemetryEvent: AgentStepTelemetryEvent = {
            agentId: this.agentId,
            step: this.n_steps,
            actions: actions,
            consecutiveFailures: this.consecutive_failures,
            stepError: result ? (result.filter(r => r.error).map(r => r.error) as string[]) : ['No result'],
            name: 'agent_step',
            properties: {}
          };

          this.telemetry.capture(telemetryEvent);

          if (!result) {
            return;
          }

          if (state) {
            this._makeHistoryItem(modelOutput, state, result);
          }
        }
      },
      '--step'
    );
  }

  async _handleStepError(e: Error): Promise<ActionResult[]> {
    const errorMessage = e.message;
    const errorStack = e.stack;

    const result: ActionResult[] = [];
    
    // 简化的错误格式化，使用日志级别来确定是否包含堆栈
    const errorMsg = errorMessage + (logger.level === 'debug' ? `\n${errorStack}` : '');
    const prefix = `❌ 结果失败 ${this.consecutive_failures + 1}/${this.max_failures} 次:\n `;

    // 简化错误类型检查
    if (e.name === 'ValidationError' || e.name === 'ValueError') {
      logger.error(`${prefix}${errorMsg}`);
      if (errorMsg.includes('Max token limit reached')) {
        // 减少历史记录中的令牌数
        this.message_manager.maxInputTokens = this.max_input_tokens - 500;
        logger.info(`减少历史记录中的令牌数 - 新的最大输入令牌数: ${this.message_manager.maxInputTokens}`);
        this.message_manager.cutMessages();
      } else if (errorMsg.includes('Could not parse response')) {
        // 给模型一个关于输出格式的提示
        const enhancedErrorMsg = errorMsg + '\n\n返回一个包含所需字段的有效JSON对象。';
        return [new ActionResult({error: enhancedErrorMsg, includeInMemory: true})];
      }
      
      this.consecutive_failures += 1;
    } else if (e.name === 'RateLimitError' || e.name === 'ResourceExhausted') {
      logger.warn(`${prefix}${errorMsg}`); // 使用warn而不是warning
      await new Promise(resolve => setTimeout(resolve, this.retry_delay * 1000));
      this.consecutive_failures += 1;
    } else {
      logger.error(`${prefix}${errorMsg}`);
      this.consecutive_failures += 1;
    }

    return [new ActionResult({error: errorMsg, includeInMemory: true})];
  }

  _makeHistoryItem(
    modelOutput: AgentOutput | undefined,
    state: BrowserState,
    result: ActionResult[]
  ): void {
    /**
     * 创建并存储历史项
     */
    let interactedElements: any[] = [];

    // 如果有模型输出，获取交互的元素
    if (modelOutput) {
      interactedElements = AgentHistory.getInteractedElement(modelOutput, state.selectorMap);
    } else {
      interactedElements = [null];
    }

    // 创建浏览器状态历史
    const stateHistory = new BrowserStateHistory({
      url: state.url,
      title: state.title,
      tabs: state.tabs,
      interactedElement: interactedElements,
      screenshot: state.screenshot,
    });

    // 创建历史项
    const historyItem: AgentHistory = {
      modelOutput: modelOutput,
      result: result,
      state: stateHistory
    };

    // 添加到历史记录中
    this.history.history.push(historyItem);
  }
  private _removeThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '');
  }

  /**
   * 转换输入消息为适合规划器模型的格式
   * @param inputMessages 输入消息列表
   * @param modelName 模型名称
   * @returns 转换后的消息列表
   */
  private _convertInputMessages(inputMessages: any[], modelName?: string): any[] {
    if (modelName === undefined) {
      return inputMessages;
    }
    if (modelName === 'deepseek-reasoner' || modelName.startsWith('deepseek-r1')) {
      const convertedInputMessages = this.message_manager.convertMessagesForNonFunctionCallingModels(inputMessages);
      let mergedInputMessages = this.message_manager.mergeSuccessiveMessages(convertedInputMessages, HumanMessage);
      mergedInputMessages = this.message_manager.mergeSuccessiveMessages(mergedInputMessages, AIMessage);
      return mergedInputMessages;
    }
    return inputMessages;
  }

  async getNextAction(inputMessages: BaseMessage[]): Promise<AgentOutput> { 
    return await timeExecutionAsync(
      async () => {
        const convertedInputMessages = this._convertInputMessages(inputMessages, this.modelName);

        if (this.modelName === 'deepseek-reasoner' || (this.modelName && this.modelName.startsWith('deepseek-r1'))) {
          const output = await this.llm.invoke(convertedInputMessages);
          const outputContent = typeof output.content === 'string' 
            ? this._removeThinkTags(output.content) 
            : this._removeThinkTags(JSON.stringify(output.content));
          
          // TODO: 目前invoke不返回reasoning_content，我们应该重写invoke
          try {
            const parsedJson = this.message_manager.extractJsonFromModelOutput(outputContent);
            const parsed = new this.AgentOutput(parsedJson);
            
            // 限制动作数量
            parsed.action = parsed.action.slice(0, this.max_actions_per_step);
            this._logResponse(parsed);
            this.n_steps += 1;
            
            return parsed;
          } catch (e) {
            logger.warn(`无法解析模型输出: ${output} ${e}`);
            throw new Error('无法解析响应。');
          }
          
        } else if (this.tool_calling_method === undefined) {
          const structuredLlm = this.llm.withStructuredOutput(AgentOutput.getSchema(this.ActionModelSchema!), { includeRaw: true });
          const response = await structuredLlm.invoke(inputMessages);
          const parsed = response['parsed'] as AgentOutput;
          
          if (!parsed) {
            throw new Error('无法解析响应。');
          }
          parsed.action.forEach(x=>{
            let action_model = Reflect.construct(this.ActionModel, []) as any;
            action_model[x.name] = {};

            // Object.keys(params).forEach((key: string) => {
            //   action_model[x.name][key] = params[key];
            // });
            x = action_model;
          })



          // 限制动作数量
          parsed.action = parsed.action.slice(0, this.max_actions_per_step);
          this._logResponse(parsed);
          this.n_steps += 1;
          
          return parsed;
        } else {
          const schema = AgentOutput.getSchema(this.ActionModelSchema!);
          const structuredLlm = this.llm.withStructuredOutput(schema, { 
            includeRaw: true, 
            method: this.tool_calling_method,
            name: 'AgentOutput'
          });
          const response = await structuredLlm.invoke(inputMessages);
          const parsed = response['parsed'] as AgentOutput;


          if (!parsed) {
            throw new Error('无法解析响应。');
          }
          const actions = parsed.action.map(x => {
            let action_model = Reflect.construct(this.ActionModel, []) as any;
            Object.keys(x).forEach((key: string) => {
              action_model[key] = x[key];
            });
            return action_model;
          });
          parsed.action = actions;




          
          // 限制动作数量
          parsed.action = parsed.action.slice(0, this.max_actions_per_step);
          this._logResponse(parsed);
          this.n_steps += 1;
          
          return parsed;
        }
      },
      '--get_next_action'
    )
  }


  private _logResponse(response: AgentOutput): void {
    let emoji = '🤷';
    if (response.current_state?.evaluation_previous_goal?.includes('Success')) {
      emoji = '👍';
    } else if (response.current_state?.evaluation_previous_goal?.includes('Failed')) {
      emoji = '⚠';
    }
    
    logger.debug(`🤖 ${emoji} Page summary: ${response.current_state?.page_summary}`);
    logger.info(`${emoji} Eval: ${response.current_state?.evaluation_previous_goal}`);
    logger.info(`🧠 Memory: ${response.current_state?.memory}`);
    logger.info(`🎯 Next goal: ${response.current_state?.next_goal}`);
    
    for (let i = 0; i < response.action.length; i++) {
      const action = response.action[i];
      const actionJson = JSON.stringify(action);
      logger.info(`🛠️ Action ${i + 1}/${response.action.length}: ${actionJson}`);
    }
  }


  private async _saveConversation(inputMessages: BaseMessage[], response: any): Promise<void> {
    /**
     * 如果指定了路径，则保存对话历史到文件
     */
    if (!this.save_conversation_path) {
      return;
    }

    // 创建文件夹（如果不存在）
    const dirName = path.dirname(this.save_conversation_path);
    fs.mkdirSync(dirName, { recursive: true });

    // 打开文件
    fs.writeFileSync(
      this.save_conversation_path + `_${this.n_steps}.txt`,
      '',
      { encoding: this.save_conversation_path_encoding as BufferEncoding }
    );
    
    // 写入消息
    this._writeMessagesToFile(
      this.save_conversation_path + `_${this.n_steps}.txt`,
      inputMessages
    );
    
    // 写入响应
    this._writeResponseToFile(
      this.save_conversation_path + `_${this.n_steps}.txt`,
      response
    );
  }

  private _writeMessagesToFile(filePath: string, messages: BaseMessage[]): void {
    /**
     * 将消息写入对话文件
     */
    const f = fs.openSync(filePath, 'a');
    
    for (const message of messages) {
      fs.writeSync(f, ` ${message.constructor.name} \n`);
      
      if (Array.isArray(message.content)) {
        for (const item of message.content) {
          if (typeof item === 'object' && item.type === 'text') {
            fs.writeSync(f, item.text.trim() + '\n');
          }
        }
      } else if (typeof message.content === 'string') {
        try {
          const content = JSON.parse(message.content);
          fs.writeSync(f, JSON.stringify(content, null, 2) + '\n');
        } catch (error) {
          fs.writeSync(f, message.content.trim() + '\n');
        }
      }
      
      fs.writeSync(f, '\n');
    }
    
    fs.closeSync(f);
  }

  private _writeResponseToFile(filePath: string, response: any): void {
    /**
     * 将模型响应写入对话文件
     */
    const f = fs.openSync(filePath, 'a');
    
    fs.writeSync(f, ' RESPONSE\n');
    
    // 模拟Python的model_dump_json(exclude_unset=True)
    const responseObj = { ...response };
    // 删除未设置的属性
    Object.keys(responseObj).forEach(key => {
      if (responseObj[key] === undefined) {
        delete responseObj[key];
      }
    });
    
    fs.writeSync(f, JSON.stringify(responseObj, null, 2));
    
    fs.closeSync(f);
  }

  private _logAgentRun(): void {
    /**
     * 记录代理运行
     */
    logger.info(`🚀 开始任务: ${this.task}`);
    
    logger.debug(`版本: ${this.version}, 来源: ${this.source}`);
    const event: AgentRunTelemetryEvent = {
      name: 'agent_run',
      agentId: this.agentId,
      useVision: this.useVision,
      task: this.task,
      modelName: this.modelName,
      chatModelLibrary: this.chatModelLibrary,
      version: this.version,
      source: this.source,
      properties: {}
    }
    this.telemetry.capture(event);
  }


  async run(maxSteps: number = 100): Promise<AgentHistoryList> {
    /**
     * 使用最大步骤数执行任务
     */
    try {
      this._logAgentRun();

      // 如果提供了初始动作，则执行
      if (this.initial_actions) {
        const result = await this.controller.multiAct(
          this.initial_actions,
          this.browser_context,
          () => this._checkIfStoppedOrPaused(),
          false,
          this.page_extraction_llm,
          undefined,
          this.available_file_paths
        );
        this._last_result = result;
      }

      for (let step = 0; step < maxSteps; step++) {
        if (this._tooManyFailures()) {
          break;
        }

        // 在每一步之前检查控制标志
        if (!await this._handleControlFlags()) {
          break;
        }

        await this.step();

        if (this.history.isDone()) {
          if (this.validate_output && step < maxSteps - 1) {
            if (!await this._validateOutput()) {
              continue;
            }
          }

          logger.info('✅ 任务成功完成');
          if (this.register_done_callback) {
            this.register_done_callback(this.history);
          }
          break;
        }
      }

      if (this.n_steps >= maxSteps) {
        logger.info('❌ 在最大步骤数内未能完成任务');
      }

      return this.history;
    } finally {
      const event: AgentEndTelemetryEvent = {
        name: 'agent_end',
        agentId: this.agentId,
        success: this.history.isDone(),
        steps: this.n_steps,
        maxStepsReached: this.n_steps >= maxSteps,
        errors: this.history.errors(),
        properties: {}
      }
      this.telemetry.capture(event);

      if (!this.injected_browser_context) {
        await this.browser_context.close();
      }

      if (!this.injected_browser && this.browser) {
        await this.browser.close();
      }

      if (this.generate_gif) {
        let outputPath: string = 'agent_history.gif';
        if (typeof this.generate_gif === 'string') {
          outputPath = this.generate_gif;
        }

        //this.createHistoryGif(outputPath);
      }
    }
  }


  /**
   * 判断是否有太多失败
   * @returns 是否有太多失败
   */
  private _tooManyFailures(): boolean {
    if (this.consecutive_failures >= this.max_failures) {
      logger.info(`❌ 连续失败次数过多 (${this.consecutive_failures}/${this.max_failures})`);
      return true;
    }
    return false;
  }

  private async _handleControlFlags(): Promise<boolean> {
    if (this._stopped) {
      logger.info('代理已停止');
      return false;
    }

    while (this._paused) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if(this._stopped)
        return false;
    }

    return true;
  }

  /**
   * 验证输出
   * @returns 验证是否通过
   */
  private async _validateOutput(): Promise<boolean> {
    /**
     * 验证最后一个动作的输出是否符合用户需求
     */
    const systemMsg = 
      `您是一个浏览器交互代理的验证者。` +
      `验证最后一个动作的输出是否符合用户需求以及任务是否已完成。` +
      `如果任务定义不明确，可以放行。但如果缺少内容或图像没有显示所请求的内容，则不要放行。` +
      `尝试理解页面并帮助模型提供建议，如滚动、执行x等，以获得正确的解决方案。` +
      `要验证的任务: ${this.task}。返回包含2个键的JSON对象: is_valid和reason。` +
      `is_valid是一个布尔值，表示输出是否正确。` +
      `reason是一个字符串，解释为什么它是有效或无效的。` +
      ` 示例: {"is_valid": false, "reason": "用户想要搜索"猫照片"，但代理搜索了"狗照片"。"}`
    let msg: BaseMessage[] = [];
    if (this.browser_context) {
      const state = await this.browser_context.getState();
      
      const content = new AgentMessagePrompt(
        state,
        this._last_result,
        this.include_attributes,
        this.max_error_length,
        undefined
      )
      
      // 创建验证消息
      msg = [
        new SystemMessage(systemMsg),
        content.getUserMessage(this.useVision)
      ];
    } else {
      return true;
    }
      

      
    // 使用LLM验证
    const validator = this.llm.withStructuredOutput(z.object({
      isValid: z.boolean(),
      reason: z.string()
    }), {includeRaw: true});
      
    const response = await validator.invoke(msg);
    const parsed = response.parsed
    const isValid = parsed.isValid;
    
    if (!isValid) {
      logger.info(`❌ 验证器决定: ${parsed.reason}`);
      const msg = `输出尚未正确。${parsed.reason}。`;
      this._last_result = [new ActionResult({
        extractedContent: msg,
        includeInMemory: true
      })];
    } else {
      logger.info(`✅ 验证器决定: ${parsed.reason}`);
    }
    
    return isValid;
    
  }

  async rerunHistory(
    history: AgentHistoryList,
    maxRetries: number = 3,
    skipFailures: boolean = true,
    delayBetweenActions: number = 2.0,
  ): Promise<ActionResult[]> {
    // 如果提供了初始动作，则执行
    if (this.initial_actions) {
      await this.controller.multiAct(
        this.initial_actions,
        this.browser_context,
        () => this._checkIfStoppedOrPaused(),
        false,
        this.page_extraction_llm,
        this.sensitive_data,
        this.available_file_paths
        
      );
    }

    const results: ActionResult[] = [];

    for (let i = 0; i < history.history.length; i++) {
      const historyItem = history.history[i];
      const goal = historyItem.modelOutput?.current_state?.next_goal || '';
      logger.info(`重放步骤 ${i + 1}/${history.history.length}: 目标: ${goal}`);

      if (
        !historyItem.modelOutput ||
        !historyItem.modelOutput.action ||
        historyItem.modelOutput.action.length === 0 ||
        historyItem.modelOutput.action[0] === null
      ) {
        logger.warn(`步骤 ${i + 1}: 没有动作可重放，跳过`);
        results.push(new ActionResult({error: '没有动作可重放'}));
        continue;
      }

      let retryCount = 0;
      while (retryCount < maxRetries) {
        try {
          const result = await this._executeHistoryStep(historyItem, delayBetweenActions);
          results.push(...result);
          break;
        } catch (e: any) {
          retryCount++;
          if (retryCount === maxRetries) {
            const errorMsg = `步骤 ${i + 1} 在 ${maxRetries} 次尝试后失败: ${e.message}`;
            logger.error(errorMsg);
            if (!skipFailures) {
              results.push(new ActionResult({error: errorMsg}));
              throw new Error(errorMsg);
            }
          } else {
            logger.warn(`步骤 ${i + 1} 失败 (尝试 ${retryCount}/${maxRetries})，重试中...`);
            await new Promise(resolve => setTimeout(resolve, delayBetweenActions * 1000));
          }
        }
      }
    }

    return results;
  }

  /**
   * 执行历史步骤
   * @param historyItem 历史项
   * @param delay 动作之间的延迟（秒）
   * @returns 动作结果
   */
  private async _executeHistoryStep(
    historyItem: AgentHistory,
    delay: number
  ): Promise<ActionResult[]> {
    const state = await this.browser_context.getState();
    if (!state || !historyItem.modelOutput) {
      throw new Error('无效的状态或模型输出');
    }
    
    const updatedActions = [];
    for (let i = 0; i < historyItem.modelOutput.action.length; i++) {
      const action = historyItem.modelOutput.action[i];
      const updatedAction = await this._updateActionIndices(
        historyItem.state.interactedElement[i],
        action,
        state
      );
      updatedActions.push(updatedAction);

      if (updatedAction === null) {
        throw new Error(`无法在当前页面中找到匹配的元素 ${i}`);
      }
    }

    const result = await this.controller.multiAct(
      updatedActions as any[],
      this.browser_context,
      () => this._checkIfStoppedOrPaused(),
      false,
      this.page_extraction_llm,
      this.sensitive_data,
      this.available_file_paths
    );


    // 在动作之间添加延迟
    await new Promise(resolve => setTimeout(resolve, delay * 1000));

    return result;
  }

  private async _updateActionIndices(
    historicalElement: any,
    action: ActionModel,
    currentState: BrowserState
  ): Promise<ActionModel | null> {
    /**
     * 更新基于当前页面状态的动作索引
     * 返回更新后的动作，如果元素找不到则返回null
     */
    if (!historicalElement || !currentState.elementTree) {
      return action;
    }

    const currentElement = HistoryTreeProcessor.findHistoryElementInTree(
      historicalElement, 
      currentState.elementTree
    );

    if (!currentElement || currentElement.highlightIndex === undefined) {
      return null;
    }

    const oldIndex = action.getIndex();
    if (oldIndex !== currentElement.highlightIndex) {
      action.setIndex(currentElement.highlightIndex);
      logger.info(`元素在DOM中移动，索引从 ${oldIndex} 更新为 ${currentElement.highlightIndex}`);
    }

    return action;
  }


  /**
   * 从文件加载历史并重新运行
   * @param historyFile 历史文件路径，可选
   * @param kwargs 传递给rerunHistory的额外参数
   * @returns 动作结果的Promise
   */
  async loadAndRerun(historyFile?: string, kwargs: any = {}): Promise<ActionResult[]> {
    if (!historyFile) {
      historyFile = 'AgentHistory.json';
    }
    const history = AgentHistoryList.loadFromFile(historyFile, this.AgentOutput);
    return await this.rerunHistory(history, kwargs.maxRetries, kwargs.skipFailures, kwargs.delayBetweenActions);
  }

  saveHistory(file_path?:string) {
    if (!file_path) {
      file_path = 'AgentHistory.json';
    }
    this.history.saveToFile(file_path);
  }


  



  // /**
  //  * 创建代理历史GIF
  //  * @param outputPath GIF输出路径
  //  * @param duration 帧持续时间（毫秒）
  //  * @param showGoals 是否显示目标
  //  * @param showTask 是否显示任务
  //  * @param showLogo 是否显示徽标
  //  * @param fontSize 字体大小
  //  * @param titleFontSize 标题字体大小
  //  * @param goalFontSize 目标字体大小
  //  * @param margin 边距
  //  * @param lineSpacing 行间距
  //  */
  // async createHistoryGif(
  //   outputPath: string = 'agent_history.gif',
  //   duration: number = 3000,
  //   showGoals: boolean = true,
  //   showTask: boolean = true,
  //   showLogo: boolean = false,
  //   fontSize: number = 40,
  //   titleFontSize: number = 56,
  //   goalFontSize: number = 44,
  //   margin: number = 40,
  //   lineSpacing: number = 1.5,
  // ): Promise<void> {
  //   // 导入所需模块
  //   // const path = require('path');
  //   // const fs = require('fs');
  //   // const platform = require('os').platform;
  //   // const Jimp = require('jimp');
  //   // const GIFEncoder = require('gifencoder');

  //   if (!this.history.history || this.history.history.length === 0) {
  //     logger.warn('没有历史记录可以创建GIF');
  //     return;
  //   }

  //   // 如果历史为空或第一个截图为空，我们无法创建GIF
  //   if (!this.history.history[0].state.screenshot) {
  //     logger.warn('没有历史记录或第一个截图可以创建GIF');
  //     return;
  //   }

  //   try {
  //     const images: any[] = [];
      
  //     // 尝试加载字体（在Node.js环境中，我们可以使用Jimp的加载字体功能）
  //     let regularFont: any;
  //     let titleFont: any;
  //     let goalFont: any;
      
  //     // 根据平台尝试加载字体（这里简化处理，使用Jimp自带字体）
  //     try {
  //       regularFont = Jimp.FONT_SANS_32_BLACK;  // 简化，使用Jimp内置字体
  //       titleFont = Jimp.FONT_SANS_64_BLACK;    // 简化，使用Jimp内置字体
  //       goalFont = Jimp.FONT_SANS_32_BLACK;     // 简化，使用Jimp内置字体
  //     } catch (error) {
  //       logger.warn('加载字体失败，使用默认字体');
  //       regularFont = Jimp.FONT_SANS_16_BLACK;  // 简化，使用Jimp内置字体
  //       titleFont = regularFont;
  //       goalFont = regularFont;
  //     }

  //     // 加载徽标（如果需要）
  //     let logo: any = null;
  //     if (showLogo) {
  //       try {
  //         logo = await Jimp.read('./static/browser-use.png');
  //         // 重新调整徽标大小
  //         const logoHeight = 150;
  //         const aspectRatio = logo.bitmap.width / logo.bitmap.height;
  //         const logoWidth = Math.floor(logoHeight * aspectRatio);
  //         logo.resize(logoWidth, logoHeight);
  //       } catch (e) {
  //         logger.warn(`无法加载徽标: ${e}`);
  //       }
  //     }

  //     // 创建任务帧（如果需要）
  //     if (showTask && this.task) {
  //       const taskFrame = await this._createTaskFrame(
  //         this.task,
  //         this.history.history[0].state.screenshot,
  //         titleFont,
  //         regularFont,
  //         logo,
  //         lineSpacing,
  //       );
  //       images.push(taskFrame);
  //     }

  //     // 处理每个历史项
  //     for (let i = 0; i < this.history.history.length; i++) {
  //       const item = this.history.history[i];
  //       if (!item.state.screenshot) {
  //         continue;
  //       }

  //       // 将Base64截图转换为Jimp图像
  //       const imgData = Buffer.from(item.state.screenshot, 'base64');
  //       const image = await Jimp.read(imgData);

  //       if (showGoals && item.modelOutput) {
  //         await this._addOverlayToImage(
  //           image,
  //           i + 1,
  //           item.modelOutput.currentState.nextGoal,
  //           regularFont,
  //           titleFont,
  //           margin,
  //           logo,
  //         );
  //       }

  //       images.push(image);
  //     }

  //     if (images.length > 0) {
  //       // 保存GIF
  //       const encoder = new GIFEncoder(images[0].bitmap.width, images[0].bitmap.height);
  //       const outputStream = fs.createWriteStream(outputPath);
        
  //       encoder.createReadStream().pipe(outputStream);
  //       encoder.start();
  //       encoder.setRepeat(0);   // 0表示循环
  //       encoder.setDelay(duration);  // 帧持续时间
  //       encoder.setQuality(10);  // 较低的数字 = 较好的质量
        
  //       for (const image of images) {
  //         encoder.addFrame(image.bitmap.data);
  //       }
        
  //       encoder.finish();
  //       logger.info(`在 ${outputPath} 创建了GIF`);
  //     } else {
  //       logger.warn('在历史记录中没有找到可以创建GIF的图像');
  //     }
  //   } catch (error) {
  //     logger.error(`创建GIF时出错: ${error}`);
  //   }
  // }

  // /**
  //  * 创建任务帧
  //  * @param task 任务文本
  //  * @param screenshot 屏幕截图
  //  * @param titleFont 标题字体
  //  * @param regularFont 常规字体
  //  * @param logo 徽标
  //  * @param lineSpacing 行间距
  //  * @returns 任务帧图像
  //  */
  // private async _createTaskFrame(
  //   task: string,
  //   screenshot: string,
  //   titleFont: any,
  //   regularFont: any,
  //   logo: any,
  //   lineSpacing: number,
  // ): Promise<any> {
    
    
  //   // 从base64解码第一张截图以获取尺寸
  //   const imgData = Buffer.from(screenshot, 'base64');
  //   const baseImage = await Jimp.read(imgData);
    
  //   // 创建新的空白图像
  //   const image = new Jimp(baseImage.bitmap.width, baseImage.bitmap.height, 0xffffffff);

  //   // 添加标题
  //   const title = "任务";
  //   const titleWidth = Jimp.measureText(titleFont, title);
  //   image.print(
  //     titleFont,
  //     (image.bitmap.width - titleWidth) / 2,
  //     50,
  //     title
  //   );

  //   // 添加任务文本（换行处理）
  //   const maxWidth = image.bitmap.width - 100;
  //   const words = task.split(' ');
  //   let line = '';
  //   let y = 150;
    
  //   for (const word of words) {
  //     const testLine = line + word + ' ';
  //     const testWidth = Jimp.measureText(regularFont, testLine);
      
  //     if (testWidth > maxWidth && line !== '') {
  //       image.print(regularFont, 50, y, line);
  //       line = word + ' ';
  //       y += Math.floor(regularFont.size * lineSpacing);
  //     } else {
  //       line = testLine;
  //     }
  //   }
    
  //   // 打印最后一行
  //   if (line) {
  //     image.print(regularFont, 50, y, line);
  //   }

  //   // 添加徽标（如果有）
  //   if (logo) {
  //     image.composite(
  //       logo,
  //       image.bitmap.width - logo.bitmap.width - 20,
  //       image.bitmap.height - logo.bitmap.height - 20
  //     );
  //   }

  //   return image;
  // }

  // /**
  //  * 向图像添加覆盖层
  //  * @param image 图像
  //  * @param stepNumber 步骤编号
  //  * @param goalText 目标文本
  //  * @param regularFont 常规字体
  //  * @param titleFont 标题字体
  //  * @param margin 边距
  //  * @param logo 徽标
  //  * @returns 处理后的图像
  //  */
  // private async _addOverlayToImage(
  //   image: any,
  //   stepNumber: number,
  //   goalText: string,
  //   regularFont: any,
  //   titleFont: any,
  //   margin: number,
  //   logo: any,
  // ): Promise<any> {
  //   // 添加半透明背景
  //   const overlay = new (require('jimp'))(image.bitmap.width, 150, 0x000000aa);
  //   image.composite(overlay, 0, 0);

  //   // 添加步骤编号
  //   const stepText = `步骤 ${stepNumber}`;
  //   image.print(
  //     titleFont,
  //     margin,
  //     Math.floor((150 - titleFont.size) / 2),
  //     stepText
  //   );

  //   // 添加目标文本（如果有）
  //   if (goalText) {
  //     // 截断过长的目标文本
  //     const maxGoalLength = 80;
  //     let displayGoal = goalText.length > maxGoalLength
  //       ? goalText.substring(0, maxGoalLength) + '...'
  //       : goalText;
      
  //     const goalX = margin + Jimp.measureText(titleFont, stepText) + 20;
  //     image.print(
  //       regularFont,
  //       goalX,
  //       Math.floor((150 - regularFont.size) / 2),
  //       displayGoal
  //     );
  //   }

  //   // 添加徽标（如果有）
  //   if (logo) {
  //     image.composite(
  //       logo,
  //       image.bitmap.width - logo.bitmap.width - margin,
  //       Math.floor((150 - logo.bitmap.height) / 2)
  //     );
  //   }

  //   return image;
  // }






  pause(): void {
    logger.info('🔄 暂停代理');
    this._paused = true;
  }

  resume(): void {
    logger.info('▶️ 继续代理');
    this._paused = false;
  }

  /**
   * 停止代理
   */
  stop(): void {
    logger.info('⏹️ 停止代理');
    this._stopped = true;
  }



  private _convertInitialActions(actions: Record<string, Record<string,any>>[]): ActionModel[]  {
    const convertedActions = []
		const actionModel = this.ActionModel
    for (const actionDict of actions) {
      // Each action_dict should have a single key-value pair
      const actionName = Object.keys(actionDict)[0];
      const params = actionDict[actionName];

      // Get the parameter model for this action from registry
      const actionInfo = this.controller.registry.registry.actions[actionName]
      const paramModel = actionInfo.paramModel


      // Create ActionModel instance with the validated parameters
      let action_model = Reflect.construct(this.ActionModel, []) as any;
      action_model[actionName] = {};

      Object.keys(params).forEach((key: string) => {
        action_model[actionName][key] = params[key];
      });

      convertedActions.push(action_model)
    }
		return convertedActions
  }



  private async _runPlanner(): Promise<string | undefined> {
 
    if (!this.planner_llm) {
      return undefined;
    }

    // 创建规划器消息历史，使用完整的消息历史
    const plannerMessages = [
      new PlannerPrompt(this.action_descriptions).getSystemMessage(),
      ...this.message_manager.getMessages().slice(1), // 使用完整消息历史除了第一条
    ];

    // 如果不为规划器使用视觉但为代理使用视觉，则需要删除最后一条状态消息中的图像
    if (!this.use_vision_for_planner && this.useVision) {
      const lastStateMessage = plannerMessages[plannerMessages.length - 1];
      // 移除最后一条状态消息中的图像
      let newMsg = '';
      if (Array.isArray(lastStateMessage.content)) {
        for (const msg of lastStateMessage.content) {
          if (msg.type === 'text') {
            newMsg += msg.text;
          } else if (msg.type === 'image_url') {
            continue;
          }
        }
      } else {
        newMsg = lastStateMessage.content as string;
      }

      plannerMessages[plannerMessages.length - 1] = new HumanMessage(newMsg);
    }

    // 转换输入消息为规划器模型
    const convertedPlannerMessages = this._convertInputMessages(plannerMessages, this.plannerModelName);
    
    // 获取规划器输出
    const response = await this.planner_llm.invoke(convertedPlannerMessages);
    let plan = response.content as string;
    
    // 如果是deepseek-reasoner，移除思考标签
    if (this.plannerModelName === 'deepseek-reasoner') {
      plan = this._removeThinkTags(plan);
    }
    
    try {
      const planJson = JSON.parse(plan);
      logger.info(`规划分析:\n${JSON.stringify(planJson, null, 4)}`);
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.info(`规划分析:\n${plan}`);
      } else {
        logger.debug(`解析规划分析时出错: ${e}`);
        logger.info(`计划: ${plan}`);
      }
    }

    return plan;
  }
} 

export class InterruptedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'InterruptedError';
    }
  }