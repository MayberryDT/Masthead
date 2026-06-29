export type ElectronRuntimeApp = {
  commandLine: {
    appendSwitch: (name: string) => void;
  };
};

export function configureElectronRuntime(app: ElectronRuntimeApp, platform = process.platform): void {
  if (platform === "linux") app.commandLine.appendSwitch("disable-gpu-sandbox");
}
