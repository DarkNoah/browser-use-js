import z from "zod";

export class SearchGoogleAction {
  query: string = "";
  static schema() {
    return z.object({
      query: z.string().describe("搜索查询"),
    });
  }
}

export class GoToUrlAction {
  url: string = "";
  static schema() {
    return z.object({
      url: z.string().describe("目标URL"),
    });
  }
}

export class ClickElementAction {
  index: number = -1;

  xpath?: string;

  static schema() {
    return z.object({
      index: z.number(),
      xpath: z.string().describe("XPath").optional(),
    });
  }
}

export class InputTextAction {
  index: number = -1;
  text: string = "";
  xpath?: string;

  static schema() {
    return z.object({
      index: z.number(),
      text: z.string(),
      xpath: z.string().describe("XPath").optional(),
    });
  }
}

export class DoneAction {
  text: string = "";
  static schema() {
    return z.object({
      text: z.string(),
    });
  }
}

export class SwitchTabAction {
  pageId: number = 0;
  static schema() {
    return z.object({
      pageId: z.number(),
    });
  }
}

export class OpenTabAction {
  url: string = "";
  static schema() {
    return z.object({
      url: z.string(),
    });
  }
}

export class ScrollAction {
  amount?: number;
  static schema() {
    return z.object({
      amount: z.number().optional(),
    });
  }
}

export class ScrolToTextAction {
  text!: string;

  static schema() {
    return z.object({
      text: z.string(),
    });
  }
}

export class SendKeysAction {
  keys: string = "";
  static schema() {
    return z.object({
      keys: z.string(),
    });
  }
}

export class NoParamsAction {
  // 空对象，表示没有参数的动作
  static schema() {
    return z.object({});
  }
}

export class ExtractContentAction {
  goal: string = "";
  static schema() {
    return z.object({
      goal: z.string(),
    });
  }
}

/**
 * 获取下拉菜单选项动作
 */
export class GetDropdownOptionsAction {
  index: number = -1;
  static schema() {
    return z.object({
      index: z.number(),
    });
  }
}

/**
 * 选择下拉菜单选项动作
 */
export class SelectDropdownOptionAction {
  /**
   * 元素索引
   */
  index: number = -1;

  /**
   * 选项文本
   */
  text: string = "";
  static schema() {
    return z.object({
      text: z.string().describe("选项文本"),
    });
  }
}

export class WaitAction {
  /**
   * 等待时间，单位为秒
   */
  seconds: number = 3;

  static schema() {
    return z.object({
      seconds: z.number().default(3).describe("等待时间，单位为秒默认3秒"),
    });
  }
}

export class CloseTabAction {
  pageId: number = 0;
  static schema() {
    return z.object({
      pageId: z.number(),
    });
  }
}

export class SavePdfAction {
  static schema() {
    return z.object({});
  }
}
