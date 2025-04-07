export * from './views';
export * from './service';

// 导出便捷获取telemetry服务的函数
import { getTelemetryService } from './service';
export { getTelemetryService };

// 默认导出
export default getTelemetryService(); 