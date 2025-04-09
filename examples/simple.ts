import { ChatOpenAI } from '@langchain/openai';
import { Agent } from '../src';
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

  // 初始化语言模型
  const llm = new ChatOpenAI({
    modelName: 'gpt-4o',
    temperature: 0.0,
    configuration: {
        httpAgent: new HttpsProxyAgent('http://127.0.0.1:10809'),
      },
  });


  // 定义任务
  const task = '找一下广州最近的aiagent比赛';

  // 创建代理实例
  const agent = new Agent({
    task, llm, useVision: false, initialActions: [
      //{'open_tab': {'url': 'https://www.baidu.com'}}
    ], plannerLlm: undefined });

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