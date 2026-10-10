// Public barrel: factory, registry contract, config keys, identity.
export { buildServer } from "./server/buildServer.js";
export type {
  BuiltServer,
  BuildServerOptions,
  ServerContext,
} from "./server/buildServer.js";
export {
  DuplicateToolError,
  DUPLICATE_TOOL,
  EXEC_DESCRIPTION_FENCE,
  ToolRegistry,
} from "./server/toolRegistry.js";
export type {
  BudgetClass,
  ToolDef,
  ToolHandler,
  ToolKind,
} from "./server/toolRegistry.js";
export {
  defaultStatusRecord,
  registerServerStatusTool,
  SERVER_STATUS_TOOL,
} from "./server/serverStatus.js";
export type { ServerStatusRecord } from "./server/serverStatus.js";
export { loadConfig, defaultConfig } from "./server/config.js";
export type { GodotMcpConfig } from "./server/config.js";
export {
  CORE_PLUGIN_LIMITS,
  PLUGIN_LIMITS_POINTER,
  PluginConfinementError,
  PluginHotLoader,
  PluginStartupError,
  assertHandlerConfined,
  defaultPluginImporter,
  isGameContentName,
  loadStartupPlugins,
  normalizePluginDef,
  normalizePluginModule,
  resolvePluginDir,
} from "./server/pluginLoader.js";
export type {
  HotLoadResult,
  LoadStartupPluginsOptions,
  PluginModuleImporter,
} from "./server/pluginLoader.js";
export { SERVER_NAME, SERVER_VERSION } from "./version.js";
