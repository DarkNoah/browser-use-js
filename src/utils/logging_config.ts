import pino from 'pino';
import path from 'path';
import fs from 'fs';
import pinoPretty from 'pino-pretty';

// 默认日志设置
let defaultLogLevel = 'info';
let defaultLogFile: string | null = null;

// 检查环境变量以获取日志设置
if (process.env.LOG_LEVEL) {
  defaultLogLevel = process.env.LOG_LEVEL;
}

if (process.env.LOG_FILE) {
  defaultLogFile = process.env.LOG_FILE;
}

// 创建日志目录（如果需要）
if (defaultLogFile) {
  const logDir = path.dirname(defaultLogFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// 创建基本的记录器设置
const loggerOptions: pino.LoggerOptions = {
  level: defaultLogLevel,
  browser: {
    asObject: true  // 启用浏览器兼容模式
  }
};

// 准备日志流数组
const logDestinations: pino.DestinationStream[] = [];

// 添加控制台输出，使用pretty格式
const prettyStream = pinoPretty({
  translateTime: 'SYS:standard',
  ignore: 'pid,hostname',
  colorize: true
});
logDestinations.push(prettyStream);

// 添加自定义流，确保在Debug Console中显示
const consoleStream = {
  write: (obj: any) => {
    try {
      const parsed = JSON.parse(obj);
      const level = parsed.level;
      const time = new Date().toISOString();
      const msg = parsed.msg || '';
      
      // 直接使用console对象，确保在Debug Console中显示
      if (level >= 50) console.error(`[${time}] ERROR: ${msg}`);
      else if (level >= 40) console.warn(`[${time}] WARN: ${msg}`);
      else if (level >= 30) console.info(`[${time}] INFO: ${msg}`);
      else if (level >= 20) console.debug(`[${time}] DEBUG: ${msg}`);
      else console.trace(`[${time}] TRACE: ${msg}`);
    } catch (e) {
      console.log(obj);
    }
  }
};
logDestinations.push(consoleStream as pino.DestinationStream);

// 如果指定了文件，则添加文件输出
if (defaultLogFile) {
  const fileDestination = pino.destination({
    dest: defaultLogFile,
    sync: false
  });
  
  // 处理进程终止时的日志刷新
  process.on('exit', () => {
    fileDestination.flushSync();
  });
  
  // 捕获异常也要刷新日志
  process.on('uncaughtException', (err) => {
    console.error(err);
    fileDestination.flushSync();
    process.exit(1);
  });
  
  logDestinations.push(fileDestination);
}

// 创建和导出记录器
export const logger = pino(loggerOptions, pino.multistream(logDestinations));

// 添加直接的控制台日志方法，确保在Debug Console中显示
export const consoleLogger = {
  debug: (msg: string, ...args: any[]) => {
    console.debug(msg, ...args);
    logger.debug(msg);
  },
  info: (msg: string, ...args: any[]) => {
    console.info(msg, ...args);
    logger.info(msg);
  },
  warn: (msg: string, ...args: any[]) => {
    console.warn(msg, ...args);
    logger.warn(msg);
  },
  error: (msg: string, ...args: any[]) => {
    console.error(msg, ...args);
    logger.error(msg);
  }
};

// 设置日志环境的函数
export function setupLogging(
  logLevel: string = defaultLogLevel,
  logFile: string | null = defaultLogFile
): void {
  // 已经在模块级别创建了日志记录器，这里主要用于API的一致性
  const message = `Logging initialized: level=${logLevel}, file=${logFile || 'console only'}`;
  console.info(message); // 确保在Debug Console中显示
  logger.info(message);
}

export default logger; 