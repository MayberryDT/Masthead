import { describe, expect, test } from "vitest";
import { resolveMastheadAppIconPath } from "../icon";

const appPath = "/repo/Masthead";
const resourcesPath = "/opt/Masthead/resources";
const publicIcon = "/repo/Masthead/public/assets/masthead-logo-sail.png";
const packagedIcon = "/opt/Masthead/resources/masthead-logo-sail.png";
const legacyDaemonIcon = "/opt/Masthead/resources/daemon/masthead-logo-sail.png";
const devSvgIcon = "/repo/Masthead/public/assets/masthead-logo-sail-dev.svg";

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
  test("prefers the development public PNG over packaged resources in dev mode", () => {
    expect(resolveWith([publicIcon, packagedIcon], true)).toBe(publicIcon);
  });

  test("falls back to the packaged resource root in dev mode", () => {
    expect(resolveWith([packagedIcon], true)).toBe(packagedIcon);
  });

  test("prefers the packaged resource root over source assets in packaged mode", () => {
    expect(resolveWith([publicIcon, packagedIcon], false)).toBe(packagedIcon);
  });

  test("does not resolve legacy daemon or SVG icon paths", () => {
    expect(() => resolveWith([legacyDaemonIcon, devSvgIcon], true)).toThrow(/Masthead app icon not found/);
  });

  test("explains which stable PNG candidates were checked", () => {
    expect(() => resolveWith([], false)).toThrow(publicIcon);
    expect(() => resolveWith([], false)).toThrow(packagedIcon);
    expect(() => resolveWith([], false)).not.toThrow(/daemon|sail-dev\.svg/);
  });
});
