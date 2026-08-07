import { extname, relative, resolve, sep } from "node:path";

export function resolveProtocolPath(rendererDist: string, rawUrl: string): string | undefined {
  if (/(\.\.|%2e)/i.test(rawUrl)) return undefined;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "masthead:" || url.hostname !== "app") return undefined;

  const root = resolve(rendererDist);
  let rawPathname: string;
  try {
    rawPathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  const normalizedPath = rawPathname === "/" || extname(rawPathname) === "" ? "/index.html" : rawPathname;
  const candidate = resolve(root, `.${normalizedPath}`);
  const rel = relative(root, candidate);
  if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) return undefined;
  return candidate;
}
