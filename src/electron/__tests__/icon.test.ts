import { describe, expect, test } from "vitest";
import { resolveMastheadAppIconPath } from "../icon";

const appPath = "/repo/Masthead";
const resourcesPath = "/opt/Masthead/resources";
const publicIcon = "/repo/Masthead/public/assets/masthead-logo-sail.png";
const packagedIcon = "/opt/Masthead/resources/masthead-logo-sail.png";
const legacyDaemonIcon = "/opt/Masthead/resources/daemon/masthead-logo-sail.png";
const devPngIcon = "/repo/Masthead/public/assets/masthead-logo-sail-dev.png";
const packagedDevPngIcon = "/opt/Masthead/resources/daemon/masthead-logo-sail-dev.png";

function resolveWith(existingPaths: string[], isDev: boolean): string {
  const existing = new Set(existingPaths);
  return resolveMastheadAppIconPath({
    appPath,
    exists: (path) => existing.has(path),
    isDev,
    resourcesPath
  });
}

describe("Masthead app icon resolver", () => {
  test("prefers the development badged source icon in dev mode", () => {
    expect(resolveWith([devPngIcon, publicIcon, packagedIcon], true)).toBe(devPngIcon);
  });

  test("falls back to the development public PNG in dev mode", () => {
    expect(resolveWith([publicIcon, packagedIcon], true)).toBe(publicIcon);
  });

  test("falls back to the packaged development badged icon in dev mode", () => {
    expect(resolveWith([packagedDevPngIcon, publicIcon, packagedIcon], true)).toBe(packagedDevPngIcon);
  });

  test("falls back to the packaged resource root in dev mode", () => {
    expect(resolveWith([packagedIcon], true)).toBe(packagedIcon);
  });

  test("prefers the packaged resource root over source assets in packaged mode", () => {
    expect(resolveWith([publicIcon, packagedIcon], false)).toBe(packagedIcon);
  });

  test("does not resolve legacy daemon icon paths", () => {
    expect(() => resolveWith([legacyDaemonIcon], true)).toThrow(/Masthead app icon not found/);
  });

  test("explains which stable PNG candidates were checked", () => {
    expect(() => resolveWith([], false)).toThrow(publicIcon);
    expect(() => resolveWith([], false)).toThrow(packagedIcon);
    expect(() => resolveWith([], false)).not.toThrow(/daemon|sail-dev\.svg/);
  });
});
