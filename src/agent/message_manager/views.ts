import { AIMessage, HumanMessage, SystemMessage, BaseMessage } from "@langchain/core/messages"

/**
 * 消息元数据，包含令牌计数
 */
export class MessageMetadata {
  inputTokens: number = 0;
}

/**
 * 带有元数据的消息
 */
export class ManagedMessage {
  message: BaseMessage;
  metadata: MessageMetadata;

  constructor(message: BaseMessage, metadata: MessageMetadata = new MessageMetadata()) {
    this.message = message;
    this.metadata = metadata;
  }
}

/**
 * 带有元数据的消息历史容器
 */
export class MessageHistory {
  messages: ManagedMessage[] = [];
  totalTokens: number = 0;

  /**
   * 添加带有元数据的消息
   */
  addMessage(message: BaseMessage, metadata: MessageMetadata, position?: number): void {
    if (position === undefined) {
      this.messages.push(new ManagedMessage(message, metadata));
    } else {
      this.messages.splice(position, 0, new ManagedMessage(message, metadata));
    }
    this.totalTokens += metadata.inputTokens;
  }

  /**
   * 从历史记录中移除消息
   */
  removeMessage(index: number = -1): void {
    if (this.messages.length > 0) {
      // 处理负索引（如Python中的-1表示最后一个元素）
      const actualIndex = index < 0 ? this.messages.length + index : index;
      if (actualIndex >= 0 && actualIndex < this.messages.length) {
        const msg = this.messages.splice(actualIndex, 1)[0];
        this.totalTokens -= msg.metadata.inputTokens;
      }
    }
  }
}
