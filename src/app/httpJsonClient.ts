type QueryValue = boolean | number | string | Array<boolean | number | string> | null | undefined;

type JsonRequestOptions = {
  label: string;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
};

type JsonPostOptions = JsonRequestOptions & {
  body?: unknown;
};

export async function getJson<T>(baseUrl: string, pathname: string, options: JsonRequestOptions): Promise<T> {
  const response = await fetch(daemonUrl(baseUrl, pathname, options.query), {
    headers: { accept: "application/json" },
    signal: options.signal
  });
  if (!response.ok) throw new Error(`${options.label} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export async function postJson<T>(baseUrl: string, pathname: string, options: JsonPostOptions): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(daemonUrl(baseUrl, pathname, options.query), {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: "POST",
    signal: options.signal
  });
  if (!response.ok) throw new Error(`${options.label} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function daemonUrl(baseUrl: string, pathname: string, query: Record<string, QueryValue> = {}): string {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = "";
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(key, String(item));
      }
    } else if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
