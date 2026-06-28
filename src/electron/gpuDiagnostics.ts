export type ElectronAppWithGpuStatus = {
  getGPUFeatureStatus: () => object;
};

export function collectGpuDiagnostics(app: ElectronAppWithGpuStatus): Record<string, unknown> {
  return app.getGPUFeatureStatus() as Record<string, unknown>;
}
