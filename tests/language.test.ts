import { describe, expect, it } from "vitest";
import { detectLanguage, isRtl, speechLocale } from "../src/services/language";

describe("language detection", () => {
  it("detects the scripts the GCC actually speaks", () => {
    expect(detectLanguage("عندي بقع داكنة في بشرتي")).toBe("ar");
    expect(detectLanguage("मेरी त्वचा पर काले धब्बे हैं")).toBe("hi");
    expect(detectLanguage("У меня тёмные пятна на коже")).toBe("ru");
    expect(detectLanguage("我的皮肤有黑斑")).toBe("zh");
  });

  it("detects common Latin-script languages", () => {
    expect(detectLanguage("j'ai des taches sur ma peau")).toBe("fr");
    expect(detectLanguage("tengo manchas en mi piel")).toBe("es");
    expect(detectLanguage("saya punya kulit berminyak")).toBe("id");
  });

  it("falls back to English rather than guessing wildly", () => {
    expect(detectLanguage("I have dark spots and dull skin")).toBe("en");
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage("hmm")).toBe("en");
  });

  it("knows which languages read right to left", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("ur")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isRtl("fr")).toBe(false);
  });

  it("maps to a speech locale the browser understands", () => {
    expect(speechLocale("ar")).toBe("ar-AE");
    expect(speechLocale("fr")).toBe("fr-FR");
    expect(speechLocale("zz")).toBe("en-US");
  });
});
