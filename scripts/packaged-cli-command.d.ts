export function buildPackagedCliInvocation(
  command: string,
  args: string[],
  options: {
    comspec?: string;
    platform: NodeJS.Platform;
    systemRoot?: string;
  }
): { args: string[]; command: string; env: Record<string, string> };
