import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/voice-agent/client-log/route";

/**
 * The diagnostics postbox exists to make on-device playback failures visible
 * in the server logs. It must accept the events the client sends and shrug at
 * anything else — a diagnostics endpoint that can itself error would add a
 * failure mode to the thing it is meant to observe.
 */
describe("client diagnostics postbox", () => {
  const send = (body: string) =>
    POST(
      new Request("http://localhost/api/voice-agent/client-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );

  it("accepts a well-formed playback event", async () => {
    const response = await send(JSON.stringify({ event: "line-played", detail: { chars: 42, ios: true } }));
    expect(response.status).toBe(204);
  });

  it("accepts an event with no detail", async () => {
    const response = await send(JSON.stringify({ event: "browser-voice-mute" }));
    expect(response.status).toBe(204);
  });

  it("swallows garbage without erroring", async () => {
    expect((await send("not json")).status).toBe(204);
    expect((await send(JSON.stringify({ nonsense: true }))).status).toBe(204);
    expect((await send(JSON.stringify({ event: "x", detail: { text: "a".repeat(9000) } }))).status).toBe(204);
  });
});
