import { CoordinateSet, HashedDomElement, ViewportInfo } from './history_tree_processor/view';
import { HistoryTreeProcessor } from './history_tree_processor/service';
import { BrowserContext, DOMTreeElement } from '../browser/context';

/**
 * DOM基础节点接口
 */
export abstract class DOMBaseNode {
  isVisible: boolean;
  parent?: DOMElementNode;

  constructor(isVisible: boolean, parent?: DOMElementNode ) {
    this.isVisible = isVisible;
    this.parent = parent;
  }
}

/**
 * DOM文本节点类
 */
export class DOMTextNode extends DOMBaseNode {
  text: string;
  type: string = 'TEXT_NODE';

  constructor(text: string, isVisible: boolean, parent?: DOMElementNode) {
    super(isVisible, parent);
    this.text = text;
  }

  /**
   * 检查是否有带有高亮索引的父元素
   */
  hasParentWithHighlightIndex(): boolean {
    let current = this.parent;
    while (current) {
      if (current?.highlightIndex !== undefined) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }
}

/**
 * DOM元素节点类
 * xpath: 从最后一个根节点（shadow root或iframe或document，如果没有shadow root或iframe）的元素的xpath。
 * 为了正确引用元素，我们需要递归切换根节点，直到找到元素（使用.parent向上查找树）
 */
export class DOMElementNode extends DOMBaseNode {
  tagName: string;
  xpath: string;
  attributes: Record<string, string>;
  children: DOMBaseNode[];
  isInteractive: boolean;
  isTopElement: boolean;
  shadowRoot: boolean;
  highlightIndex?: number;
  viewportCoordinates: CoordinateSet | null;
  pageCoordinates: CoordinateSet | null;
  viewportInfo: ViewportInfo | null;
  
  // 实现DOMTreeElement必需的属性
  get index(): number {
    return this.highlightIndex || -1;
  }
  
  get tag(): string {
    return this.tagName;
  }
  
  get text(): string {
    return this.getAllTextTillNextClickableElement();
  }
  
  get isClickable(): boolean {
    return this.isInteractive;
  }
  
  get isInput(): boolean {
    return this.tagName === 'input' || this.tagName === 'textarea' || this.tagName === 'select';
  }

  constructor(
    tagName: string,
    xpath: string,
    attributes: Record<string, string>,
    children: DOMBaseNode[],
    isVisible: boolean,
    isInteractive: boolean = false,
    isTopElement: boolean = false,
    shadowRoot: boolean = false,
    highlightIndex?: number,
    viewportCoordinates: CoordinateSet | null = null,
    pageCoordinates: CoordinateSet | null = null,
    viewportInfo: ViewportInfo | null = null,
    parent?: DOMElementNode
  ) {
    super(isVisible, parent);
    this.tagName = tagName;
    this.xpath = xpath;
    this.attributes = attributes;
    this.children = children;
    this.isInteractive = isInteractive;
    this.isTopElement = isTopElement;
    this.shadowRoot = shadowRoot;
    this.highlightIndex = highlightIndex;
    this.viewportCoordinates = viewportCoordinates;
    this.pageCoordinates = pageCoordinates;
    this.viewportInfo = viewportInfo;
    
    // 设置子节点的父节点引用
    this.children.forEach(child => {
      child.parent = this;
    });
  }

  /**
   * 生成节点的字符串表示
   */
  toString(): string {
    let tagStr = `<${this.tagName}`;

    // 添加属性
    for (const [key, value] of Object.entries(this.attributes)) {
      tagStr += ` ${key}="${value}"`;
    }
    tagStr += '>';

    // 添加额外信息
    const extras: string[] = [];
    if (this.isInteractive) {
      extras.push('interactive');
    }
    if (this.isTopElement) {
      extras.push('top');
    }
    if (this.shadowRoot) {
      extras.push('shadow-root');
    }
    if (this.highlightIndex !== null) {
      extras.push(`highlight:${this.highlightIndex}`);
    }

    if (extras.length > 0) {
      tagStr += ` [${extras.join(", ")}]`;
    }

    return tagStr;
  }

  /**
   * 获取节点的哈希值
   * 注意：使用转换为DOMTreeElement的方式来获取哈希
   */
  get hash(): HashedDomElement {
    // 我们需要创建一个符合DOMTreeElement的对象
    return HistoryTreeProcessor._hashDomElement(this);
  }

  /**
   * 获取直到下一个可点击元素的所有文本
   */
  getAllTextTillNextClickableElement(maxDepth: number = -1): string {
    const textParts: string[] = [];

    const collectText = (node: DOMBaseNode, currentDepth: number): void => {
      if (maxDepth !== -1 && currentDepth > maxDepth) {
        return;
      }

      // 如果遇到高亮元素（当前节点除外），则跳过此分支
      if (node instanceof DOMElementNode && node !== this && node.highlightIndex !== undefined) {
        return;
      }

      if (node instanceof DOMTextNode) {
        textParts.push(node.text);
      } else if (node instanceof DOMElementNode) {
        for (const child of node.children) {
          collectText(child, currentDepth + 1);
        }
      }
    };

    collectText(this, 0);
    return textParts.join('\n').trim();
  }

  /**
   * 将可点击元素转换为字符串
   */
  clickableElementsToString(includeAttributes: string[] = []): string {
    const formattedText: string[] = [];

    const processNode = (node: DOMBaseNode, depth: number): void => {
      if (node instanceof DOMElementNode) {
        // 添加带有highlightIndex的元素
        if (node.highlightIndex !== undefined) {
          let attributesStr = '';
          if (includeAttributes.length > 0) {
            attributesStr = ' ' + includeAttributes
              .filter(key => key in node.attributes)
              .map(key => `${key}="${node.attributes[key]}"`)
              .join(' ');
          }
          formattedText.push(
            `[${node.highlightIndex}]<${node.tagName}${attributesStr}>${node.getAllTextTillNextClickableElement()}</${node.tagName}>`
          );
        }

        // 无论如何都处理子节点
        for (const child of node.children) {
          processNode(child, depth + 1);
        }
      } else if (node instanceof DOMTextNode) {
        // 只有当没有高亮的父节点时才添加文本
        if (!node.hasParentWithHighlightIndex()) {
          formattedText.push(`[]${node.text}`);
        }
      }
    };

    processNode(this, 0);
    return formattedText.join('\n');
  }

  /**
   * 获取文件上传元素
   */
  getFileUploadElement(checkSiblings: boolean = true): DOMElementNode | null {
    // 检查当前元素是否为文件输入
    if (this.tagName === 'input' && this.attributes['type'] === 'file') {
      return this;
    }

    // 检查子元素
    for (const child of this.children) {
      if (child instanceof DOMElementNode) {
        const result = child.getFileUploadElement(false);
        if (result) {
          return result;
        }
      }
    }

    // 仅对初始调用检查兄弟元素
    if (checkSiblings && this.parent) {
      for (const sibling of this.parent.children) {
        if (sibling !== this && sibling instanceof DOMElementNode) {
          const result = sibling.getFileUploadElement(false);
          if (result) {
            return result;
          }
        }
      }
    }

    return null;
  }

  /**
   * 获取高级CSS选择器
   * 注意：这个方法将需要在浏览器上下文中实现
   */
  getAdvancedCssSelector(): string {
    return BrowserContext._enhancedCssSelectorForElement(this);
  }
}

/**
 * 选择器映射类型
 */
export type SelectorMap = Record<number, DOMElementNode>;

/**
 * DOM状态类
 */
export class DOMState {
  elementTree: DOMElementNode;
  selectorMap: SelectorMap;

  constructor(elementTree: DOMElementNode, selectorMap: SelectorMap) {
    this.elementTree = elementTree;
    this.selectorMap = selectorMap;
  }
}
