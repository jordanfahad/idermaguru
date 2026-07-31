import { z } from "zod";
import { parseJson } from "../../_shared";

export const runtime = "nodejs";

/**
 * A one-way postbox for playback diagnostics from the shopper's device.
 *
 * The silent-advisor bug lived only on the shopper's iPhone, invisible from
 * every test environment; what finally located it was a stray status code in
 * the server logs. This route makes that visibility deliberate: the client
 * reports which speech path fired — played, refused, fell back, went mute —
 * as event names and sizes ONLY. No audio, no utterance text, no identifiers
 * ever arrive here, and nothing is stored beyond the function log line.
 */
const ClientLogSchema = z.object({
  event: z.string().min(1).max(64),
  detail: z.record(z.string().max(32), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

export async function POST(request: Request) {
  try {
    const input = await parseJson(request, ClientLogSchema);
    console.log("[voice-client]", input.event, JSON.stringify(input.detail ?? {}));
  } catch {
    // Diagnostics are best-effort by definition; malformed ones just vanish.
  }
  return new Response(null, { status: 204 });
}
