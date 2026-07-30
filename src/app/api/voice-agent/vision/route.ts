import { NextResponse } from "next/server";
import { z } from "zod";
import { runSafetyTriage } from "@/services/safety-triage";
import { jsonError, parseJson, RequestValidationError } from "../../_shared";

export const runtime = "nodejs";
export const maxDuration = 30;

const VisionSchema = z.object({
  // data:image/jpeg;base64,... captured from the camera, downscaled client-side.
  image: z.string().min(64).max(6_000_000),
  language: z.string().max(12).optional(),
});

/**
 * Optional camera look at the shopper's skin.
 *
 * Deliberately narrow. The image is held in memory for one request, sent to the
 * vision model, and dropped - it is never written to storage, never logged, and
 * never attached to a session. Skin photographs are sensitive personal data
 * under PDPL/GDPR, and the safest retention policy is none.
 *
 * The model is constrained to visible COSMETIC characteristics. It must not
 * name a condition, and anything that looks like it needs a clinician returns a
 * referral instead of observations - which the caller turns into an escalation
 * rather than a product list.
 */
const VISION_PROMPT = `You look at a photo for a cosmetic shopping assistant in a beauty store.

FIRST decide what the photo actually shows.
- "face", "hand", "arm", "leg", "foot", "scalp", "neck", "back", "other-skin" when it shows human skin.
- "not-skin" for anything else — a keyboard, a pet, a screenshot, food, a car, a blank wall. People test assistants with these, and being told "I couldn't read that clearly" when they photographed their lunch is obviously wrong.

If it is "not-skin", put a plain two-to-five word description in "shows" — "a computer keyboard", "a cat", "a plate of food". Name what you see; do not guess why.

If it IS skin but you cannot tell which part of the body it is, or the framing is too close to place it, set "needsContext" to true. Asking is better than guessing.

For skin, describe only what is COSMETICALLY visible: oiliness or shine, dryness or flaking, visible texture, visible pores, redness, dullness, uneven-looking tone, visible blemishes or breakouts, visible marks left behind by past blemishes.

You must NOT:
- name, suggest or hint at any medical condition, disease or infection (no acne vulgaris, eczema, psoriasis, rosacea, dermatitis, melasma, fungal, cancer, melanoma)
- diagnose, or imply the person has a condition
- comment on age, weight, attractiveness, ethnicity or gender
- guess anything not clearly visible

If you see anything a clinician should look at — bleeding, an open or weeping wound, signs of infection, a mole that looks irregular or is changing, severe swelling, or anything you are unsure about — do not describe it cosmetically. Set "refer" to true instead.

Set "usable" to false ONLY when the photo shows skin but is genuinely too dark, blurry or overexposed to read. A photo that is merely imperfect is still usable — describe what you can see.

Reply with JSON only:
{"subject":"face|hand|arm|leg|foot|scalp|neck|back|other-skin|not-skin","shows":"","usable":boolean,"needsContext":boolean,"refer":boolean,"observations":["short cosmetic phrases"],"skinType":"oily|dry|combination|sensitive|normal|unknown","concerns":["dark spots","dullness","dryness","oiliness","texture","redness","blemishes"]}`;

/** What the photo showed, mapped onto the body areas the dialogue already knows. */
const SUBJECT_AREAS: Record<string, string> = {
  face: "face",
  neck: "neck",
  scalp: "scalp",
  hand: "hands",
  arm: "body",
  leg: "body",
  back: "body",
  foot: "feet",
};

export async function POST(request: Request) {
  let input: z.infer<typeof VisionSchema>;
  try {
    input = await parseJson(request, VisionSchema);
  } catch (error) {
    if (error instanceof RequestValidationError) return jsonError(error.message);
    throw error;
  }

  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(input.image)) {
    return jsonError("Expected a base64 image data URL.", 400);
  }

  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError("Photo review is not configured.", 503);

  const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Describe what is cosmetically visible." },
              { type: "image_url", image_url: { url: input.image, detail: "auto" } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      // Never log the body: it can echo image data back.
      console.error("vision upstream failed", response.status);
      return jsonError("Could not review the photo.", 502);
    }

    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = payload.choices?.[0]?.message?.content ?? "{}";

    let parsed: {
      subject?: unknown;
      shows?: unknown;
      usable?: boolean;
      needsContext?: boolean;
      refer?: boolean;
      observations?: unknown;
      skinType?: unknown;
      concerns?: unknown;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return jsonError("Could not read the photo review.", 502);
    }

    const subject = typeof parsed.subject === "string" ? parsed.subject.toLowerCase().trim() : "";

    // Somebody testing the assistant with a photo of their keyboard should be
    // told it is a keyboard. "I couldn't read that clearly. Try better light"
    // is both untrue and the reason they stop trusting the rest of it.
    if (subject === "not-skin") {
      const shows = typeof parsed.shows === "string" ? parsed.shows.trim().slice(0, 60) : "";
      return NextResponse.json({ usable: true, notSkin: true, shows, observations: [], concerns: [] });
    }
    if (parsed.usable === false) {
      return NextResponse.json({ usable: false, refer: false, observations: [], concerns: [] });
    }
    if (parsed.refer) {
      return NextResponse.json({ usable: true, refer: true, observations: [], concerns: [] });
    }
    // Skin, but it could not place it. Asking beats guessing.
    if (parsed.needsContext) {
      return NextResponse.json({ usable: true, needsContext: true, observations: [], concerns: [] });
    }

    const observations = Array.isArray(parsed.observations)
      ? parsed.observations.filter((item): item is string => typeof item === "string").slice(0, 6)
      : [];
    const concerns = Array.isArray(parsed.concerns)
      ? parsed.concerns.filter((item): item is string => typeof item === "string").slice(0, 6)
      : [];
    const skinType =
      typeof parsed.skinType === "string" && parsed.skinType !== "unknown" ? parsed.skinType : undefined;

    // Belt and braces: run the same triage over the model's own words. If it
    // slipped into clinical language despite the prompt, escalate rather than
    // pass it to the shopper.
    const triage = runSafetyTriage({ mainConcern: [...observations, ...concerns].join(". ") });
    if (!triage.recommendationAllowed) {
      return NextResponse.json({ usable: true, refer: true, observations: [], concerns: [] });
    }

    return NextResponse.json({
      usable: true,
      refer: false,
      observations,
      concerns,
      skinType,
      // Feeds the body-area slot, so a photo of a hand routes to body products
      // instead of a face routine.
      bodyArea: SUBJECT_AREAS[subject],
    });
  } catch (error) {
    console.error("vision request failed", error instanceof Error ? error.message : "unknown");
    return jsonError("Could not review the photo.", 502);
  }
}
