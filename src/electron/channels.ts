export const ELECTRON_CHANNELS = {
  appendStoreRecords: "masthead:store:append",
  clearLocalData: "masthead:store:clear",
  exportStoreRecords: "masthead:store:export",
  mcpLaunchConfig: "masthead:mcp:launch-config",
  mcpValidateLaunchConfig: "masthead:mcp:validate-launch-config",
  openDataDirectory: "masthead:data:open-directory",
  pruneLocalData: "masthead:store:prune",
  readStoreRecords: "masthead:store:read",
  startLiveConnector: "masthead:connector:start",
  windowClose: "masthead:window:close",
  windowMaximize: "masthead:window:maximize",
  windowMinimize: "masthead:window:minimize"
} as const;

export const LEGACY_COMMAND_TO_CHANNEL: Record<string, ElectronChannel> = {
  append_store_records_command: ELECTRON_CHANNELS.appendStoreRecords,
  clear_local_data_command: ELECTRON_CHANNELS.clearLocalData,
  export_store_records_command: ELECTRON_CHANNELS.exportStoreRecords,
  mcp_launch_config_command: ELECTRON_CHANNELS.mcpLaunchConfig,
  mcp_validate_launch_config_command: ELECTRON_CHANNELS.mcpValidateLaunchConfig,
  open_data_directory_command: ELECTRON_CHANNELS.openDataDirectory,
  prune_local_data_command: ELECTRON_CHANNELS.pruneLocalData,
  read_store_records_command: ELECTRON_CHANNELS.readStoreRecords,
  start_live_connector_command: ELECTRON_CHANNELS.startLiveConnector,
  window_close_command: ELECTRON_CHANNELS.windowClose,
  window_maximize_command: ELECTRON_CHANNELS.windowMaximize,
  window_minimize_command: ELECTRON_CHANNELS.windowMinimize
};

export type ElectronChannel = (typeof ELECTRON_CHANNELS)[keyof typeof ELECTRON_CHANNELS];
