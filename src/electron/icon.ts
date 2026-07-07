import { join } from "node:path";

export const MASTHEAD_APP_ICON_FILE = "masthead-logo-sail.png";

export type MastheadAppIconResolverOptions = {
  appPath: string;
  resourcesPath: string;
  isDev: boolean;
  exists: (path: string) => boolean;
};

export function resolveMastheadAppIconPath(options: MastheadAppIconResolverOptions): string {
  const candidates = mastheadAppIconCandidates(options);
  const iconPath = candidates.find(options.exists);
  if (iconPath) return iconPath;

  throw new Error(`Masthead app icon not found. Checked: ${candidates.join(", ")}`);
}

function mastheadAppIconCandidates(options: MastheadAppIconResolverOptions): string[] {
  const sourceIcon = join(options.appPath, "public", "assets", MASTHEAD_APP_ICON_FILE);
  const packagedIcon = join(options.resourcesPath, MASTHEAD_APP_ICON_FILE);
  return options.isDev ? [sourceIcon, packagedIcon] : [packagedIcon, sourceIcon];
}
