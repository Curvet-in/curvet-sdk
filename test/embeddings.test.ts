import { describe, it, expect } from "vitest";
import { Curvet, NotFoundError, BadRequestError } from "../src";
import { mockFetch } from "./helpers";

/** An OpenAI-shaped embeddings reply: one vector per input, in input order. */
function vectors(inputs: string[], dims = 3, model = "text-embedding-3-small") {
  return {
    object: "list",
    data: inputs.map((_, index) => ({
      object: "embedding",
      index,
      embedding: Array.from({ length: dims }, (_, d) => (index + 1) * 0.1 + d * 0.01),
    })),
    model,
    usage: { prompt_tokens: 4 * inputs.length, total_tokens: 4 * inputs.length },
  };
}

describe("embeddings.create", () => {
  it("posts to the OpenAI-compatible /api/v1/embeddings, not the playground", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: vectors(["hello"]) }));
    const curvet = new Curvet({ appKey: "cvt_app_test", fetch });

    await curvet.embeddings.create({ model: "text-embedding-3-small", input: "hello" });

    const call = fetch.calls[0];
    expect(call.url).toBe("https://curvet.ai/api/v1/embeddings");
    expect(call.init.method).toBe("POST");
    // Same credential and header as every other app-key call; never a Bearer token.
    expect(call.init.headers["x-app-key"]).toBe("cvt_app_test");
    expect(call.init.headers.authorization ?? call.init.headers.Authorization).toBeUndefined();
    expect(call.init.headers["content-type"]).toBe("application/json");
  });

  it("sends OpenAI's field names unchanged", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: vectors(["a"], 256) }));
    const curvet = new Curvet({ appKey: "k", fetch });

    await curvet.embeddings.create({
      model: "text-embedding-3-small",
      input: "a",
      dimensions: 256,
      encoding_format: "float",
      user: "end-user-42",
    });

    // snake_case stays snake_case: the server is OpenAI-shaped, so a camelCased
    // `encodingFormat` would be silently ignored rather than refused.
    expect(JSON.parse(fetch.calls[0].init.body)).toEqual({
      model: "text-embedding-3-small",
      input: "a",
      dimensions: 256,
      encoding_format: "float",
      user: "end-user-42",
    });
  });

  it("returns one typed vector per input, in input order", async () => {
    const inputs = ["first", "second", "third"];
    const fetch = mockFetch(() => ({ status: 200, body: vectors(inputs) }));
    const curvet = new Curvet({ appKey: "k", fetch });

    const res = await curvet.embeddings.create({ model: "text-embedding-3-small", input: inputs });

    expect(JSON.parse(fetch.calls[0].init.body).input).toEqual(inputs);
    expect(res.object).toBe("list");
    expect(res.data.map((d) => d.index)).toEqual([0, 1, 2]);
    // `embedding` is number[] for the default encoding — no narrowing needed.
    const first: number[] = res.data[0].embedding;
    expect(first).toHaveLength(3);
    expect(res.usage.prompt_tokens).toBe(12);
    expect(res.model).toBe("text-embedding-3-small");
  });

  it("passes base64 through and types the vectors as strings", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: {
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: "AACAPwAAAEA=" }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });

    const res = await curvet.embeddings.create({
      model: "text-embedding-3-small",
      input: "x",
      encoding_format: "base64",
    });

    const packed: string = res.data[0].embedding;
    expect(packed).toBe("AACAPwAAAEA=");
    expect(JSON.parse(fetch.calls[0].init.body).encoding_format).toBe("base64");
  });

  it("follows a custom baseURL, so staging reaches staging's /api/v1", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: vectors(["x"]) }));
    const curvet = new Curvet({
      appKey: "k",
      fetch,
      baseURL: "https://staging.curvet.in/api/v1/playground",
    });

    await curvet.embeddings.create({ model: "text-embedding-3-small", input: "x" });

    expect(fetch.calls[0].url).toBe("https://staging.curvet.in/api/v1/embeddings");
  });

  it("sends an alias unchanged and reports the Curvet id the server ran", async () => {
    const fetch = mockFetch(() => ({ status: 200, body: vectors(["x"], 384, "all-minilm-l6-v2") }));
    const curvet = new Curvet({ appKey: "k", fetch });

    const res = await curvet.embeddings.create({
      model: "sentence-transformers/all-minilm-l6-v2",
      input: "x",
    });

    // Aliases are resolved server side; the SDK never rewrites the id.
    expect(JSON.parse(fetch.calls[0].init.body).model).toBe("sentence-transformers/all-minilm-l6-v2");
    expect(res.model).toBe("all-minilm-l6-v2");
    expect(res.data[0].embedding).toHaveLength(384);
  });

  it("carries what the call cost in x_curvet", async () => {
    const fetch = mockFetch(() => ({
      status: 200,
      body: { ...vectors(["a", "b"]), x_curvet: { credits_charged: 0.01, billing: "metered", tokens_in: 8 } },
    }));
    const curvet = new Curvet({ appKey: "k", fetch });

    const res = await curvet.embeddings.create({ model: "text-embedding-3-small", input: ["a", "b"] });

    const credits: number | undefined = res.x_curvet?.credits_charged;
    expect(credits).toBe(0.01);
    expect(res.x_curvet?.billing).toBe("metered");
    expect(res.x_curvet?.tokens_in).toBe(res.usage.prompt_tokens);
  });

  it("an unknown model is a NotFoundError carrying the server's message and code", async () => {
    const fetch = mockFetch(() => ({
      status: 404,
      body: {
        error: {
          message: "The model 'text-embedding-ada-002' does not exist",
          type: "invalid_request_error",
          code: "model_not_found",
          param: null,
        },
      },
    }));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });

    const err = await curvet.embeddings
      .create({ model: "text-embedding-ada-002", input: "x" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("model_not_found");
    expect(err.message).toBe("The model 'text-embedding-ada-002' does not exist");
  });

  it("dimensions on a fixed-size model is a BadRequestError, and not retried", async () => {
    let n = 0;
    const fetch = mockFetch(() => {
      n++;
      return {
        status: 400,
        body: {
          error: {
            message: "Model 'all-minilm-l6-v2' does not support the dimensions parameter",
            type: "invalid_request_error",
            code: null,
            param: "dimensions",
          },
        },
      };
    });
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 3 });

    const err = await curvet.embeddings
      .create({ model: "all-minilm-l6-v2", input: "x", dimensions: 128 })
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toBe("Model 'all-minilm-l6-v2' does not support the dimensions parameter");
    expect(err.code).toBeUndefined();
    expect(n).toBe(1);
  });

  it("against a backend without the route, says so instead of failing obscurely", async () => {
    // What an older deployment answers: the server's catch-all 404.
    const fetch = mockFetch(() => ({ status: 404, body: { error: "Route not found" } }));
    const curvet = new Curvet({ appKey: "k", fetch, maxRetries: 0 });

    const err = await curvet.embeddings
      .create({ model: "text-embedding-3-small", input: "x" })
      .catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe("Route not found");
  });
});
