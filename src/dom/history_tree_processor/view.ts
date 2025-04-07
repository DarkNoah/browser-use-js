/**
 * DOM历史树处理器的视图定义
 */

/**
 * DOM元素哈希，用作唯一标识符
 */
export interface HashedDomElement {
  branchPathHash: string;
  attributesHash: string;
  xpathHash: string;
}

/**
 * 坐标接口
 */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * 坐标集接口
 */
export interface CoordinateSet {
  topLeft: Coordinates;
  topRight: Coordinates;
  bottomLeft: Coordinates;
  bottomRight: Coordinates;
  center: Coordinates;
  width: number;
  height: number;
}

/**
 * 视口信息接口
 */
export interface ViewportInfo {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

/**
 * DOM历史元素接口
 */
export interface DOMHistoryElement {
  tagName: string;
  xpath: string;
  highlightIndex: number | null;
  entireParentBranchPath: string[];
  attributes: Record<string, string>;
  shadowRoot: boolean;
  cssSelector?: string;
  pageCoordinates?: CoordinateSet;
  viewportCoordinates?: CoordinateSet;
  viewportInfo?: ViewportInfo;
  
  /**
   * 将DOM历史元素转换为字典
   */
  toDict(): Record<string, any>;
}

/**
 * DOM历史元素实现
 */
export class DOMHistoryElementImpl implements DOMHistoryElement {
  tagName: string;
  xpath: string;
  highlightIndex: number | null;
  entireParentBranchPath: string[];
  attributes: Record<string, string>;
  shadowRoot: boolean;
  cssSelector?: string;
  pageCoordinates?: CoordinateSet;
  viewportCoordinates?: CoordinateSet;
  viewportInfo?: ViewportInfo;
  
  constructor(
    tagName: string,
    xpath: string,
    highlightIndex: number | null,
    entireParentBranchPath: string[],
    attributes: Record<string, string>,
    shadowRoot: boolean = false,
    cssSelector?: string,
    pageCoordinates?: CoordinateSet,
    viewportCoordinates?: CoordinateSet,
    viewportInfo?: ViewportInfo
  ) {
    this.tagName = tagName;
    this.xpath = xpath;
    this.highlightIndex = highlightIndex;
    this.entireParentBranchPath = entireParentBranchPath;
    this.attributes = attributes;
    this.shadowRoot = shadowRoot;
    this.cssSelector = cssSelector;
    this.pageCoordinates = pageCoordinates;
    this.viewportCoordinates = viewportCoordinates;
    this.viewportInfo = viewportInfo;
  }
  
  /**
   * 将DOM历史元素转换为字典
   */
  toDict(): Record<string, any> {
    return {
      tagName: this.tagName,
      xpath: this.xpath,
      highlightIndex: this.highlightIndex,
      entireParentBranchPath: this.entireParentBranchPath,
      attributes: this.attributes,
      shadowRoot: this.shadowRoot,
      cssSelector: this.cssSelector,
      pageCoordinates: this.pageCoordinates,
      viewportCoordinates: this.viewportCoordinates,
      viewportInfo: this.viewportInfo,
    };
  }
} 