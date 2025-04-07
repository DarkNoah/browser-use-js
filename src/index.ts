import { setupLogging } from './utils/logging_config';

setupLogging();

// Export all public classes and types
export { Agent } from './agent/service';
export { SystemPrompt } from './agent/prompts';
export { ActionResult, AgentHistoryList } from './agent/views';
export { Browser, BrowserConfig } from './browser/browser';
export { BrowserContextConfig } from './browser/context';
export { Controller } from './controller/service';
export { DomService } from './dom/service'; 