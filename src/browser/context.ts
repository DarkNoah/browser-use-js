import { v4 as uuidv4 } from 'uuid';
import {
  BrowserContext as PlaywrightBrowserContext,
  Page, 
  ElementHandle,
  Download,
  Browser as PlaywrightBrowser,
  Request,
  Response,
  FrameLocator
} from 'playwright';
import logger from '../utils/logging_config';
import { delay, timeExecutionAsync } from '../utils';
import path, { dirname } from 'path';
import os from 'os';
import fs from 'fs';
import { Browser, BrowserConfig } from './browser';
import { DOMElementNode, DOMState, SelectorMap } from '../dom/views';
import { BrowserError, BrowserState, TabInfo, URLNotAllowedError } from './views';
import { DomService } from '../dom';


/**
 * DOM树元素
 */
export interface DOMTreeElement {
  index: number;
  xpath: string;
  text: string;
  tag: string;
  attributes: Record<string, string>;
  isClickable: boolean;
  isInput: boolean;
  children: DOMTreeElement[];
  
  getAllTextTillNextClickableElement(maxDepth?: number): string;
}

/**
 * 浏览器上下文会话
 */
export interface BrowserSession {
  context: PlaywrightBrowserContext;
  currentPage: Page;
  cachedState: BrowserState;
}


export type BrowserContextWindowSize = {
	width: number
	height: number
}

/**
 * 浏览器上下文配置
 */
export class BrowserContextConfig {
  cookiesFile?: string
	minimumWaitPageLoadTime: number = 0.5
	waitForNetworkIdlePageLoadTime: number = 1
	maximumWaitPageLoadTime: number = 5
	waitBetweenActions: number = 1

	disableSecurity: boolean = false

	browserWindowSize: BrowserContextWindowSize = {'width': 1280, 'height': 1100}
	noViewport?: boolean
	saveRecordingPath?: string 
	saveDownloadsPath?: string 
	tracePath?: string 
	locale?: string 
	userAgent: string = 
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36  (KHTML, like Gecko) Chrome/85.0.4183.102 Safari/537.36'

	highlightElements: boolean = true
	viewportExpansion: number = 500
	allowedDomains?: string[] 
	includeDynamicAttributes: boolean = true
  _forceKeepContextAlive: boolean = false
  constructor(config?: Partial<BrowserContextConfig>) {
    Object.assign(this, config);
  }




}

/**
 * 浏览器上下文类
 * 负责管理浏览器会话和页面操作
 */
export class BrowserContext {
  private browser: Browser;
  private contextId: string;
  private context: PlaywrightBrowserContext | null = null;
  private session?: BrowserSession;
  private _domProcessor: any = null; // 将在DOM处理器实现后替换
  readonly config: BrowserContextConfig;

  currentState?: BrowserState;


  /**
   * 创建浏览器上下文
   * @param browser 浏览器实例
   * @param config 上下文配置
   */
  constructor(browser: Browser, config: BrowserContextConfig = new BrowserContextConfig()) {
    this.contextId = uuidv4();
    logger.debug(`Initializing new browser context with id: ${this.contextId}`)
    
    this.config = config;
    this.browser = browser;

  }

  async close(): Promise<void> {
    logger.debug('关闭浏览器上下文')
    try {
      if (!this.session) {
        return;
      }

      await this.saveCookies();
      if (this.config.tracePath) {
        try {
          await this.session.context.tracing.stop({path: path.join(this.config.tracePath, `${this.contextId}.zip`) })
        } catch(err) { 
          logger.error(`Failed to stop tracing:${err}`);
        }
      }

      if (!this.config._forceKeepContextAlive) {
        try {
          await this.session.context.close()
        } catch(err) { 
          logger.error(`Failed to close context: ${err}`);
        }
      }
      
    } finally {
      this.session = undefined;
    }
    
  }

  private async initializeSession(): Promise<BrowserSession> {
    logger.debug('初始化浏览器上下文')
    const playwrightBrowser = await this.browser.getPlaywrightBrowser();
    
    // 创建上下文
    const context = await this._createContext(playwrightBrowser);
    this._addNewPageListener(context);


    const existing_pages = context.pages()
    let page: Page;
    if (existing_pages.length>0) {
      page = existing_pages[-1]  // Use the last existing page
			logger.debug('Reusing existing page')
    }
    else {
      page = await context.newPage()
			logger.debug('Created new page')
    }
			
  
    const initial_state = await this._getInitialState(page)


    this.session = {
      context: context,
      currentPage: page,
      cachedState: initial_state
    }
    return this.session
  }

  private async _addNewPageListener(context: PlaywrightBrowserContext) {
    const browser = this.browser;
    context.on('page', async (page: Page) => {
      if (browser.config.cdpUrl) {
        await page.reload()  // Reload the page to avoid timeout errors
      }
				
      await page.waitForLoadState();
      logger.debug(`New page opened: ${page.url}`)
      if (this.session) {
        this.session.currentPage = page
      }
    });

  }
  async getSession(): Promise<BrowserSession> {
    if (!this.session) {
      await this.initializeSession();
    }
    return this.session!;
  }
  async getCurrentPage(): Promise<Page> {
    const session = await this.getSession();
    return session.currentPage
  }

  private async _createContext(browser: PlaywrightBrowser): Promise<PlaywrightBrowserContext> { 
    let context: PlaywrightBrowserContext;
    
    // 如果存在CDP URL或Chrome实例路径，尝试使用现有的上下文
    if (this.browser.config.cdpUrl && browser.contexts().length > 0) {
      context = browser.contexts()[0];
    } else if (this.browser.config.chromeInstancePath && browser.contexts().length > 0) {
      // 连接到现有的Chrome实例而不是创建新实例
      context = browser.contexts()[0];
    } else {
      // 创建新的上下文
      context = await browser.newContext({
        viewport: this.config.browserWindowSize,
        userAgent: this.config.userAgent,
        javaScriptEnabled: true,
        bypassCSP: this.config.disableSecurity,
        ignoreHTTPSErrors: this.config.disableSecurity,
        recordVideo: this.config.saveRecordingPath ? {
          dir: this.config.saveRecordingPath,
          size: {
            width: this.config.browserWindowSize.width,
            height: this.config.browserWindowSize.height
          }
        } : undefined,
        locale: this.config.locale
      });
    }

    // 如果配置了跟踪路径，启动跟踪
    if (this.config.tracePath) {
      await context.tracing.start({ 
        screenshots: true, 
        snapshots: true,
        sources: true 
      });
    }

    // 如果存在cookie文件，加载cookie
    if (this.config.cookiesFile && fs.existsSync(this.config.cookiesFile)) {
      try {
        const cookiesContent = await fs.promises.readFile(this.config.cookiesFile!, 'utf-8');
        const cookies = JSON.parse(cookiesContent);
        logger.info(`Loaded ${cookies.length} cookies from ${this.config.cookiesFile}`)
        await context.addCookies(cookies);
      } catch (error) {
        logger.error(`加载cookies时出错: ${error}`);
      }
    }

    // 注入防检测脚本
    await context.addInitScript(`
      // Webdriver property
      Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
      });

      // Languages
      Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US']
      });

      // Plugins
      Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
      });

      // Chrome runtime
      window.chrome = { runtime: {} };

      // Permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission }) :
              originalQuery(parameters)
      );
      (function () {
          const originalAttachShadow = Element.prototype.attachShadow;
          Element.prototype.attachShadow = function attachShadow(options) {
              return originalAttachShadow.call(this, { ...options, mode: "open" });
          };
      })();
    `);

    return context;
  }
  private async _waitForStableNetwork(): Promise<void> {
    const page = await this.getCurrentPage();
    
    const pendingRequests = new Set<Request>();
    let lastActivity = Date.now();

    // 定义相关资源类型和内容类型
    const RELEVANT_RESOURCE_TYPES = new Set([
      'document',
      'stylesheet',
      'image',
      'font',
      'script',
      'fetch',
      'xhr',
      'iframe',
    ]);

    const RELEVANT_CONTENT_TYPES = [
      'text/html',
      'text/css',
      'application/javascript',
      'image/',
      'font/',
      'application/json',
    ];

    // 需要过滤的URL模式
    const IGNORED_URL_PATTERNS = [
      // 分析和跟踪
      'analytics',
      'tracking',
      'telemetry',
      'beacon',
      'metrics',
      // 广告相关
      'doubleclick',
      'adsystem',
      'adserver',
      'advertising',
      // 社交媒体小部件
      'facebook.com/plugins',
      'platform.twitter',
      'linkedin.com/embed',
      // 在线聊天和支持
      'livechat',
      'zendesk',
      'intercom',
      'crisp.chat',
      'hotjar',
      // 推送通知
      'push-notifications',
      'onesignal',
      'pushwoosh',
      // 后台同步/心跳
      'heartbeat',
      'ping',
      'alive',
      // WebRTC和流媒体
      'webrtc',
      'rtmp://',
      'wss://',
      // 常见CDN
      'cloudfront.net',
      'fastly.net',
    ];

    const onRequest = (request:Request) => {
      // 按资源类型过滤
      if (!RELEVANT_RESOURCE_TYPES.has(request.resourceType())) {
        return;
      }

      // 过滤掉流媒体、WebSocket和其他实时请求
      if (['websocket', 'media', 'eventsource', 'manifest', 'other'].includes(request.resourceType())) {
        return;
      }

      // 按URL模式过滤
      const url = request.url().toLowerCase();
      if (IGNORED_URL_PATTERNS.some(pattern => url.includes(pattern))) {
        return;
      }

      // 过滤掉data URL和blob URL
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        return;
      }

      // 按请求头过滤
      const headers = request.headers();
      if (headers['purpose'] === 'prefetch' || 
          headers['sec-fetch-dest'] === 'video' || 
          headers['sec-fetch-dest'] === 'audio') {
        return;
      }

      pendingRequests.add(request);
      lastActivity = Date.now();
      // logger.debug(`Request started: ${request.url()} (${request.resourceType()})`);
    };

    const onResponse = (response: Response) => {
      const request = response.request();
      if (!pendingRequests.has(request)) {
        return;
      }

      // 按内容类型过滤（如果可用）
      const contentType = (response.headers()['content-type'] || '').toLowerCase();

      // 跳过表示流媒体或实时数据的内容类型
      if (['streaming', 'video', 'audio', 'webm', 'mp4', 'event-stream', 'websocket', 'protobuf']
          .some(t => contentType.includes(t))) {
        pendingRequests.delete(request);
        return;
      }

      // 只处理相关内容类型
      if (!RELEVANT_CONTENT_TYPES.some(ct => contentType.includes(ct))) {
        pendingRequests.delete(request);
        return;
      }

      // 如果响应太大，则跳过（可能对页面加载不重要）
      const contentLength = response.headers()['content-length'];
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) { // 5MB
        pendingRequests.delete(request);
        return;
      }

      pendingRequests.delete(request);
      lastActivity = Date.now();
      // logger.debug(`Request resolved: ${request.url()} (${contentType})`);
    };

    // 附加事件监听器
    page.on('request', onRequest);
    page.on('response', onResponse);

    try {
      // 等待空闲时间
      const startTime = Date.now();
      while (true) {
        await delay(100); // 等待0.1秒
        const now = Date.now();
        
        if (pendingRequests.size === 0 && 
            (now - lastActivity) >= this.config.waitForNetworkIdlePageLoadTime * 1000) {
          break;
        }
        
        if (now - startTime > this.config.maximumWaitPageLoadTime * 1000) {
          logger.debug(
            `Network timeout after ${this.config.maximumWaitPageLoadTime}s with ${pendingRequests.size} ` +
            `pending requests: ${Array.from(pendingRequests).map(r => r.url())}`
          );
          break;
        }
      }
    } finally {
      // 清理事件监听器
      page.removeListener('request', onRequest);
      page.removeListener('response', onResponse);
    }

    logger.debug(`Network stabilized for ${this.config.waitForNetworkIdlePageLoadTime} seconds`);
  }

  private async _waitForPageAndFramesLoad(timeoutOverwrite?: number): Promise<void> {
    /**
     * 确保页面完全加载后再继续。
     * 等待网络空闲或最小等待时间，以较长者为准。
     * 同时检查加载的URL是否被允许。
     */
    // 开始计时
    const startTime = Date.now();
    // 等待页面加载
    try {
      await this._waitForStableNetwork();
      const page = await this.getCurrentPage();
      await this._checkAndHandleNavigation(page);
    } catch (error) {
      // 如果是URLNotAllowedError就抛出
      if (error instanceof Error && error.name === 'URLNotAllowedError') {
        throw error;
      }
      // 其他错误记录警告并继续
      logger.warn('页面加载失败，继续执行...');
    }

    // 计算剩余时间以满足最小等待时间
    const elapsed = (Date.now() - startTime) / 1000; // 转换为秒
    const remaining = Math.max(
      ((timeoutOverwrite !== undefined ? timeoutOverwrite : this.config.minimumWaitPageLoadTime) - elapsed),
      0
    );

    logger.debug(`--页面在 ${elapsed.toFixed(2)} 秒内加载完成，额外等待 ${remaining.toFixed(2)} 秒`);

    // 如果需要，等待剩余时间
    if (remaining > 0) {
      await delay(remaining * 1000); // delay函数接受毫秒为单位
    }
  }
		
  private _isUrlAllowed(url: string): boolean {
    if (!this.config.allowedDomains) {
      return true;
    }

    try {
      const parsedUrl = new URL(url);
      let domain = parsedUrl.hostname.toLowerCase();

      // 移除端口号（如果存在）
      if (domain.includes(':')) {
        domain = domain.split(':')[0];
      }

      // 检查域名是否匹配任何允许的域名模式
      return this.config.allowedDomains.some(
        allowedDomain => 
          domain === allowedDomain.toLowerCase() || 
          domain.endsWith('.' + allowedDomain.toLowerCase())
      );
    } catch (error) {
      logger.error(`检查URL允许列表时出错: ${error}`);
      return false;
    }
  }

  private async _checkAndHandleNavigation(page: Page): Promise<void> {
    if (!this._isUrlAllowed(page.url())) { 
      logger.warn(`导航到非允许URL: ${page.url()}`);
      try {
        await this.goBack();
      } catch (error) {
        logger.error(`在检测到非允许URL后返回上一页失败: ${error}`);
      }
      throw new URLNotAllowedError(`导航到非允许URL: ${page.url()}`);
    }
  }
  async navigateTo(url: string): Promise<void> {
    if (this._isUrlAllowed(url))
			throw new BrowserError(`Navigation to non-allowed URL: ${url}`)
    const page = await this.getCurrentPage();
    await page.goto(url);
    await page.waitForLoadState();
  }
  async refreshPage(): Promise<void> {
    const page = await this.getCurrentPage();
    await page.reload();
    await page.waitForLoadState();
  }
  async goBack(): Promise<void> {
    const page = await this.getCurrentPage();
    try {
      await page.goBack({timeout: 10000,waitUntil: 'domcontentloaded'});
    } catch (err) {
      logger.error(`返回上一页失败: ${err}`);
    }
  }

  async goForward(): Promise<void> {
    const page = await this.getCurrentPage();
    try {
      await page.goForward({timeout: 10000, waitUntil: 'domcontentloaded'});
    } catch (err) {
      logger.error(`前进失败: ${err}`);
    }
  }

  async closeCurrentTab(): Promise<void> {
    const session = await this.getSession();
    const page = session.currentPage;
    await page.close();
    if(session.context.pages().length === 1){
      await this.switchToTab(0);
    }
  }

  async getPageHtml(): Promise<string> {
    const page = await this.getCurrentPage();
    return await page.content();
  }

  async executeJavascript(script: string): Promise<any> {
    const page = await this.getCurrentPage();
    return await page.evaluate(script);
  }

  

  /**
   * 获取当前浏览器状态
   */
  async getState(): Promise<BrowserState> {
    return await timeExecutionAsync(async () => { 
      await this._waitForPageAndFramesLoad();
      const session = await this.getSession();
      session.cachedState = await this._updateState()
      if (this.config.cookiesFile) {
        await this.saveCookies();
      }
      return session.cachedState;
    }, '--get_state');
  }

  private async _updateState(focusElement:number = -1): Promise<BrowserState> {
    const session = await this.getSession();

    // 检查当前页面是否有效，如果无效则切换到另一个可用页面
    let page: Page;
    try {
      page = await this.getCurrentPage();
      // 测试页面是否仍可访问
      await page.evaluate("1");
    } catch (e) {
      logger.debug(`当前页面不再可访问: ${e}`);
      // 获取所有可用页面
      const pages = session.context.pages();
      if (pages.length > 0) {
        session.currentPage = pages[pages.length - 1];
        page = session.currentPage;
        logger.debug(`已切换到页面: ${await page.title()}`);
      } else {
        throw new BrowserError('浏览器已关闭: 没有可用的页面');
      }
    }

    try {
      await this.removeHighlights();
      const domService = new DomService(page);
      const content = await domService.getClickableElements(
        this.config.highlightElements,
        focusElement,
        this.config.viewportExpansion
      );

      const screenshot = await this.takeScreenshot();
      const { pixelsAbove, pixelsBelow } = await this.getScrollInfo(page);

      this.currentState = new BrowserState({
        elementTree: content.elementTree,
        selectorMap: content.selectorMap,
        url: page.url(),
        title: await page.title(),
        tabs: await this.getTabsInfo(),
        screenshot: screenshot,
        pixelsAbove: pixelsAbove,
        pixelsBelow: pixelsBelow,
        browserErrors: []
      });

      return this.currentState;
    } catch (e) {
      logger.error(`更新状态失败: ${e}`);
      // 返回上一个已知的良好状态（如果有）
      if (this.currentState) {
        return this.currentState;
      }
      throw e;
    }
  }
  /**
   * 获取页面截图
   */
  async takeScreenshot(full_page: boolean = false): Promise<string> {
    const page = await this.getCurrentPage();
    
    const screenshot = await page.screenshot({
      fullPage: full_page,
      animations: 'disabled',
      type: 'png'
    });
    
    // 将Buffer转换为base64字符串
    const screenshot_b64 = screenshot.toString('base64');
    
    // await this.removeHighlights();
    
    return screenshot_b64;
  }
/**
   * 移除页面上的高亮显示
   */
  async removeHighlights(): Promise<void> {
    try {
      const page = await this.getCurrentPage();
      await page.evaluate(`
        try {
          // 移除高亮容器及其所有内容
          const container = document.getElementById('playwright-highlight-container');
          if (container) {
            container.remove();
          }

          // 移除元素上的高亮属性
          const highlightedElements = document.querySelectorAll('[browser-user-highlight-id^="playwright-highlight-"]');
          highlightedElements.forEach(el => {
            el.removeAttribute('browser-user-highlight-id');
          });
        } catch (e) {
          console.error('移除高亮失败:', e);
        }
      `);
    } catch (e) {
      logger.debug(`移除高亮失败（这通常是可以接受的）: ${e}`);
      // 不抛出错误，因为这不是关键功能
    }
  }


  static _convertSimpleXpathToCssSelector(xpath: string): string {
    if (!xpath) {
      return '';
    }

    // 移除前导斜杠（如果存在）
    xpath = xpath.replace(/^\//, '');

    // 分割成部分
    const parts = xpath.split('/');
    const cssParts: string[] = [];

    for (const part of parts) {
      if (!part) {
        continue;
      }

      // 处理索引符号 [n]
      if (part.includes('[')) {
        const basePartEndIndex = part.indexOf('[');
        const basePart = part.substring(0, basePartEndIndex);
        const indexPart = part.substring(basePartEndIndex);

        // 处理多个索引
        const indexExpressions = indexPart.split(']').slice(0, -1);
        let resultPart = basePart;

        for (const indexExpr of indexExpressions) {
          const idx = indexExpr.replace(/\[/g, '').trim();

          try {
            // 处理数字索引
            if (/^\d+$/.test(idx)) {
              const index = parseInt(idx, 10) - 1;
              resultPart += `:nth-of-type(${index + 1})`;
            }
            // 处理 last() 函数
            else if (idx === 'last()') {
              resultPart += ':last-of-type';
            }
            // 处理 position() 函数
            else if (idx.includes('position()')) {
              if (idx.includes('>1')) {
                resultPart += ':nth-of-type(n+2)';
              }
            }
          } catch (error) {
            continue;
          }
        }

        cssParts.push(resultPart);
      } else {
        cssParts.push(part);
      }
    }

    const baseSelector = cssParts.join(' > ');
    return baseSelector;
  }
  /**
   * 为元素生成增强的CSS选择器
   * @param element DOM元素节点
   * @param includeDynamicAttributes 是否包含动态属性
   */
  static _enhancedCssSelectorForElement(element: DOMElementNode, includeDynamicAttributes: boolean = true): string {
    try {
      // 获取基础选择器
      let cssSelector = this._convertSimpleXpathToCssSelector(element.xpath);
      
      // 处理class属性
      if ('class' in element.attributes && element.attributes['class'] && includeDynamicAttributes) {
        // 定义CSS类名的有效模式
        const validClassNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
        
        // 遍历class属性值
        const classes = element.attributes['class'].split(/\s+/);
        for (const className of classes) {
          // 跳过空类名
          if (!className.trim()) {
            continue;
          }
          
          // 检查类名是否有效
          if (validClassNamePattern.test(className)) {
            // 将有效的类名附加到CSS选择器
            cssSelector += `.${className}`;
          } else {
            // 跳过无效的类名
            continue;
          }
        }
      }
      
      // 定义安全属性集合，这些属性稳定且对选择有用
      const SAFE_ATTRIBUTES = new Set([
        // 数据属性（如果在应用程序中是稳定的）
        'id',
        // 标准HTML属性
        'name',
        'type',
        'placeholder',
        // 无障碍属性
        'aria-label',
        'aria-labelledby',
        'aria-describedby',
        'role',
        // 常见表单属性
        'for',
        'autocomplete',
        'required',
        'readonly',
        // 媒体属性
        'alt',
        'title',
        'src',
        // 自定义稳定属性
        'href',
        'target',
      ]);
      
      // 添加动态属性
      if (includeDynamicAttributes) {
        const dynamicAttributes = new Set([
          'data-id',
          'data-qa',
          'data-cy',
          'data-testid',
        ]);
        
        // 合并集合
        dynamicAttributes.forEach(attr => SAFE_ATTRIBUTES.add(attr));
      }
      
      // 处理其他属性
      for (const [attribute, value] of Object.entries(element.attributes)) {
        if (attribute === 'class') {
          continue;
        }
        
        // 跳过无效的属性名
        if (!attribute.trim()) {
          continue;
        }
        
        if (!SAFE_ATTRIBUTES.has(attribute)) {
          continue;
        }
        
        // 转义属性名中的特殊字符
        const safeAttribute = attribute.replace(':', '\\:');
        
        // 处理不同的值情况
        if (value === '') {
          cssSelector += `[${safeAttribute}]`;
        } else if (/["'<>`\n\r\t]/.test(value)) {
          // 对含有特殊字符的值使用contains
          // 正则替换所有空白为单个空格，然后去除前后空格
          const collapsedValue = value.replace(/\s+/g, ' ').trim();
          // 转义嵌入的双引号
          const safeValue = collapsedValue.replace(/"/g, '\\"');
          cssSelector += `[${safeAttribute}*="${safeValue}"]`;
        } else {
          cssSelector += `[${safeAttribute}="${value}"]`;
        }
      }
      
      return cssSelector;
    } catch (error) {
      // 如果出错，回退到更基本的选择器
      const tagName = element.tagName || '*';
      return `${tagName}[highlight-index='${element.highlightIndex}']`;
    }
  }
  async getLocateElement(element: DOMElementNode): Promise<ElementHandle | undefined> {
    const page = await this.getCurrentPage();
    
    // 收集所有父元素
    const parents: DOMElementNode[] = [];
    let current = element;
    while (current.parent) {
      const parent = current.parent;
      parents.push(parent);
      current = parent;
    }
    
    // 逆序排列父元素列表，从顶层开始处理
    parents.reverse();
    
    // 处理所有iframe父元素
    let currentFrame: Page | any = page;
    const iframes = parents.filter(item => item.tagName === 'iframe');
    
    for (const parent of iframes) {
      const cssSelector = BrowserContext._enhancedCssSelectorForElement(
        parent,
        this.config.includeDynamicAttributes
      );
      currentFrame = currentFrame.frameLocator(cssSelector);
    }
    
    const cssSelector = BrowserContext._enhancedCssSelectorForElement(
      element,
      this.config.includeDynamicAttributes
    );
    
    try {
      if (typeof currentFrame.frameLocator === 'function') {
        // 如果是FrameLocator
        const elementHandle = await currentFrame.locator(cssSelector).elementHandle();
        return elementHandle;
      } else {
        // 如果是Page
        const elementHandle = await currentFrame.$(cssSelector);
        if (elementHandle) {
          await elementHandle.scrollIntoViewIfNeeded();
          return elementHandle;
        }
        return undefined;
      }
    } catch (e) {
      logger.error(`定位元素失败: ${e}`);
      return undefined;
    }
  }



  async _inputTextElementNode(elementNode: DOMElementNode, text: string): Promise<void> { 
    /**
     * 在元素中输入文本，具有适当的错误处理和状态管理
     * 处理不同类型的输入字段并确保输入前元素处于正确状态
     */
    try {
      // 在输入前高亮元素
      if (elementNode.highlightIndex !== undefined) {
        await this._updateState(elementNode.highlightIndex);
      }

      const page = await this.getCurrentPage();
      const elementHandle = await this.getLocateElement(elementNode);

      if (!elementHandle) {
        throw new BrowserError(`Element: ${elementNode.toString()} not found`);
      }

      // 确保元素已准备好接收输入
      await elementHandle.waitForElementState('stable', { timeout: 2000 });
      await elementHandle.scrollIntoViewIfNeeded({ timeout: 2100 });

      // 获取元素属性以确定输入方法
      const isContentEditable = await elementHandle.getProperty('isContentEditable');

      // 对contenteditable和输入字段进行不同处理
      try {
        if (await isContentEditable.jsonValue()) {
          await elementHandle.evaluate('el => el.textContent = ""');
          await elementHandle.type(text, { delay: 5 });
        } else {
          await elementHandle.fill(text);
        }
      } catch (error) {
        logger.debug('无法向元素输入文本。尝试点击并输入。');
        await elementHandle.click();
        await elementHandle.type(text, { delay: 5 });
      }
    } catch (error) {
      logger.debug(`向元素输入文本失败: ${elementNode.toString()}. 错误: ${error}`);
      throw new BrowserError(`向索引 ${elementNode.highlightIndex} 的元素输入文本失败`);
    }
  }


  async _clickElementNode(elementNode: DOMElementNode): Promise<string | undefined> {
    const page = await this.getCurrentPage();
    
    try {
      // 点击前高亮元素
      if (elementNode.highlightIndex !== undefined) {
        await this._updateState(elementNode.highlightIndex);
      }
      
      const elementHandle = await this.getLocateElement(elementNode);
      
      if (!elementHandle) {
        throw new BrowserError(`Element: ${elementNode.toString()} not found`);
      }
      
      // 执行点击的内部函数
      const performClick = async (clickFunc: () => Promise<void>): Promise<string | undefined> => {
        if (this.config.saveDownloadsPath) {
          try {
            // 尝试使用短超时期望下载来检测是否触发了文件下载
            const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
            await clickFunc();
            const download = await downloadPromise;
            
            // 确定文件路径
            const suggestedFilename = download.suggestedFilename();
            const uniqueFilename = await this._getUniqueFilename(this.config.saveDownloadsPath, suggestedFilename);
            const downloadPath = path.join(this.config.saveDownloadsPath, uniqueFilename);
            
            await download.saveAs(downloadPath);
            logger.debug(`下载已触发。已保存文件到: ${downloadPath}`);
            return downloadPath;
          } catch (error) {
            // 如果没有触发下载，则视为普通点击
            if (error instanceof Error && error.name === 'TimeoutError') {
              logger.debug('在超时内未触发下载。检查导航...');
              await page.waitForLoadState();
              await this._checkAndHandleNavigation(page);
            } else {
              throw error;
            }
          }
        } else {
          // 如果不期望下载，则执行标准点击逻辑
          await clickFunc();
          await page.waitForLoadState();
          await this._checkAndHandleNavigation(page);
        }
        return undefined;
      };
      
      try {
        return await performClick(async () => await elementHandle.click({ timeout: 1500 }));
      } catch (error) {
        if (error instanceof Error && error.name === 'URLNotAllowedError') {
          throw error;
        } else {
          try {
            return await performClick(async () => 
              await page.evaluate(el => (el as HTMLElement).click(), elementHandle)
            );
          } catch (innerError) {
            if (innerError instanceof Error && innerError.name === 'URLNotAllowedError') {
              throw innerError;
            } else {
              throw new BrowserError(`Failed to click element: ${innerError}`);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'URLNotAllowedError') {
        throw error;
      } else {
        throw new BrowserError(`Failed to click element: ${elementNode.toString()}. Error: ${error}`);
      }
    }
  }

  async getTabsInfo(): Promise<TabInfo[]> {
    const session = await this.getSession();
    const tabsInfo: TabInfo[] = [];


    for (let index = 0; index < session.context.pages().length; index++) {
      const page = session.context.pages()[index];
      const tabInfo :TabInfo = { pageId: index, url: page.url(), title:await page.title()}
			tabsInfo.push(tabInfo)
    }
		return tabsInfo
  }

  async switchToTab(pageId: number): Promise<void> {
    const session = await this.getSession()
    const pages = session.context.pages();

		if( pageId >= pages.length)
			throw new  BrowserError(`No tab found with page_id: ${pageId}`)

		const page = pages[pageId]

		if(!this._isUrlAllowed(page.url()))
			throw new BrowserError(`Cannot switch to tab with non-allowed URL: ${page.url()}`)
		session.currentPage = page
		await page.bringToFront()
		await page.waitForLoadState()
  }

  async createNewTab(url?: string): Promise<void> {
    if (url && !this._isUrlAllowed(url))
			throw new BrowserError(`Cannot create new tab with non-allowed URL: ${url}`)

		const session = await this.getSession()
		const new_page = await session.context.newPage()
		session.currentPage = new_page

		await new_page.waitForLoadState()

		const page = await this.getCurrentPage()

		if (url)
			await page.goto(url)
			await this._waitForPageAndFramesLoad(1)
  }
  async getSelectorMap(): Promise<SelectorMap>{
    const session = await this.getSession()
    return session.cachedState.selectorMap
  }


  async getElementByIndex(index: number): Promise<ElementHandle | undefined>{
    const selector_map = await this.getSelectorMap()
    const element_handle = await this.getLocateElement(selector_map[index])
    return element_handle
  }


  async getDomElementByIndex(index: number): Promise<DOMElementNode | undefined>{
    const selector_map = await this.getSelectorMap()
    return selector_map[index]
  }


  async saveCookies(): Promise<void> {
    if (this.session && this.session.context && this.config.cookiesFile) {
			try {
				const cookies = await this.session.context.cookies()
				logger.debug(`Saving ${cookies.length} cookies to ${this.config.cookiesFile}`)

				// Check if the path is a directory and create it if necessary
				const dirname = path.dirname(this.config.cookiesFile)
				if (dirname) {
					fs.mkdirSync(dirname, { recursive: true })
				} 
				fs.writeFileSync(this.config.cookiesFile, JSON.stringify(cookies, null, 2))
			} catch (error) {
				logger.warn(`Failed to save cookies: ${error}`)
			}
    }
  }
  async isFileUploader(elementNode: DOMElementNode, maxDepth: number = 3, currentDepth: number = 0): Promise<boolean> {
    /**
     * 检查元素或其子元素是否为文件上传器
     * @param elementNode 要检查的DOM元素节点
     * @param maxDepth 最大递归深度
     * @param currentDepth 当前递归深度
     * @returns 如果元素或其子元素是文件上传器则返回true，否则返回false
     */
    if (currentDepth > maxDepth) {
      return false;
    }

    // 检查当前元素
    let isUploader = false;

    if (!(elementNode instanceof DOMElementNode)) {
      return false;
    }

    // 检查文件输入属性
    if (elementNode.tagName === 'input') {
      isUploader = elementNode.attributes['type'] === 'file' || elementNode.attributes['accept'] !== undefined;
    }

    if (isUploader) {
      return true;
    }

    // 递归检查子元素
    if (elementNode.children && currentDepth < maxDepth) {
      for (const child of elementNode.children) {
        if (child instanceof DOMElementNode) {
          if (await this.isFileUploader(child, maxDepth, currentDepth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async getScrollInfo(page: Page): Promise<{ pixelsAbove: number; pixelsBelow: number }> {
    try {
      const scrollY = await page.evaluate(() => window.scrollY);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      const totalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      
      const pixelsAbove = scrollY;
      const pixelsBelow = Math.max(0, totalHeight - (scrollY + viewportHeight));
      
      return { pixelsAbove, pixelsBelow };
    } catch (error) {
      logger.error(`获取滚动信息时出错: ${error}`);
      return { pixelsAbove: 0, pixelsBelow: 0 };
    }
  }

  async resetContext(): Promise<void> {
    const session = await this.getSession()
    const pages = session.context.pages()
    
    for (const page of pages) {
			await page.close()
    }

		session.cachedState = await this._getInitialState()
		session.currentPage = await session.context.newPage()
  }

  private async _getInitialState(page?: Page): Promise<BrowserState> {
    const initial_state = new BrowserState({
      elementTree: new DOMElementNode('root',
      '',
      {},
      [], true),
      selectorMap:{},
      url: page?.url() || '',
      title: '',
      tabs: [],
      screenshot: undefined,
    });

    initial_state.url = page?.url() || '';
    initial_state.title = '',
    initial_state.screenshot = undefined;
    initial_state.tabs = []

    return initial_state;
    
  }
  private async _getUniqueFilename(directory: string, filename: string): Promise<string> {
    /**
     * 生成唯一文件名，如果文件已存在则通过附加 (1), (2) 等方式区分
     */
    const { name, ext } = path.parse(filename);
    let counter = 1;
    let newFilename = filename;
    
    while (fs.existsSync(path.join(directory, newFilename))) {
      newFilename = `${name} (${counter})${ext}`;
      counter += 1;
    }
    
    return newFilename;
  }
} 