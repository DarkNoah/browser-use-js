import { ChatOpenAI } from '@langchain/openai';
import { Agent, Browser, BrowserConfig } from '../../src';
import * as dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';

// 加载环境变量
dotenv.config();

async function main() {
  // 确保设置了OpenAI API密钥
  if (!process.env.OPENAI_API_KEY) {
    console.error('请在.env文件中设置OPENAI_API_KEY');
    process.exit(1);
  }
  const browser = new Browser({

    //chromeInstancePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    chromeInstancePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    extraChromiumArgs:['--disable-blink-features=AutomationControlled']
  } as BrowserConfig);

  // 初始化语言模型
  const llm = new ChatOpenAI({
    modelName: 'gpt-4o',
    temperature: 0.0,
    configuration: {
        httpAgent: new HttpsProxyAgent('http://127.0.0.1:10809'),
      },
  });


  // 定义任务
  const task = '发一篇小红书,标题为browser-use-js已开源';

  // 创建代理实例
  const agent = new Agent({
    task, llm, useVision: false, browser});

  try {
    // 运行代理
    const result = await agent.run();
    console.log('任务结果:', result);
  } catch (error) {
    console.error('运行代理时出错:', error);
  }
}

// 执行主函数
main().catch(console.error); 