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
const VISION_PROMPT = `You look at a photo of skin for a cosmetic shopping assistant in a beauty store.

You describe only what is COSMETICALLY visible: oiliness or shine, dryness or flaking, visible texture, visible pores, redness, dullness, uneven-looking tone, visible blemishes.

You must NOT:
- name, suggest or hint at any medical condition, disease or infection (no acne vulgaris, eczema, psoriasis, rosacea, dermatitis, melasma, fungal, cancer, melanoma)
- diagnose, or imply the person has a condition
- comment on age, weight, attractiveness, ethnicity or gender
- guess anything not clearly visible

If you see anything that a clinician should look at - bleeding, an open or weeping wound, signs of infection, a mole that looks irregular or is changing, severe swelling, or anything you are unsure about - do not describe it cosmetically. Set "refer" to true instead.

If the image does not show skin, or is too dark or blurry to read, set "usable" to false.

Reply with JSON only:
{"usable":boolean,"refer":boolean,"observations":["short cosmetic phrases"],"skinType":"oily|dry|combination|sensitive|normal|unknown","concerns":["dark spots","dullness","dryness","oiliness","texture","redness","blemishes"]}`;

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
        max_tokens: 300,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: VISION_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Describe what is cosmetically visible." },
              { type: "image_url", image_url: { url: input.image, detail: "low" } },
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
      usable?: boolean;
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

    if (parsed.usable === false) {
      return NextResponse.json({ usable: false, refer: false, observations: [], concerns: [] });
    }
    if (parsed.refer) {
      return NextResponse.json({ usable: true, refer: true, observations: [], concerns: [] });
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

    return NextResponse.json({ usable: true, refer: false, observations, concerns, skinType });
  } catch (error) {
    console.error("vision request failed", error instanceof Error ? error.message : "unknown");
    return jsonError("Could not review the photo.", 502);
  }
}
