export type ElectronRuntimeApp = {
  commandLine: {
    appendSwitch: (name: string, value?: string) => void;
  };
};

export function configureElectronRuntime(
  app: ElectronRuntimeApp,
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): void {
  if (platform === "linux") app.commandLine.appendSwitch("disable-gpu-sandbox");
  if (platform === "linux" && environment.MASTHEAD_HEADLESS === "1") {
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("ozone-platform", "x11");
  }
}
