import type { FetchLike, FetchResponse } from "../src/types/common";

export interface MockReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type MockHandler = (url: string, init: any) => MockReply | Promise<MockReply>;

export interface MockFetch extends FetchLike {
  calls: Array<{ url: string; init: any }>;
}

/** Build a fake fetch for unit tests, recording calls. */
export function mockFetch(handler: MockHandler): MockFetch {
  const calls: Array<{ url: string; init: any }> = [];
  const fn = (async (url: string, init: any): Promise<FetchResponse> => {
    calls.push({ url, init });
    const r = await handler(url, init);
    const headers = r.headers ?? {};
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: {
        get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
      },
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  }) as MockFetch;
  fn.calls = calls;
  return fn;
}
