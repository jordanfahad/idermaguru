/**
 * The small shared vocabulary of the dialogue services.
 *
 * `normaliseTranscript` used to live in voice-agent.ts, but the empathy and
 * body-area classifiers need it too and voice-agent imports them — so it sits
 * here, where nothing imports anything, and voice-agent re-exports it for the
 * callers that already know it by that path.
 */
export type AgentLang = "en" | "ar";

/**
 * Speech-to-text splits and hyphenates compound words unpredictably: the same
 * answer arrives as "breastfeeding", "breast-feeding" or "breast feeding"
 * depending on the device. Matching the raw transcript meant one spelling was
 * understood and the others looped. Everything is matched against this
 * normalised form instead.
 */
export function normaliseTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[-_/.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
