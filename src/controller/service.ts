/**
 * 控制器服务
 * 负责管理和执行动作
 */
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import logger from '../utils/logging_config';
import { ActionResult } from '../agent/views';
import { Registry } from './registry/service';
import { BrowserContext } from '../browser/context';
import { 
  ClickElementAction, 
  DoneAction, 
  GoToUrlAction, 
  InputTextAction, 
  NoParamsAction, 
  OpenTabAction, 
  ScrollAction, 
  SearchGoogleAction, 
  SendKeysAction,
  SwitchTabAction,
  ExtractContentAction,
  GetDropdownOptionsAction,
  SelectDropdownOptionAction,
  ScrolToTextAction
} from './views';
import { timeExecutionAsync, convertHtmlToMarkdown } from '../utils';
import { ActionModel } from './registry/views';
import z from 'zod';
import fs from 'fs';
import pdfParse from 'pdf-parse';

/**
 * 控制器类
 * 管理动作的注册和执行
 */
export class Controller {
  /**
   * 动作注册器
   */
  readonly registry: Registry;
  
  /**
   * 排除的动作
   */
  private excludeActions: string[];
  
  /**
   * 输出模型
   */
  private outputModel: any | null;

  /**
   * 创建Controller实例
   * @param excludeActions 排除的动作
   * @param outputModel 自定义输出模型
   */
  constructor(excludeActions: string[] = [], outputModel: any | null = null) {
    this.excludeActions = excludeActions;
    this.outputModel = outputModel;
    this.registry = new Registry(excludeActions);
    this._registerDefaultActions();
  }

  /**
   * 注册默认动作
   */
  private _registerDefaultActions(): void {
    // 如果有自定义输出模型
    if (this.outputModel) {
      this.registry.action('完成任务','done', this.outputModel, this.outputModel.schema())(
        async (params: any): Promise<ActionResult> => {
          return new ActionResult({ 
            isDone: true, 
            extractedContent: JSON.stringify(params) 
          });
        }
      );
    } else {
      // 默认完成动作
      this.registry.action('完成任务','done' ,DoneAction, DoneAction.schema())(
        async (params: DoneAction): Promise<ActionResult> => {
          return new ActionResult({ 
            isDone: true, 
            extractedContent: params.text 
          });
        }
      );
    }

    // 基本导航动作
    // this.registry.action(
    //   'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items. ',
    //   'search_google',
    //   SearchGoogleAction
    // )(
    //   async (params: SearchGoogleAction, browser: BrowserContext): Promise<ActionResult> => {
    //     const page = await browser.getCurrentPage();
    //     await page.goto(`https://www.google.com/search?q=${params.query}&udm=14`);
    //     await page.waitForLoadState();
        
    //     const message = `🔍 在Google中搜索了"${params.query}"`;
    //     logger.info(message);
        
    //     return new ActionResult({
    //       extractedContent: message,
    //       includeInMemory: true
    //     });
    //   }
    // );
    this.registry.action(
      'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items. ',
      'search_baidu',
      SearchGoogleAction,
      SearchGoogleAction.schema()
    )(
      async (params: SearchGoogleAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage();
        await page.goto(`https://www.baidu.com/s?wd=${params.query}`);
        await page.waitForLoadState();
        
        const message = `🔍 在百度中搜索了"${params.query}"`;
        logger.info(message);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );


    this.registry.action('在当前标签页中导航到URL','go_to_url', GoToUrlAction, GoToUrlAction.schema())(
      async (params: GoToUrlAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage()
        await page.goto(params.url);
        await page.waitForLoadState();
        const message = `🔗 导航到 ${params.url}`;
        logger.info(message);
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    this.registry.action('返回上一页','go_back',NoParamsAction, NoParamsAction.schema())(
      async (_: NoParamsAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        await browser.goBack();
        
        const message = '🔙 返回上一页';
        logger.info(message);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    // 元素交互动作
    this.registry.action('点击元素','click_element',ClickElementAction, ClickElementAction.schema())(
      async (params: ClickElementAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const session = await browser.getSession();
        const state = session.cachedState;

        if (!(params.index in state.selectorMap)) {
          throw new Error(`索引为 ${params.index} 的元素不存在 - 请重试或使用其他动作`);
        }

        const elementNode = state.selectorMap[params.index];
        const initialPages = session.context.pages().length;

        // 检查是否是文件上传器
        if (await browser.isFileUploader(elementNode)) {
          const message = `索引 ${params.index} - 有一个打开文件上传对话框的元素。要上传文件，请使用特定的上传文件功能`;
          logger.info(message);
          return new ActionResult({
            extractedContent: message,
            includeInMemory: true
          });
        }

        let message: string | null = null;

        try {
          const downloadPath = await browser._clickElementNode(elementNode);
          if (downloadPath) {
            message = `💾 下载文件到 ${downloadPath}`;
          } else {
            message = `🖱️ 点击了索引为 ${params.index} 的按钮: ${elementNode.getAllTextTillNextClickableElement(2)}`;
          }

          logger.info(message);
          logger.debug(`元素xpath: ${elementNode.xpath}`);
          
          const pages = session.context.pages();
          if (pages.length > initialPages) {
            const newTabMessage = '新标签页已打开 - 正在切换到该标签页';
            message += ` - ${newTabMessage}`;
            logger.info(newTabMessage);
            await browser.switchToTab(-1);
          }
          
          return new ActionResult({
            extractedContent: message,
            includeInMemory: true
          });
        } catch (error) {
          logger.error(`索引为 ${params.index} 的元素不可点击 - 可能页面已更改`);
          return new ActionResult({ error: String(error) });
        }
      }
    );

    this.registry.action('在交互元素中输入文本','input_text',InputTextAction, InputTextAction.schema())(
      async (params: InputTextAction, extraArgs: {
        browser: BrowserContext,
        hasSensitiveData: boolean
      }): Promise<ActionResult> => {
        const { browser, hasSensitiveData = false } = extraArgs;
        const session = await browser.getSession();
        const state = session.cachedState;

        if (!(params.index in state.selectorMap)) {
          throw new Error(`索引为 ${params.index} 的元素不存在 - 请重试或使用其他动作`);
        }

        const elementNode = state.selectorMap[params.index];
        await browser._inputTextElementNode(elementNode, params.text);
        
        let message: string;
        if (!hasSensitiveData) {
          message = `⌨️ 在索引为 ${params.index} 的输入框中输入 ${params.text}`;
        } else {
          message = `⌨️ 在索引为 ${params.index} 的输入框中输入敏感数据`;
        }
        
        logger.info(message);
        logger.debug(`元素xpath: ${elementNode.xpath}`);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    // 标签页管理动作
    this.registry.action('切换标签页','switch_tab',SwitchTabAction, SwitchTabAction.schema())(
      async (params: SwitchTabAction, extraArgs: {
        browser: BrowserContext }): Promise<ActionResult> => {
        await extraArgs.browser.switchToTab(params.pageId);
        // 等待标签页准备就绪
        const page = await extraArgs.browser.getCurrentPage();
        await page.waitForLoadState();
        
        const message = `🔄 切换到标签页 ${params.pageId}`;
        logger.info(message);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    this.registry.action('在新标签页中打开URL','open_tab', OpenTabAction,OpenTabAction.schema())(
      async (params: OpenTabAction,
        extraArgs: {
        browser: BrowserContext }
      ): Promise<ActionResult> => {
        await extraArgs.browser.createNewTab(params.url);
        
        const message = `🔗 在新标签页中打开 ${params.url}`;
        logger.info(message);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    // 提取页面内容
    this.registry.action(
      'Extract page content to retrieve specific information from the page, e.g. all company names, a specifc description, all information about, links with companies in structured format or simply links'
      , 'extract_content',
      ExtractContentAction,
      ExtractContentAction.schema()
    )(
      async (params: ExtractContentAction, extraArgs: {
        browser: BrowserContext,
        pageExtractionLlm: BaseChatModel
      }): Promise<ActionResult> => {
        const page = await extraArgs.browser.getCurrentPage();
        const pdfBuffer = await page.pdf({ displayHeaderFooter: false, printBackground: false });

        //const pdfPath = `./${Date.now()}.pdf`;
        //fs.writeFileSync(pdfPath, pdfBuffer);
        const pdfData = await pdfParse(pdfBuffer);
        const content = pdfData.text;



        //const content = convertHtmlToMarkdown(await page.content());
        //fs.writeFileSync('content.md', content);

        const prompt = 'Your task is to extract the content of the page. You will be given a page and a goal and you should extract all relevant information around this goal from the page. If the goal is vague, summarize the page. Respond in json format. Extraction goal: {goal}, Page: {page}';
        const template = new PromptTemplate({
          inputVariables: ['goal', 'page'],
          template: prompt
        });
        
        try {
          // 使用已知值创建输入并格式化
          const formattedPrompt = await template.format({
            goal: params.goal || '',
            page: content
          });
          
          // 调用LLM
          const result = await extraArgs.pageExtractionLlm.invoke(formattedPrompt);
          const message = `📄 从页面提取: ${result.content}`;
          logger.info(message);
          
          return new ActionResult({
            extractedContent: message,
            includeInMemory: true
          });
        } catch (error) {
          logger.debug(`提取内容时出错: ${error}`);
          const message = `📄 从页面提取: ${content}`;
          logger.info(message);
          
          return new ActionResult({ extractedContent: message });
        }
      }
    );

    this.registry.action(
      'Scroll down the page by pixel amount - if no amount is specified, scroll down one page',
      'scroll_down',
      ScrollAction,
      ScrollAction.schema()
    )(
      async (params: ScrollAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage();
        
        if (params.amount !== undefined) {
          await page.evaluate(`window.scrollBy(0, ${params.amount});`);
        } else {
          await page.evaluate('window.scrollBy(0, window.innerHeight);');
        }

        const amount = params.amount !== undefined ? `${params.amount} pixels` : 'one page';
        const message = `🔍 向下滚动页面 ${amount}`;
        logger.info(message);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    // scroll up
    this.registry.action(
      'Scroll up the page by pixel amount - if no amount is specified, scroll up one page',
      'scroll_up',
      ScrollAction,
      ScrollAction.schema()
    )(
      async (params: ScrollAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage();
        
        if (params.amount !== undefined) {
          await page.evaluate(`window.scrollBy(0, -${params.amount});`);
        } else {
          await page.evaluate('window.scrollBy(0, -window.innerHeight);');
        }

        const amount = params.amount !== undefined ? `${params.amount} pixels` : 'one page';
        const message = `🔍 向上滚动页面 ${amount}`;
        logger.info(message);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    // send keys
    this.registry.action(
      'Send special key strings like Backspace, Insert, PageDown, Delete, Enter, also support shortcut keys like `Control+o`, `Control+Shift+T`. This will be used for keyboard.press. Please note the difference in shortcut keys for different operating systems',
      'send_keys',
      SendKeysAction,
      SendKeysAction.schema()
    )(
      async (params: SendKeysAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage();
        
        await page.keyboard.press(params.keys);
        
        const message = `⌨️ 发送按键: ${params.keys}`;
        logger.info(message);
        
        return new ActionResult({
          extractedContent: message,
          includeInMemory: true
        });
      }
    );

    // 滚动到指定文本
    this.registry.action(
      'If you dont find something which you want to interact with, scroll to it',
      'scroll_to_text',
      ScrolToTextAction,
      ScrolToTextAction.schema()
    )(
      async (params: ScrolToTextAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage();
        
        try {
          // 尝试不同的定位策略
          const locators = [
            page.getByText(params.text, { exact: false }),
            page.locator(`text=${params.text}`),
            page.locator(`//*[contains(text(), '${params.text}')]`)
          ];

          for (const locator of locators) {
            try {
              // 首先检查元素是否存在且可见
              if (await locator.count() > 0 && await locator.first().isVisible()) {
                await locator.first().scrollIntoViewIfNeeded();
                // 等待滚动完成
                await page.waitForTimeout(500);
                
                const message = `🔍 滚动到文本: ${params.text}`;
                logger.info(message);
                
                return new ActionResult({
                  extractedContent: message,
                  includeInMemory: true
                });
              }
            } catch (error) {
              logger.debug(`定位器尝试失败: ${error}`);
              continue;
            }
          }

          const message = `文本 '${params.text}' 在页面上未找到或不可见`;
          logger.info(message);
          
          return new ActionResult({
            extractedContent: message,
            includeInMemory: true
          });
          
        } catch (error) {
          const message = `滚动到文本 '${params.text}' 失败: ${error}`;
          logger.error(message);
          
          return new ActionResult({ 
            error: message,
            includeInMemory: true 
          });
        }
      }
    );

    // 获取下拉菜单选项
    this.registry.action(
      'Get all options from a native dropdown',
      'get_dropdown_options',
      GetDropdownOptionsAction,
      GetDropdownOptionsAction.schema()
    )(
      async (params: GetDropdownOptionsAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage();
        const session = await browser.getSession();
        const state = session.cachedState;

        if (!(params.index in state.selectorMap)) {
          throw new Error(`索引为 ${params.index} 的元素不存在 - 请重试或使用其他动作`);
        }

        const elementNode = state.selectorMap[params.index];

        try {
          // 帧感知方法获取下拉菜单选项
          const allOptions = [];
          let frameIndex = 0;

          for (const frame of page.frames()) {
            try {
              const options: any = await frame.evaluate(`
                (xpath) => {
                  const select = document.evaluate(xpath, document, null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                  if (!select) return null;

                  return {
                    options: Array.from(select.options).map(opt => ({
                      text: opt.text, //不要修剪文本，因为我们在select_dropdown_option中进行精确匹配
                      value: opt.value,
                      index: opt.index
                    })),
                    id: select.id,
                    name: select.name
                  };
                }
              `, elementNode.xpath);

              if (options) {
                logger.debug(`在第 ${frameIndex} 帧中找到下拉菜单`);
                logger.debug(`下拉菜单 ID: ${options.id}, 名称: ${options.name}`);

                const formattedOptions = [];
                for (const opt of options.options) {
                  // 编码确保AI在select_dropdown_option中使用精确的字符串
                  const encodedText = JSON.stringify(opt.text);
                  formattedOptions.push(`${opt.index}: text=${encodedText}`);
                }

                allOptions.push(...formattedOptions);
              }
            } catch (error) {
              logger.debug(`第 ${frameIndex} 帧评估失败: ${error}`);
            }

            frameIndex++;
          }

          if (allOptions.length > 0) {
            const message = allOptions.join('\n') + '\n使用select_dropdown_option中的精确文本字符串';
            logger.info(message);
            
            return new ActionResult({
              extractedContent: message,
              includeInMemory: true
            });
          } else {
            const message = '在任何帧中没有找到下拉菜单选项';
            logger.info(message);
            
            return new ActionResult({
              extractedContent: message,
              includeInMemory: true
            });
          }
        } catch (error) {
          logger.error(`获取下拉菜单选项失败: ${error}`);
          const message = `获取选项时出错: ${error}`;
          logger.info(message);
          
          return new ActionResult({
            extractedContent: message,
            includeInMemory: true
          });
        }
      }
    );

    // 选择下拉菜单选项
    this.registry.action(
      'Select dropdown option for interactive element index by the text of the option you want to select',
      'select_dropdown_option',
      SelectDropdownOptionAction,
      SelectDropdownOptionAction.schema()
    )(
      async (params: SelectDropdownOptionAction, extraArgs: {
        browser: BrowserContext,
      }): Promise<ActionResult> => {
        const { browser } = extraArgs;
        const page = await browser.getCurrentPage();
        const session = await browser.getSession();
        const state = session.cachedState;

        if (!(params.index in state.selectorMap)) {
          throw new Error(`索引为 ${params.index} 的元素不存在 - 请重试或使用其他动作`);
        }

        const elementNode = state.selectorMap[params.index];
        
        logger.debug(`尝试为索引 ${params.index} 选择选项 '${params.text}', 使用xpath: ${elementNode.xpath}`);
        logger.debug(`元素标签: ${elementNode.tag || '未知'}`);

        try {
          // 帧感知方法选择下拉菜单选项
          let frameIndex = 0;

          for (const frame of page.frames()) {
            try {
              logger.debug(`尝试第 ${frameIndex} 帧`);
              
              // 首先验证我们能在这个帧中找到下拉菜单
              const findDropdownJs = `
                (xpath) => {
                  try {
                    const select = document.evaluate(xpath, document, null,
                      XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (!select) return null;
                    if (select.tagName.toLowerCase() !== 'select') {
                      return {
                        error: \`找到元素但它是 \${select.tagName}, 不是 SELECT\`,
                        found: false
                      };
                    }
                    return {
                      id: select.id,
                      name: select.name,
                      found: true,
                      tagName: select.tagName,
                      optionCount: select.options.length,
                      currentValue: select.value,
                      availableOptions: Array.from(select.options).map(o => o.text.trim())
                    };
                  } catch (e) {
                    return {error: e.toString(), found: false};
                  }
                }
              `;

              // 定义dropdown信息的接口类型
              interface DropdownInfo {
                error?: string;
                found?: boolean;
                id?: string;
                name?: string;
                tagName?: string;
                optionCount?: number;
                currentValue?: string;
                availableOptions?: string[];
              }

              const dropdownInfo = await frame.evaluate(findDropdownJs, elementNode.xpath) as DropdownInfo | null;
              
              if (dropdownInfo) {
                if (!dropdownInfo.found) {
                  logger.error(`第 ${frameIndex} 帧错误: ${dropdownInfo.error || '未知错误'}`);
                  frameIndex++;
                  continue;
                }
                
                logger.debug(`在第 ${frameIndex} 帧中找到下拉菜单: ${JSON.stringify(dropdownInfo)}`);
                
                try {
                  // 尝试使用playwright的内置选择器方法
                  const selector = '//' + elementNode.xpath;
                  await frame.locator(selector).selectOption({ label: params.text }, { timeout: 2000 });
                  
                  const message = `📋 在索引为 ${params.index} 的下拉菜单中选择了选项: ${params.text}`;
                  logger.info(message);
                  
                  return new ActionResult({
                    extractedContent: message,
                    includeInMemory: true
                  });
                } catch (selectError) {
                  logger.debug(`使用selectOption方法失败: ${selectError}`);
                  logger.debug(`尝试备用JavaScript方法`);
                  
                  // 定义结果类型
                  interface SelectResult {
                    success: boolean;
                    error?: string;
                    value?: string;
                    index?: number;
                    selectId?: string;
                    selectName?: string;
                    availableOptions?: string[];
                  }
                  
                  // 如果内置选择方法失败，尝试使用JavaScript
                  const selectJs = `
                    (xpath, optionText) => {
                      try {
                        const select = document.evaluate(xpath, document, null,
                          XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (!select) return { success: false, error: "找不到下拉菜单元素" };

                        // 查找匹配文本的选项
                        for (let i = 0; i < select.options.length; i++) {
                          const option = select.options[i];
                          if (option.text.trim() === optionText) {
                            select.selectedIndex = i;
                            option.selected = true;
                            
                            // 触发change事件
                            const event = new Event('change', { bubbles: true });
                            select.dispatchEvent(event);
                            
                            return { 
                              success: true, 
                              value: option.value,
                              index: i,
                              selectId: select.id,
                              selectName: select.name
                            };
                          }
                        }

                        return { 
                          success: false, 
                          error: "未找到匹配的选项",
                          availableOptions: Array.from(select.options).map(o => o.text.trim()),
                          selectId: select.id,
                          selectName: select.name
                        };
                      } catch (e) {
                        return { success: false, error: e.toString() };
                      }
                    }
                  `;
                  
                  const result = await frame.evaluate(selectJs, [elementNode.xpath, params.text]) as SelectResult;
                  
                  if (result.success) {
                    logger.debug(`在第 ${frameIndex} 帧中选择了下拉菜单选项`);
                    logger.debug(`下拉菜单 ID: ${result.selectId || '无ID'}, 名称: ${result.selectName || '无名称'}, 值: ${result.value || '无值'}`);
                    
                    const message = `📋 在索引为 ${params.index} 的下拉菜单中选择了选项: ${params.text} (值: ${result.value || '未知'})`;
                    logger.info(message);
                    
                    return new ActionResult({
                      extractedContent: message,
                      includeInMemory: true
                    });
                  } else {
                    logger.debug(`选择失败: ${result.error || '未知错误'}`);
                    if (result.availableOptions) {
                      logger.debug(`可用选项: ${JSON.stringify(result.availableOptions)}`);
                    }
                  }
                }
              }
            } catch (error) {
              logger.debug(`第 ${frameIndex} 帧处理失败: ${error}`);
            }

            frameIndex++;
          }

          const message = `在下拉菜单中未找到文本为 '${params.text}' 的选项`;
          logger.info(message);
          
          return new ActionResult({
            extractedContent: message,
            includeInMemory: true
          });
        } catch (error) {
          logger.error(`选择下拉菜单选项失败: ${error}`);
          const message = `选择选项时出错: ${error}`;
          logger.info(message);
          
          return new ActionResult({
            error: String(error),
            extractedContent: message,
            includeInMemory: true
          });
        }
      }
    );
  }

  action(description: string, name:string, paramModel: any, schema: z.ZodSchema) {
    return this.registry.action(description,name, paramModel, schema)
  }


  /**
   * 执行单个动作
   * @param action 要执行的动作
   * @param browserContext 浏览器上下文
   * @param pageExtractionLlm 页面提取LLM（可选）
   * @param sensitiveData 敏感数据（可选）
   * @param availableFilePaths 可用文件路径（可选）
   * @returns 动作执行结果
   */
  async act(
    action: ActionModel,
    browserContext: BrowserContext,
    pageExtractionLlm?: BaseChatModel,
    sensitiveData?: Record<string, string>,
    availableFilePaths?: string[]
  ): Promise<ActionResult> {
    try {
      return await timeExecutionAsync<ActionResult>(async () => {
        const actionData = Object.entries(action).find(([_, value]) => value !== undefined);
        
        if (!actionData) {
          return new ActionResult();
        }
        
        const [actionName, params] = actionData;
        
        // 执行动作并记录
        const result = await this.registry.executeAction(
          actionName,
          params,
          browserContext,
          pageExtractionLlm,
          sensitiveData,
          availableFilePaths
        );
        
        // 处理结果
        if (typeof result === 'string') {
          return new ActionResult({ extractedContent: result });
        } else if (result instanceof ActionResult) {
          return result;
        } else if (result === null || result === undefined) {
          return new ActionResult();
        } else {
          throw new Error(`非法的动作执行结果类型: ${typeof result}`);
        }
       },'--act')
      
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * 执行多个动作
   * @param actions 要执行的动作列表
   * @param browserContext 浏览器上下文
   * @param checkBreakIfPaused 检查是否暂停的回调函数
   * @param checkForNewElements 是否检查新元素（默认为true）
   * @param pageExtractionLlm 页面提取LLM（可选）
   * @param sensitiveData 敏感数据（可选）
   * @param availableFilePaths 可用文件路径（可选）
   * @returns 动作执行结果列表
   */
  async multiAct(
    actions: ActionModel[],
    browserContext: BrowserContext,
    checkBreakIfPaused: () => boolean,
    checkForNewElements: boolean = true,
    pageExtractionLlm?: BaseChatModel,
    sensitiveData?: Record<string, string>,
    availableFilePaths?: string[]
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    
    // 获取会话和初始元素哈希
    const session = await browserContext.getSession();
    const cachedSelectorMap = session.cachedState.selectorMap;
    
    // 收集初始元素IDs（不使用哈希，因为当前接口中不存在）
    const cached_path_hashes = new Set(
      Object.values(cachedSelectorMap).map(e => e.hash.branchPathHash)
    );
    
    // 检查是否暂停
    checkBreakIfPaused();
    
    await browserContext.removeHighlights();
    
    // 逐个执行动作
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      
      // 检查是否暂停
      checkBreakIfPaused();
      
      if (action.getIndex() !== undefined && i !== 0) { 
        const newState = await browserContext.getState();
        const new_path_hashes = new Set(
          Object.values(newState.selectorMap).map(e => e.hash.branchPathHash)
        );

        if (checkForNewElements && !isSubset(new_path_hashes, cached_path_hashes)) {
          const msg = `动作 ${i} / ${actions.length} 执行后出现了新内容`;
          logger.info(msg)
          results.push(new ActionResult({ 
            extractedContent: msg, 
            includeInMemory: true 
          }));
          break
        }
      }
      checkBreakIfPaused();

      results.push(await this.act(
        action, 
        browserContext, 
        pageExtractionLlm, 
        sensitiveData, 
        availableFilePaths
      ));

      logger.debug(`执行了动作 ${i + 1} / ${actions.length}`);
      
      // 检查是否终止
      if (results[results.length - 1].isDone || 
          results[results.length - 1].error || 
          i === actions.length - 1) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, browserContext.config.waitBetweenActions));
    }
    
    return results;
  }

} 

/**
 * 检查集合A是否是集合B的子集
 * @param setA 集合A
 * @param setB 集合B
 * @returns 如果A是B的子集返回true，否则返回false
 */
function isSubset<T>(setA: Set<T>, setB: Set<T>): boolean {
  for (const elem of setA) {
    if (!setB.has(elem)) {
      return false;
    }
  }
  return true;
} 