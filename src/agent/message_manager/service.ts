/**
 * 消息管理服务
 * 负责管理并格式化与LLM的通信
 */
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { 
  SystemMessage, 
  HumanMessage, 
  AIMessage,
  BaseMessage,
  ToolMessage
} from '@langchain/core/messages';
import { AgentMessagePrompt, SystemPrompt } from '../prompts';
import { BrowserState } from '../../browser/views';
import logger from '../../utils/logging_config';
import { MessageHistory, MessageMetadata } from './views';
import { ActionResult, AgentOutput, AgentStepInfo } from '../views';
import { ToolCall } from '@langchain/core/messages/tool';




type MessageManagerParams = {
  llm: BaseChatModel,
  task: string,
  actionDescriptions: string,
  systemPromptClass: typeof SystemPrompt,
  maxInputTokens: number,
  estimatedCharactersPerToken?: number,
  imageTokens?: number,
  includeAttributes: string[],
  maxErrorLength: number,
  maxActionsPerStep: number,
  messageContext?: string,
  sensitiveData?: Record<string, string>
}
/**
 * 消息管理器类
 */
export class MessageManager {
  private llm: BaseChatModel;
  private task: string;
  private actionDescriptions: string;
  private systemPromptClass: typeof SystemPrompt;
  // private systemPrompt: SystemPrompt;
  // private agentMessagePrompt: AgentMessagePrompt;
  maxInputTokens: number;
  private estimatedCharactersPerToken: number;
  private imageTokens: number;
  private includeAttributes: string[];
  private maxErrorLength: number;
  private messageContext?: string;
  private sensitiveData?: Record<string, string>;
  private filePaths: string[] = [];
  private history: MessageHistory = new MessageHistory();
  private toolId: number = 1;
  private systemPrompt: SystemMessage;
  
  constructor({
    llm,
    task,
    actionDescriptions,
    systemPromptClass,
    maxInputTokens = 120000,
    estimatedCharactersPerToken = 3,
    imageTokens = 800,
    includeAttributes = [],
    maxErrorLength = 400,
    maxActionsPerStep = 10,
    messageContext,
    sensitiveData }: MessageManagerParams) {
    this.llm = llm;
    this.systemPromptClass = systemPromptClass;
    this.maxInputTokens = maxInputTokens;
    this.history = new MessageHistory();
    this.task = task;
    this.actionDescriptions = actionDescriptions;
    this.estimatedCharactersPerToken = estimatedCharactersPerToken;
    this.imageTokens = imageTokens;
    this.includeAttributes = includeAttributes;
    this.maxErrorLength = maxErrorLength;
    this.messageContext = messageContext;
    this.sensitiveData = sensitiveData;

    const systemMessage = new this.systemPromptClass(
      this.actionDescriptions,
      maxActionsPerStep
    ).getSystemPrompt();
    
    this.systemPrompt = systemMessage;
    this._addMessageWithTokens(systemMessage);
    
    if (this.messageContext) {
      const contextMessage = new HumanMessage(`Context for the task${this.messageContext}`);
      this._addMessageWithTokens(contextMessage);
    }
    
    const taskMessage = this.taskInstructions(task);
    this._addMessageWithTokens(taskMessage);
    
    if (this.sensitiveData) {
      let info = `Here are placeholders for sensitve data: ${Object.keys(this.sensitiveData)}`;
      info +='To use them, write <secret>the placeholder name</secret>'
      const infoMessage = new HumanMessage(info);
      this._addMessageWithTokens(infoMessage);
    }
    
    let placeholderMessage = new HumanMessage('Example output:');
    this._addMessageWithTokens(placeholderMessage);
    this.toolId = 1
    // 示例工具调用
    const toolCalls: ToolCall[] = [
      {
        'name': 'AgentOutput',
        'args': {
          'current_state': {
            'page_summary': 'On the page are company a,b,c wtih their revenue 1,2,3.',
            'evaluation_previous_goal': 'Success - I opend the first page',
            'memory': 'Starting with the new task. I have completed 1/10 steps',
            'next_goal': 'Click on company a',
          },
          'action': [{'click_element': {'index': 0}}],
        },
        'id': this.toolId.toString(),
        'type': 'tool_call',
      }
    ];
    
    const exampleToolCall = new AIMessage({
      content: '',
      tool_calls: toolCalls,
    });
    this._addMessageWithTokens(exampleToolCall);
    

    const toolMessage = new ToolMessage('Browser started', this.toolId.toString());
    this._addMessageWithTokens(toolMessage);
    this.toolId += 1;
    
    placeholderMessage = new HumanMessage('[Your task history memory starts here]');
    this._addMessageWithTokens(placeholderMessage);
  }

  /**
   * 生成任务指令消息
   * @param task 任务描述
   * @returns 人类消息对象
   */
  private taskInstructions(task: string): HumanMessage {
    const content = `Your ultimate task is: "${task}". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`;
    return new HumanMessage(content);
  }
  
  /**
   * 添加文件路径
   * @param filePaths 文件路径列表
   */
  public addFilePaths(filePaths: string[]): void {
    this.filePaths = filePaths;
    const content = `Here are file paths you can use: ${filePaths}`;
    const msg = new HumanMessage(content);
    this._addMessageWithTokens(msg);
  }
  
  /**
   * 添加新任务
   * @param newTask 新任务描述
   */
  public addNewTask(newTask: string): void {
    const content = `Your new ultimate task is: "${newTask}". Take the previous context into account and finish your new ultimate task.`;
    const msg = new HumanMessage(content);
    this._addMessageWithTokens(msg);
  }
  
  /**
   * 添加计划
   * @param plan 计划内容
   * @param position 插入位置
   */
  public addPlan(plan?: string, position?: number): void {
    if (plan) {
      const msg = new AIMessage(plan);
      this._addMessageWithTokens(msg, position);
    }
  }
  
  /**
   * 添加带有令牌计数的消息
   * @param message 消息对象
   * @param position 插入位置
   */
  private _addMessageWithTokens(message: BaseMessage, position?: number): void {
    // 过滤敏感数据
    if (this.sensitiveData) {
      message = this._filterSensitiveData(message);
    }
    
    const tokenCount = this._countTokens(message);
    const metadata = new MessageMetadata();
    metadata.inputTokens = tokenCount;
    
    this.history.addMessage(message, metadata, position);
  }
  
  /**
   * 添加浏览器状态作为人类消息
   * @param state 浏览器状态
   * @param result 动作结果列表
   * @param stepInfo 代理步骤信息
   * @param use_vision 是否使用视觉
   */
  public addStateMessage(
    state: BrowserState,
    result?: ActionResult[],
    stepInfo?: AgentStepInfo,
    useVision = true,
  ): void {
    // 如果保持在内存中，直接添加到历史记录并添加没有结果的状态
    if (result) {
      for (const r of result) {
        if (r.includeInMemory) {
          if (r.extractedContent) {
            const msg = new HumanMessage('Action result: ' + String(r.extractedContent));
            this._addMessageWithTokens(msg);
          }
          if (r.error) {
            const msg = new HumanMessage('Action error: ' + String(r.error).slice(-this.maxErrorLength));
            this._addMessageWithTokens(msg);
          }
          result = undefined;  // 如果结果在历史记录中，我们不想再次添加它
        }
      }
    }

    // 否则添加状态消息和结果到下一条消息（不会保留在内存中）
    const stateMessage = new AgentMessagePrompt(
      state,
      result,
      this.includeAttributes,
      this.maxErrorLength,
      stepInfo
    ).getUserMessage(useVision);
    this._addMessageWithTokens(stateMessage);
  }

  /**
   * 从历史记录中删除最后一条状态消息
   */
  _removeLastStateMessage(): void {
    if (this.history.messages.length > 2 && 
        this.history.messages[this.history.messages.length - 1].message instanceof HumanMessage) {
      this.history.removeMessage();
    }
  }

  /**
   * 添加模型输出作为AI消息
   * @param model_output 代理输出
   */
  public addModelOutput(model_output: AgentOutput): void {
    const tool_calls: ToolCall[] = [
      {
        'name': 'AgentOutput',
        'args': model_output,
        'id': String(this.toolId),
        'type': 'tool_call',
      }
    ];

    const msg = new AIMessage({
      content: '',
      tool_calls: tool_calls,
    });

    this._addMessageWithTokens(msg);
    // 空工具响应
    const tool_message = new ToolMessage({
      content: '',
      tool_call_id: String(this.toolId),
    });
    this._addMessageWithTokens(tool_message);
    this.toolId += 1;
  }
  
  /**
   * 过滤消息中的敏感数据
   * @param message 消息对象
   * @returns 过滤后的消息对象
   */
  private _filterSensitiveData(message: BaseMessage): BaseMessage {
    if (!this.sensitiveData) {
      return message;
    }
    
    const replaceSensitive = (value: string): string => {
      let result = value;
      for (const [key, val] of Object.entries(this.sensitiveData || {})) {
        result = result.replace(val, `<secret>${key}</secret>`);
      }
      return result;
    };
    
    if (typeof message.content === 'string') {
      message.content = replaceSensitive(message.content);
    } else if (Array.isArray(message.content)) {
      for (let i = 0; i < message.content.length; i++) {
        const item = message.content[i];
        if (typeof item === 'object' && item && 'text' in item) {
          item.text = replaceSensitive(item.text as string);
          message.content[i] = item;
        }
      }
    }
    
    return message;
  }
  
  /**
   * 计算消息中的令牌数
   * @param message 消息对象
   * @returns 令牌数
   */
  private _countTokens(message: SystemMessage | HumanMessage | AIMessage): number {
    let tokens = 0;
    
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (typeof item === 'object' && item) {
          if ('image_url' in item) {
            tokens += this.imageTokens;
          } else if ('text' in item) {
            tokens += this._countTextTokens(item.text as string);
          }
        }
      }
    } else {
      let msg = message.content as string;
      if ('tool_calls' in message) {
        msg += JSON.stringify(message.tool_calls);
      }
      tokens += this._countTextTokens(msg);
    }
    
    return tokens;
  }
  
  /**
   * 计算文本中的令牌数
   * @param text 文本内容
   * @returns 令牌数
   */
  private _countTextTokens(text: string): number {
    // 粗略估计令牌数
    return Math.floor(text.length / this.estimatedCharactersPerToken);
  }
  
  /**
   * 获取当前消息列表
   * @returns 消息列表
   */
  public getMessages(): BaseMessage[] {
    const msg = this.history.messages.map(m => m.message);
    let total_input_tokens = 0;
    logger.debug(`Messages in history: ${this.history.messages.length}:`);
    for (const m of this.history.messages) {
      total_input_tokens += m.metadata.inputTokens;
      logger.debug(`${m.message.getType().toString()} - Token count: ${m.metadata.inputTokens}`)
      
    }
    logger.debug(`Total input tokens: ${total_input_tokens}`);
    return msg;
  }

  /**
   * 裁剪消息以符合最大令牌限制
   */
  public cutMessages(): void {
    const diff = this.history.totalTokens - this.maxInputTokens;
    if (diff <= 0) {
      return;
    }

    const lastIndex = this.history.messages.length - 1;
    const lastMessage = this.history.messages[lastIndex];

    // 如果内容是列表且包含图片，先移除图片
    if (Array.isArray(lastMessage.message.content)) {
      let text = '';
      for (let i = 0; i < lastMessage.message.content.length; i++) {
        const item = lastMessage.message.content[i];
        if (typeof item === 'object' && 'image_url' in item) {
          lastMessage.message.content.splice(i, 1);
          i--;
          lastMessage.metadata.inputTokens -= this.imageTokens;
          this.history.totalTokens -= this.imageTokens;
          logger.debug(
            `Removed image with ${this.imageTokens} tokens - total tokens now: ${this.history.totalTokens}/${this.maxInputTokens}`
          );
        } else if (typeof item === 'object' && 'text' in item) {
          text += item.text;
        }
      }
      lastMessage.message.content = text;
    }

    // 如果还超过限制，按比例删除文本
    if (this.history.totalTokens - this.maxInputTokens > 0) {
      const proportion = (this.history.totalTokens - this.maxInputTokens) / lastMessage.metadata.inputTokens;
      if (proportion > 0.99) {
        throw new Error(
          `Max token limit reached - history is too long - reduce the system prompt or task. proportion_to_remove: ${proportion}`
        );
      }

      logger.debug(
        `Removing ${proportion * 100}% of the last message (${proportion * lastMessage.metadata.inputTokens} / ${lastMessage.metadata.inputTokens} tokens)`
      );

      const content = lastMessage.message.content as string;
      const charactersToRemove = Math.floor(content.length * proportion);
      const newContent = content.substring(0, content.length - charactersToRemove);

      // 移除旧消息
      this.history.removeMessage(lastIndex);

      // 添加新消息
      const newMessage = new HumanMessage(newContent);
      this._addMessageWithTokens(newMessage);

      logger.debug(
        `Added message with ${this.history.messages[this.history.messages.length - 1].metadata.inputTokens} tokens - ` +
        `total tokens now: ${this.history.totalTokens}/${this.maxInputTokens} - ` +
        `total messages: ${this.history.messages.length}`
      );
    }
  }

  /**
   * 为不支持函数调用的模型转换消息
   * @param inputMessages 输入消息列表
   * @returns 转换后的消息列表
   */
  public convertMessagesForNonFunctionCallingModels(inputMessages: BaseMessage[]): BaseMessage[] {
    const outputMessages: BaseMessage[] = [];
    for (const message of inputMessages) {
      if (message instanceof HumanMessage) {
        outputMessages.push(message);
      } else if (message instanceof SystemMessage) {
        outputMessages.push(message);
      } else if (message instanceof ToolMessage) {
        outputMessages.push(new HumanMessage(message.content.toString()));
      } else if (message instanceof AIMessage) {
        // 检查tool_calls是否是有效的JSON对象
        if ('tool_calls' in message && message.tool_calls) {
          const toolCalls = JSON.stringify(message.tool_calls);
          outputMessages.push(new AIMessage(toolCalls));
        } else {
          outputMessages.push(message);
        }
      } else {
        throw new Error(`未知的消息类型: ${typeof message}`);
      }
    }
    return outputMessages;
  }

  /**
   * 合并连续的相同类型消息
   * @param messages 消息列表
   * @param classToMerge 要合并的消息类
   * @returns 合并后的消息列表
   */
  public mergeSuccessiveMessages<T extends typeof BaseMessage>(
    messages: BaseMessage[],
    classToMerge: T
  ): BaseMessage[] {
    const mergedMessages: BaseMessage[] = [];
    let streak = 0;
    
    for (const message of messages) {
      if (message instanceof classToMerge) {
        streak += 1;
        if (streak > 1) {
          if (Array.isArray(message.content)) {
            const lastMessage = mergedMessages[mergedMessages.length - 1];
            if (Array.isArray(lastMessage.content)) {
              lastMessage.content = [...lastMessage.content, ...message.content];
            } else if (typeof lastMessage.content === 'string' && message.content[0] && 'text' in message.content[0]) {
              lastMessage.content += message.content[0].text;
            }
          } else {
            mergedMessages[mergedMessages.length - 1].content += message.content;
          }
        } else {
          mergedMessages.push(message);
        }
      } else {
        mergedMessages.push(message);
        streak = 0;
      }
    }
    
    return mergedMessages;
  }

  /**
   * 从模型输出中提取JSON
   * @param content 模型输出内容
   * @returns 解析后的JSON对象
   */
  public extractJsonFromModelOutput(content: string): Record<string, any> {
    try {
      // 如果内容被代码块包装，提取JSON部分
      if (content.includes('```')) {
        // 查找代码块之间的JSON内容
        content = content.split('```')[1];
        // 如果存在语言标识符（如'json\n'），将其移除
        if (content.includes('\n')) {
          content = content.split('\n', 2)[1];
        }
      }
      // 解析处理后的内容
      return JSON.parse(content);
    } catch (error) {
      logger.warn(`解析模型输出失败: ${content} ${error}`);
      throw new Error('无法解析响应。');
    }
  }
  
} 