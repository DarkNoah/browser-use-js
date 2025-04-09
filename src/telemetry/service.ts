import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { BaseTelemetryEvent } from './views';
import { PostHog } from 'posthog-node'

// PostHog类型定义
interface PostHogClient {
  capture(userId: string, eventName: string, properties: Record<string, any>): void;
}

// 用于模拟Python中的singleton装饰器
let instance: ProductTelemetry | null = null;

const POSTHOG_EVENT_SETTINGS = {
  process_person_profile: true,
};

export class ProductTelemetry {
  private static readonly USER_ID_PATH = path.join(
    os.homedir(),
    '.cache',
    'browser_use',
    'telemetry_user_id'
  );
  private static readonly PROJECT_API_KEY = 'phc_F8JMNjW1i2KbGUTaW1unnDdLSPCoyc52SGRU0JecaUh';
  private static readonly HOST = 'https://eu.i.posthog.com';
  private static readonly UNKNOWN_USER_ID = 'UNKNOWN';

  private _currUserId?: string;
  private _posthogClient?: PostHog;
  private debugLogging: boolean = false;

  constructor() {
    // 如果已经有实例，则返回该实例（单例模式）
    if (instance) {
      return instance;
    }
    instance = this;

    let telemetryDisabled = true;
    if (process.env.ANONYMIZED_TELEMETRY) {
      telemetryDisabled = process.env.ANONYMIZED_TELEMETRY?.toLowerCase() === 'false';
    }
    
    this.debugLogging = process.env.BROWSER_USE_LOGGING_LEVEL?.toLowerCase() === 'debug';

    if (telemetryDisabled) {
      this._posthogClient = undefined;
    } else {
      console.info(
        'Anonymized telemetry enabled. See https://docs.browser-use.com/development/telemetry for more information.'
      );
      
      // 需要引入PostHog JavaScript SDK
      try {
        // 这里假设已经安装了posthog-node包
        // 实际使用时，需要安装： npm install posthog-node

        this._posthogClient = new PostHog(
          ProductTelemetry.PROJECT_API_KEY,
          {
            host: ProductTelemetry.HOST,
            disableGeoip: false
          }
        );
      } catch (e) {
        console.error('Failed to initialize PostHog client', e);
        this._posthogClient = undefined;
      }
    }

    if (this._posthogClient === null) {
      console.debug('Telemetry disabled');
    }
  }

  public capture(event: BaseTelemetryEvent): void {
    if (!this._posthogClient) {
      return;
    }

    if (this.debugLogging) {
      console.debug(`Telemetry event: ${event.name} ${JSON.stringify(event.properties)}`);
    }
    this._directCapture(event);
  }

  private _directCapture(event: BaseTelemetryEvent): void {
    if (!this._posthogClient) {
      return;
    }

    try {
      this._posthogClient.capture({
        distinctId: this.userId,
        event: event.name,
        properties: { ...event.properties, ...POSTHOG_EVENT_SETTINGS }
      });
    } catch (e) {
      console.error(`Failed to send telemetry event ${event.name}:`, e);
    }
  }

  private get userId(): string {
    if (this._currUserId) {
      return this._currUserId;
    }

    try {
      const dirPath = path.dirname(ProductTelemetry.USER_ID_PATH);
      
      if (!fs.existsSync(ProductTelemetry.USER_ID_PATH)) {
        // 创建目录（如果不存在）
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        
        // 创建一个新的UUID并保存
        const newUserId = uuidv4();
        fs.writeFileSync(ProductTelemetry.USER_ID_PATH, newUserId);
        this._currUserId = newUserId;
      } else {
        // 读取现有的UUID
        this._currUserId = fs.readFileSync(ProductTelemetry.USER_ID_PATH, 'utf8');
      }
    } catch (e) {
      this._currUserId = 'UNKNOWN_USER_ID';
    }
    
    return this._currUserId;
  }

  // 获取单例实例的静态方法
  public static getInstance(): ProductTelemetry {
    if (!instance) {
      instance = new ProductTelemetry();
    }
    return instance;
  }
}

// 导出一个获取单例的函数
export function getTelemetryService(): ProductTelemetry {
  return ProductTelemetry.getInstance();
} 