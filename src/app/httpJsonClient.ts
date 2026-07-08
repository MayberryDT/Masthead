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
  if (!response.ok) throw new Error(await formatHttpError(options.label, response));
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
  if (!response.ok) throw new Error(await formatHttpError(options.label, response));
  return response.json() as Promise<T>;
}

async function formatHttpError(label: string, response: Response): Promise<string> {
  const detail = await readErrorDetail(response);
  return detail ? `${label} failed: ${response.status} ${detail}` : `${label} failed: ${response.status}`;
}

async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      const body = JSON.parse(text) as { code?: unknown; error?: unknown };
      if (typeof body.code === "string" && body.code.trim()) return body.code.trim();
      if (typeof body.error === "string" && body.error.trim()) {
        const error = body.error.trim();
        // Keep messages short so UI mapping and logs stay readable.
        return error.length > 120 ? error.slice(0, 120) : error;
      }
    } catch {
      // Non-JSON bodies are ignored; status alone is enough.
    }
  } catch {
    // Body read failures should not mask the original HTTP status.
  }
  return undefined;
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
