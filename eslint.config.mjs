import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

// Flat config for ESLint 9. The previous FlatCompat + eslint-config-next setup
// crashed under ESLint 9 ("Converting circular structure to JSON"), so we wire
// the TypeScript parser and the Next plugin's recommended + core-web-vitals
// rules directly.
const eslintConfig = tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**", "prisma/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
);

export default eslintConfig;
