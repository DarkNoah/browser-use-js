import { DOMElementNode, DOMState, SelectorMap } from '../dom/views';
import { DOMHistoryElement } from '../dom/history_tree_processor';
/**
 * 表示浏览器标签页的信息
 */
export interface TabInfo {
  pageId: number;
  url: string;
  title: string;
}


/**
 * 表示浏览器状态
 */
export class BrowserState extends DOMState {
  url: string;
  title: string;
  tabs: TabInfo[];
  screenshot?: string;
  pixelsAbove: number = 0;
  pixelsBelow: number = 0;
  browserErrors: string[] = [];



  constructor(params: Partial<BrowserState>) {
    super(params.elementTree!, params.selectorMap!);
    this.url = params.url || '';
    this.title = params.title || '';
    this.tabs = params.tabs || [];
    this.screenshot = params.screenshot;
    this.pixelsAbove = params.pixelsAbove || 0;
    this.pixelsBelow = params.pixelsBelow || 0;
    this.browserErrors = params.browserErrors || [];
  }
  
}

/**
 * 表示浏览器状态历史
 */
export class BrowserStateHistory {
  url: string;
  title: string;
  tabs: TabInfo[];
  interactedElement: (DOMHistoryElement | null)[];
  screenshot?: string;

  constructor(init?: Partial<BrowserStateHistory>) {
    this.url = init?.url || '';
    this.title = init?.title || '';
    this.tabs = init?.tabs || [];
    this.interactedElement = init?.interactedElement || [];
    this.screenshot = init?.screenshot;
  }

  /**
   * 将浏览器状态历史转换为对象
   */
  toDict(): Record<string, any> {
    const data: Record<string, any> = {};
    data['tabs'] = this.tabs;
    data['screenshot'] = this.screenshot;
    data['interactedElement'] = this.interactedElement.map(el => el ? el.toDict() : null);
    data['url'] = this.url;
    data['title'] = this.title;
    return data;
  }
}

/**
 * 浏览器错误基类
 */
export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

/**
 * URL不允许错误
 */
export class URLNotAllowedError extends BrowserError {
  constructor(message: string) {
    super(message);
    this.name = 'URLNotAllowedError';
  }
}
