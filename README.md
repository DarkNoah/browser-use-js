# Browser-Use-JS

使用AI控制您的浏览器 - TypeScript版本。这是[Browser-Use](https://github.com/browser-use/browser-use) Python库的TypeScript/Node.js移植版本。

## 简介

Browser-Use-JS是一个Node.js库，它使AI代理能够像人类一样控制浏览器。它基于Playwright和LangChain，允许AI代理执行以下操作：

- 导航到网站
- 点击元素
- 填写表单
- 提取内容
- 在多个标签页之间切换
- 执行复杂的浏览任务

## 快速开始

使用npm安装：

```bash
npm install browser-use-js
```

安装Playwright：

```bash
npx playwright install
```

创建您的代理：

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { Agent } from 'browser-use-js';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

async function main() {
  // 初始化语言模型
  const llm = new ChatOpenAI({
    modelName: 'gpt-4o',
    temperature: 0.0,
  });

  // 创建代理实例
  const agent = new Agent(
    task: "前往Reddit，搜索'browser-use'，点击第一个帖子并返回第一条评论。",
    llm: llm,
  );

  // 运行代理
  const result = await agent.run();
  console.log(result);
}

main().catch(console.error);
```

为您想使用的提供商将API密钥添加到您的`.env`文件中：

```bash
OPENAI_API_KEY=your_api_key_here
```

## 功能

- 🌐 完全控制浏览器
- 🤖 AI驱动的自动化
- 📷 视觉理解
- 🧠 复杂任务规划
- 📊 DOM处理
- 🔄 多标签页支持

## 示例

查看[examples](./examples)目录以获取更多示例代码。

## 贡献

欢迎贡献！请随时提交问题或功能请求。

## 许可证

ISC

## 致谢

该项目是[Browser-Use](https://github.com/browser-use/browser-use) Python库的TypeScript移植版本，感谢原始项目的作者创建了这个出色的工具。 