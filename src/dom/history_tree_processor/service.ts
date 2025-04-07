/**
 * DOM历史树处理器
 * 用于处理DOM元素历史记录和比较
 */
import { createHash } from 'crypto';
import { DOMTreeElement } from '../../browser/context';
import { DOMHistoryElement, DOMHistoryElementImpl, HashedDomElement } from './view';
import { DOMElementNode } from '../views';

/**
 * 历史树处理器类
 * 处理DOM元素的历史记录和比较
 */
export class HistoryTreeProcessor {
  /**
   * 将DOM元素转换为历史元素
   * @param domElement DOM元素
   * @returns DOM历史元素
   */
  static convertDomElementToHistoryElement(domElement: DOMElementNode): DOMHistoryElement {
    const parentBranchPath = HistoryTreeProcessor._getParentBranchPath(domElement);
    const cssSelector = domElement.attributes['css-selector'] || undefined;
    
    return new DOMHistoryElementImpl(
      domElement.tag,
      domElement.xpath,
      domElement.index,
      parentBranchPath,
      domElement.attributes,
      false, // shadowRoot
      cssSelector
    );
  }

  /**
   * 在DOM树中查找历史元素
   * @param domHistoryElement DOM历史元素
   * @param tree DOM树
   * @returns 找到的DOM元素，如果没找到则返回undefined
   */
  static findHistoryElementInTree(domHistoryElement: DOMHistoryElement, tree: DOMElementNode): DOMElementNode | undefined {
    const hashedDomHistoryElement = HistoryTreeProcessor._hashDomHistoryElement(domHistoryElement);

    function processNode(node: DOMElementNode): DOMElementNode | undefined {
      if (node.index !== null && node.index !== undefined) {
        const hashedNode = HistoryTreeProcessor._hashDomElement(node);
        if (HistoryTreeProcessor._compareHashedElements(hashedNode, hashedDomHistoryElement)) {
          return node;
        }
      }
      
      for (const child of node.children) {
        if (child instanceof DOMElementNode) {
          const result = processNode(child);
          if (result !== undefined) {
            return result;
          }
        }
      }
      
      return undefined;
    }

    return processNode(tree);
  }

  /**
   * 比较历史元素和DOM元素
   * @param domHistoryElement DOM历史元素
   * @param domElement DOM元素
   * @returns 比较结果，true表示相同，false表示不同
   */
  static compareHistoryElementAndDomElement(domHistoryElement: DOMHistoryElement, domElement: DOMElementNode): boolean {
    const hashedDomHistoryElement = HistoryTreeProcessor._hashDomHistoryElement(domHistoryElement);
    const hashedDomElement = HistoryTreeProcessor._hashDomElement(domElement);

    return HistoryTreeProcessor._compareHashedElements(hashedDomHistoryElement, hashedDomElement);
  }

  /**
   * 比较两个哈希化的DOM元素
   * @param a 第一个哈希化的DOM元素
   * @param b 第二个哈希化的DOM元素
   * @returns 比较结果，true表示相同，false表示不同
   */
  private static _compareHashedElements(a: HashedDomElement, b: HashedDomElement): boolean {
    return a.branchPathHash === b.branchPathHash && 
           a.attributesHash === b.attributesHash && 
           a.xpathHash === b.xpathHash;
  }

  /**
   * 哈希化DOM历史元素
   * @param domHistoryElement DOM历史元素
   * @returns 哈希化的DOM元素
   */
  private static _hashDomHistoryElement(domHistoryElement: DOMHistoryElement): HashedDomElement {
    const branchPathHash = HistoryTreeProcessor._parentBranchPathHash(domHistoryElement.entireParentBranchPath);
    const attributesHash = HistoryTreeProcessor._attributesHash(domHistoryElement.attributes);
    const xpathHash = HistoryTreeProcessor._xpathHash(domHistoryElement.xpath);

    return {
      branchPathHash,
      attributesHash,
      xpathHash
    };
  }

  /**
   * 哈希化DOM元素
   * @param domElement DOM元素
   * @returns 哈希化的DOM元素
   */
  public static _hashDomElement(domElement: DOMElementNode): HashedDomElement {
    const parentBranchPath = HistoryTreeProcessor._getParentBranchPath(domElement);
    const branchPathHash = HistoryTreeProcessor._parentBranchPathHash(parentBranchPath);
    const attributesHash = HistoryTreeProcessor._attributesHash(domElement.attributes);
    const xpathHash = HistoryTreeProcessor._xpathHash(domElement.xpath);

    return {
      branchPathHash,
      attributesHash,
      xpathHash
    };
  }

  /**
   * 获取父分支路径
   * @param domElement DOM元素
   * @returns 父分支路径
   */
  private static _getParentBranchPath(domElement: DOMElementNode): string[] {

    const parents: DOMElementNode[] = []
    // 由于我们没有完整的DOM树结构，我们将使用XPath来构建父分支路径
    // 这是一个简化的实现，实际应用中可能需要更复杂的逻辑
    const xpathParts = domElement.xpath.split('/').filter(Boolean);
    const tagNames: string[] = [];
    
    for (const part of xpathParts) {
      // 从XPath部分提取标签名（去除索引部分 [n]）
      const match = part.match(/^([^[]+)(?:\[\d+\])?$/);
      if (match) {
        tagNames.push(match[1]);
      }
    }
    
    return tagNames;
  }

  /**
   * 计算父分支路径的哈希值
   * @param parentBranchPath 父分支路径
   * @returns 哈希值
   */
  private static _parentBranchPathHash(parentBranchPath: string[]): string {
    const parentBranchPathString = parentBranchPath.join('/');
    return createHash('sha256').update(parentBranchPathString).digest('hex');
  }

  /**
   * 计算属性的哈希值
   * @param attributes 属性对象
   * @returns 哈希值
   */
  private static _attributesHash(attributes: Record<string, string>): string {
    const attributesString = Object.entries(attributes)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, value]) => `${key}=${value}`)
      .join('');
    return createHash('sha256').update(attributesString).digest('hex');
  }

  /**
   * 计算XPath的哈希值
   * @param xpath XPath
   * @returns 哈希值
   */
  private static _xpathHash(xpath: string): string {
    return createHash('sha256').update(xpath).digest('hex');
  }

/**
   * 计算文本的哈希值 
   * @param domElement DOM元素
   * @returns 哈希值
   */
  private static _textHash(domElement: DOMTreeElement): string {
    const textString = domElement.getAllTextTillNextClickableElement();
    return createHash('sha256').update(textString).digest('hex');
  }

} 