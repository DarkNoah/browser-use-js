/**
 * DOM服务
 * 负责处理DOM元素和交互
 */
import { Page } from 'playwright';
import logger from '../utils/logging_config';
import { DOMTreeElement } from '../browser/context';
import { DOMBaseNode, DOMElementNode, DOMTextNode, SelectorMap, DOMState } from './views';
import { Coordinates, CoordinateSet, ViewportInfo } from './history_tree_processor/view';
import { jsCode } from './buildDomTree';




/**
 * DOM服务类
 * 处理网页DOM的提取和操作
 */
export class DomService {
  page: Page
  xpathCache: any;
  jsCode: string;

  constructor(page: Page) { 
    this.page = page;
    this.xpathCache = {};
    this.jsCode = jsCode;
  }

  /**
   * 获取可点击元素
   * @param highlightElements 是否高亮元素
   * @param focusElement 聚焦元素的索引
   * @param viewportExpansion 视口扩展像素
   * @returns DOM状态对象
   */
  async getClickableElements(
    highlightElements: boolean = true,
    focusElement: number = -1,
    viewportExpansion: number = 0,
  ): Promise<DOMState> {
    const [elementTree, selectorMap] = await this.buildDomTree(highlightElements, focusElement, viewportExpansion);
    
    const domState = new DOMState(elementTree, selectorMap);
    
    return domState;
  }





  /**
   * 构建DOM树
   * @param highlightElements 是否高亮元素
   * @param focusElement 聚焦元素的索引
   * @param viewportExpansion 视口扩展像素
   * @returns 包含DOM树根元素和选择器映射的元组
   */
  async buildDomTree(
    highlightElements: boolean,
    focusElement: number,
    viewportExpansion: number,
  ): Promise<[DOMElementNode, SelectorMap]> {
    if (await this.page.evaluate('1+1') !== 2) {
      throw new Error('页面无法正确执行JavaScript代码');
    }

    // 在浏览器中执行JS代码提取重要的DOM信息
    const args = {
      doHighlightElements: highlightElements,
      focusHighlightIndex: focusElement,
      viewportExpansion: viewportExpansion,
    };

    const evalPage = await this.page.evaluate(({ jsCode, args }) => {
      console.log('jsCode', jsCode);
      console.log('args', args);
      // 创建一个新的函数，参数名固定为 obj
      const fn = eval(jsCode);
      const result = fn(args);
      console.log('fn', result);

      // 调用并返回结果
      return result;
    }, {jsCode: this.jsCode, args}) as Record<string, any>;

    const jsNodeMap = evalPage['map'];
    const jsRootId = evalPage['rootId'];

    const selectorMap: SelectorMap = {};
    const nodeMap: Record<string, DOMBaseNode> = {};

    for (const [id, nodeData] of Object.entries(jsNodeMap)) {
      const [node, childrenIds] = this.parseNode(nodeData as any);
      if (!node) {
        continue;
      }

      nodeMap[id] = node;

      if (node instanceof DOMElementNode && node.highlightIndex !== undefined) {
        selectorMap[node.highlightIndex] = node;
      }

      // 自下而上构建树，所有子节点已经处理完毕
      if (node instanceof DOMElementNode) {
        for (const childId of childrenIds) {
          if (!(childId in nodeMap)) {
            continue;
          }

          const childNode = nodeMap[childId];
          childNode.parent = node;
          node.children.push(childNode);
        }
      }
    }

    const htmlToDict = nodeMap[jsRootId] as DOMElementNode;

    // 清理变量以帮助垃圾回收
    // delete nodeMap;
    
    if (!htmlToDict || !(htmlToDict instanceof DOMElementNode)) {
      throw new Error('无法将HTML解析为字典');
    }

    return [htmlToDict, selectorMap];
  }

  /**
   * 解析节点数据
   * @param nodeData 节点数据对象
   * @returns 节点对象和子节点ID数组组成的元组
   */
  private parseNode(
    nodeData: any,
  ): [DOMBaseNode | undefined, number[]] {
    if (!nodeData) {
      return [undefined, []];
    }

    // 处理文本节点
    if (nodeData.type === 'TEXT_NODE') {
      const textNode = new DOMTextNode(
        nodeData.text,
        nodeData.isVisible,
        undefined
      );
      return [textNode, []];
    }

    // 处理元素节点的坐标（如果存在）
    let viewportCoordinates: CoordinateSet | undefined;
    let pageCoordinates: CoordinateSet | undefined;
    let viewportInfo: ViewportInfo | undefined;

    if ('viewportCoordinates' in nodeData) {
      viewportCoordinates = {
        topLeft: nodeData.viewportCoordinates.topLeft as Coordinates,
        topRight: nodeData.viewportCoordinates.topRight as Coordinates,
        bottomLeft: nodeData.viewportCoordinates.bottomLeft as Coordinates,
        bottomRight: nodeData.viewportCoordinates.bottomRight as Coordinates,
        center: nodeData.viewportCoordinates.center as Coordinates,
        width: nodeData.viewportCoordinates.width,
        height: nodeData.viewportCoordinates.height,
      };
    }
    
    if ('pageCoordinates' in nodeData) {
      pageCoordinates = {
        topLeft: nodeData.pageCoordinates.topLeft as Coordinates,
        topRight: nodeData.pageCoordinates.topRight as Coordinates,
        bottomLeft: nodeData.pageCoordinates.bottomLeft as Coordinates,
        bottomRight: nodeData.pageCoordinates.bottomRight as Coordinates,
        center: nodeData.pageCoordinates.center as Coordinates,
        width: nodeData.pageCoordinates.width,
        height: nodeData.pageCoordinates.height,
      };
    }
    
    if ('viewport' in nodeData) {
      viewportInfo = {
        scrollX: nodeData.viewport.scrollX,
        scrollY: nodeData.viewport.scrollY,
        width: nodeData.viewport.width,
        height: nodeData.viewport.height,
      };
    }

    const elementNode = new DOMElementNode(
      nodeData.tagName,
      nodeData.xpath,
      nodeData.attributes || {},
      [],
      nodeData.isVisible || false,
      nodeData.isInteractive || false,
      nodeData.isTopElement || false,
      nodeData.shadowRoot || false,
      nodeData.highlightIndex,
      viewportCoordinates,
      pageCoordinates,
      viewportInfo,
      undefined
    );

    const childrenIds = nodeData.children || [];

    return [elementNode, childrenIds];
  }
} 