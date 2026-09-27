import js from "@eslint/js";
import globals from "globals";
import solid from "eslint-plugin-solid";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "public/**",
      "scripts/_legacy_aces/**",
      "src/engine/io/codecs/wlbr.js",
      "src/engine/reference/srpStatic.js",
      "src/**/*.d.ts",
      ".output/**",
      ".nitro/**",
      ".solid/**"
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  solid.configs["flat/typescript"],
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      "solid/no-destructure": "warn",
      "solid/prefer-for": "warn",
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.{js,mjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-regex-spaces": "off",
      "no-unused-vars": "off",
      "no-useless-escape": "off",
    },
  },
);
