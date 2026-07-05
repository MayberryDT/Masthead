import { describe, expect, test } from "vitest";
import { buildTrayMenuTemplate, trayTooltipLabel } from "../tray";

describe("Electron tray menu", () => {
  test("keeps the expected Masthead tray action order", () => {
    const actions: string[] = [];
    const template = buildTrayMenuTemplate({
      onOpenDataDirectory: () => actions.push("open-data"),
      onQuit: () => actions.push("quit"),
      onShow: () => actions.push("show")
    });

    expect(template.map((item) => item.label ?? item.type)).toEqual(["Show Masthead", "Open data directory", "separator", "Quit"]);
    template[0]?.click?.();
    template[1]?.click?.();
    template[3]?.click?.();
    expect(actions).toEqual(["show", "open-data", "quit"]);
  });

  test("uses a dev-specific tooltip label for dev Electron", () => {
    expect(trayTooltipLabel(true)).toBe("Masthead Dev");
    expect(trayTooltipLabel(false)).toBe("Masthead");
  });
});
