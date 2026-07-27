import type { LLMProvider } from "@/services/llm/provider";

/**
 * Language handling for the concierge.
 *
 * English and Arabic ship as hand-written copy because they are the core
 * markets and machine phrasing of safety questions is not good enough there.
 * Any other language a shopper speaks is served by translating those same
 * questions at runtime, so the dialogue logic - and every safety rule inside
 * it - stays in one place rather than being forked per locale.
 */
export type LanguageCode = string;

const SCRIPTS: { code: LanguageCode; name: string; match: RegExp }[] = [
  { code: "ar", name: "Arabic", match: /[؀-ۿ]/ },
  { code: "ur", name: "Urdu", match: /[؀-ۿ]\s*(?:ہے|ہیں|کیا)/ },
  { code: "hi", name: "Hindi", match: /[ऀ-ॿ]/ },
  { code: "bn", name: "Bengali", match: /[ঀ-৿]/ },
  { code: "ru", name: "Russian", match: /[Ѐ-ӿ]/ },
  { code: "el", name: "Greek", match: /[Ͱ-Ͽ]/ },
  { code: "he", name: "Hebrew", match: /[֐-׿]/ },
  { code: "th", name: "Thai", match: /[฀-๿]/ },
  { code: "ja", name: "Japanese", match: /[぀-ヿ]/ },
  { code: "ko", name: "Korean", match: /[가-힯]/ },
  { code: "zh", name: "Chinese", match: /[一-鿿]/ },
];

/** Latin-script languages are guessed from common function words. */
const LATIN_HINTS: { code: LanguageCode; name: string; match: RegExp }[] = [
  { code: "fr", name: "French", match: /\b(je|j'ai|ma peau|bonjour|des|une|avec|pour le)\b/i },
  { code: "es", name: "Spanish", match: /\b(tengo|mi piel|hola|para|una|con|quiero)\b/i },
  { code: "pt", name: "Portuguese", match: /\b(tenho|minha pele|olá|para|uma|com)\b/i },
  { code: "de", name: "German", match: /\b(ich|meine haut|hallo|habe|und|für)\b/i },
  { code: "it", name: "Italian", match: /\b(ho|la mia pelle|ciao|per|una|con)\b/i },
  { code: "id", name: "Indonesian", match: /\b(saya|kulit saya|halo|untuk|dengan)\b/i },
  { code: "tl", name: "Tagalog", match: /\b(ako|balat ko|kumusta|para sa|meron)\b/i },
  { code: "tr", name: "Turkish", match: /\b(benim|cildim|merhaba|için|var)\b/i },
];

export const RTL_LANGUAGES = new Set(["ar", "ur", "he", "fa"]);

export function isRtl(code: LanguageCode): boolean {
  return RTL_LANGUAGES.has(code.slice(0, 2).toLowerCase());
}

export function languageName(code: LanguageCode): string {
  const known = [...SCRIPTS, ...LATIN_HINTS].find((entry) => entry.code === code);
  if (known) return known.name;
  return code === "en" ? "English" : code;
}

/** Best-effort detection with no model call. Returns "en" when unsure. */
export function detectLanguage(text: string): LanguageCode {
  const clean = text.trim();
  if (!clean) return "en";
  // Urdu shares the Arabic block, so test it before plain Arabic.
  const urdu = SCRIPTS.find((entry) => entry.code === "ur");
  if (urdu?.match.test(clean)) return "ur";
  const script = SCRIPTS.find((entry) => entry.match.test(clean));
  if (script) return script.code;
  const latin = LATIN_HINTS.find((entry) => entry.match.test(clean));
  return latin ? latin.code : "en";
}

const translations = new Map<string, string>();

/**
 * Translates an agent line into the shopper's language.
 *
 * English and Arabic return untouched (they are authored, not translated).
 * Without a model the original is returned rather than a broken approximation,
 * so the shopper still gets a usable - if English - question.
 */
export async function localise(
  text: string,
  code: LanguageCode,
  provider: LLMProvider,
): Promise<string> {
  if (!text.trim() || code === "en" || code === "ar") return text;
  if ((provider.lastUsedId ?? provider.id) === "mock") return text;

  const key = `${code}:${text}`;
  const cached = translations.get(key);
  if (cached) return cached;

  try {
    const translated = await provider.generateAssistantMessage({
      messages: [
        {
          role: "system",
          content:
            `Translate the user's message into ${languageName(code)}. It is spoken aloud by a skincare ` +
            `shopping assistant. Keep it natural, warm and the same length. Preserve any product names ` +
            `and numbers exactly. Reply with the translation only - no quotes, no notes.`,
        },
        { role: "user", content: text },
      ],
      approvedProducts: [],
      safety: { level: "LOW", reasons: [], recommendationAllowed: true },
    });

    const clean = translated.trim();
    // A model that returns something wildly longer has editorialised; keep ours.
    if (!clean || clean.length > text.length * 3) return text;
    translations.set(key, clean);
    return clean;
  } catch {
    return text;
  }
}

/** BCP-47 tag for the browser's speech recogniser. */
export function speechLocale(code: LanguageCode): string {
  const map: Record<string, string> = {
    ar: "ar-AE",
    en: "en-US",
    ur: "ur-PK",
    hi: "hi-IN",
    bn: "bn-BD",
    ru: "ru-RU",
    fr: "fr-FR",
    es: "es-ES",
    pt: "pt-PT",
    de: "de-DE",
    it: "it-IT",
    id: "id-ID",
    tl: "fil-PH",
    tr: "tr-TR",
    zh: "zh-CN",
    ja: "ja-JP",
    ko: "ko-KR",
    th: "th-TH",
    he: "he-IL",
    el: "el-GR",
  };
  return map[code] ?? "en-US";
}
