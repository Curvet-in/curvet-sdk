import { describe, it, expect } from "vitest";
import { Curvet } from "../src/index";

/**
 * Which credential agency is addressed with, and under which header.
 *
 * The header is not cosmetic. The server accepts either credential, so sending
 * an app key under `x-cli-token` would authenticate anyway — after a failed
 * token lookup — and leave a request log that says the opposite of what happened.
 */

/** Capture the headers the client would send, without a network. */
function headersFrom(client: Curvet): Record<string, string> {
  const captured: Record<string, string> = {};
  const agency = client.agency as unknown as {
    client: { options?: Record<string, unknown>; [k: string]: unknown };
    streamOpts: { appKey?: string; authHeaderName?: string };
  };
  captured.streamHeader = agency.streamOpts.authHeaderName ?? "";
  captured.streamValue = agency.streamOpts.appKey ?? "";
  return captured;
}

describe("agency credential selection", () => {
  it("uses the CLI token under x-cli-token when one is present", () => {
    const c = new Curvet({ cliToken: "cli_abc", appKey: "app_abc" });
    const h = headersFrom(c);
    expect(h.streamHeader).toBe("x-cli-token");
    expect(h.streamValue).toBe("cli_abc");
  });

  it("uses the app key under x-app-key when there is no CLI token", () => {
    // This is the hosted case: a connector is handed a key and cannot run a
    // device login. Before this, agency got an empty x-cli-token and 401'd.
    const c = new Curvet({ appKey: "app_abc" });
    const h = headersFrom(c);
    expect(h.streamHeader).toBe("x-app-key");
    expect(h.streamValue).toBe("app_abc");
  });

  it("prefers the CLI token, because it identifies a person", () => {
    // An app key may be shared by everyone using the app it ships inside; a CLI
    // token belongs to whoever signed in on this machine. When both are present
    // the more specific identity should own the run.
    const c = new Curvet({ appKey: "app_abc", cliToken: "cli_abc" });
    expect(headersFrom(c).streamValue).toBe("cli_abc");
  });

  it("never sends an empty credential", () => {
    const c = new Curvet({ appKey: "app_abc" });
    expect(headersFrom(c).streamValue).not.toBe("");
  });
});
