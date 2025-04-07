import { Browser as PlaywrightBrowser, chromium, BrowserContext as PlaywrightBrowserContext } from 'playwright';
import logger from '../utils/logging_config';
import { execSync, spawn } from 'child_process';
import { BrowserContext, BrowserContextConfig } from './context';
import  fetch  from 'node-fetch';

// 定义代理设置接口
interface ProxySettings {
  server: string;
  bypass?: string;
  username?: string;
  password?: string;
}



export class BrowserConfig{
  headless: boolean = false
	disableSecurity: boolean = true
	extraChromiumArgs: string[] = []
	chromeInstancePath?: string 
	wssUrl?: string
	cdpUrl?: string
	proxy?: ProxySettings
	newContextConfig: BrowserContextConfig = new BrowserContextConfig()
	_forceKeepBrowserAlive: boolean = false
  constructor(config?: Partial<BrowserConfig>){
    this.headless = config?.headless || false;
    this.extraChromiumArgs = config?.extraChromiumArgs || [];

    this.newContextConfig = config?.newContextConfig || new BrowserContextConfig();
    
    this.disableSecurity = config?.disableSecurity || true;
    this.chromeInstancePath = config?.chromeInstancePath;
    this.wssUrl = config?.wssUrl;
    this.cdpUrl = config?.cdpUrl;
    this.proxy = config?.proxy;
    this._forceKeepBrowserAlive = config?._forceKeepBrowserAlive || false;
  }
}



/**
 * 增强版Playwright浏览器
 * 
 * 这是一个持久性浏览器工厂，可以生成多个浏览器上下文。
 * 建议每个应用程序只使用一个Browser实例（否则RAM使用量会增长）。
 */
export class Browser {
  config: BrowserConfig;
  playwright: any | null = null;
  playwrightBrowser: PlaywrightBrowser | null = null;
  disableSecurityArgs: string[] = [];

  /**
   * 创建Browser实例
   * @param config 浏览器配置
   */
  constructor(config: BrowserConfig = new BrowserConfig()) {
    logger.debug('初始化新浏览器');
    this.config = config;

    if (this.config.disableSecurity) {
      this.disableSecurityArgs = [
        '--disable-web-security',
        '--disable-site-isolation-trials',
        '--disable-features=IsolateOrigins,site-per-process'
      ];
    }
  }

  async newContext(config: BrowserContextConfig = new BrowserContextConfig()): Promise<BrowserContext> {
    return new BrowserContext(this, config);
  }

  /**
   * 获取Playwright浏览器实例
   */
  async getPlaywrightBrowser(): Promise<PlaywrightBrowser> {
    if (this.playwrightBrowser === null) {
      return await this._init();
    }
    return this.playwrightBrowser;
  }

  private async _init(): Promise<PlaywrightBrowser> {
    const browser = await this._setupBrowser();
    this.playwrightBrowser = browser;
    return this.playwrightBrowser;
  }

  private async _setupCdp(): Promise<PlaywrightBrowser> {
    if (!this.config.cdpUrl) {
      throw new Error('CDP URL是必需的');
    }
    logger.info(`通过CDP连接到远程浏览器 ${this.config.cdpUrl}`);
    const browser = await chromium.connectOverCDP(this.config.cdpUrl);
    return browser;
  }

  private async _setupWss(): Promise<PlaywrightBrowser> {
    if (!this.config.wssUrl) {
      throw new Error('WSS URL是必需的');
    }
    logger.info(`通过WSS连接到远程浏览器 ${this.config.wssUrl}`);
    const browser = await chromium.connect(this.config.wssUrl);
    return browser;
  }

  private async _setupBrowserWithInstance(): Promise<PlaywrightBrowser> {
    if (!this.config.chromeInstancePath) {
      throw new Error('Chrome实例路径是必需的');
    }

    // 需要安装node-fetch
    //const fetch = require('node-fetch');

    try {
      // 检查浏览器是否已经运行
      const response = await fetch('http://localhost:9222/json/version',{timeout: 20000});
      if (response.status === 200) {
        logger.info('重用现有的Chrome实例');
        const browser = await chromium.connectOverCDP('http://localhost:9222',{
          timeout: 20000 // 连接超时20秒
        });
        return browser;
      }
    } catch (error) {
      logger.debug('未找到现有Chrome实例，启动新实例');
    }
    const extraChromiumArgs = this.config.extraChromiumArgs || [];
    // 启动新的Chrome实例
    const chromeProcess = spawn(
      this.config.chromeInstancePath,
      [
        '--remote-debugging-port=9222',
        ...extraChromiumArgs
      ],
      {
        stdio: 'ignore'
      }
    );

    // 尝试连接
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch('http://localhost:9222/json/version',{timeout: 20000});
        if (response.status === 200) {
          break;
        }
      } catch (error) {
        // 继续尝试
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 再次尝试连接
    try {
      const browser = await chromium.connectOverCDP('http://localhost:9222', {
        
        timeout: 20000 // 连接超时20秒
      });
      return browser;
    } catch (error) {
      logger.error(`启动新Chrome实例失败: ${error}`);
      throw new Error(
        '要在调试模式下启动Chrome，您需要关闭所有现有的Chrome实例然后重试，否则我们无法连接到实例。'
      );
    }
  }

  /**
   * 设置标准浏览器
   */
  private async _setupStandardBrowser(): Promise<PlaywrightBrowser> {
    const browser = await chromium.launch({
      headless: this.config.headless,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-background-timer-throttling',
        '--disable-popup-blocking',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-window-activation',
        '--disable-focus-on-load',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-startup-window',
        '--window-position=0,0',
        ...this.disableSecurityArgs,
        ...this.config.extraChromiumArgs
      ],
      proxy: this.config.proxy
    });
    return browser;
  }

  /**
   * 设置浏览器
   */
  private async _setupBrowser(): Promise<PlaywrightBrowser> {
    if (this.config.cdpUrl) {
      return await this._setupCdp();
    }
    if (this.config.wssUrl) {
      return await this._setupWss();
    }
    if (this.config.chromeInstancePath) {
      return await this._setupBrowserWithInstance();
    }
    return await this._setupStandardBrowser();
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    try {
      if (this.playwrightBrowser && !this.config._forceKeepBrowserAlive) {
        await this.playwrightBrowser.close();
      }
    } catch (error) {
      logger.error(`关闭浏览器时出错: ${error}`);
    } finally {
      this.playwrightBrowser = null;
    }
  }
} 