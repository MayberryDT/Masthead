export type TrayMenuActionHandlers = {
  onOpenDataDirectory: () => void;
  onQuit: () => void;
  onShow: () => void;
};

export type TrayMenuTemplateItem = {
  click?: () => void;
  label?: string;
  type?: "separator";
};

export type CreateMastheadTrayOptions = {
  tooltip?: string;
};

export function buildTrayMenuTemplate(handlers: TrayMenuActionHandlers): TrayMenuTemplateItem[] {
  return [
    { label: "Show Masthead", click: handlers.onShow },
    { label: "Open data directory", click: handlers.onOpenDataDirectory },
    { type: "separator" },
    { label: "Quit", click: handlers.onQuit }
  ];
}

export function trayTooltipLabel(isDev: boolean): string {
  return isDev ? "Masthead Dev" : "Masthead";
}

export async function createMastheadTray(
  iconPath: string,
  handlers: TrayMenuActionHandlers,
  options: CreateMastheadTrayOptions = {}
): Promise<unknown> {
  const { Menu, Tray } = await import("electron");
  const tray = new Tray(iconPath);
  tray.setToolTip(options.tooltip ?? trayTooltipLabel(false));
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(handlers)));
  tray.on("click", handlers.onShow);
  return tray;
}
