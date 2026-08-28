import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "packages/core/src/schema/generated/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/viewer/public/*.js"],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "document",
          "location",
          "history",
          "sessionStorage",
          "fetch",
          "setTimeout",
          "clearTimeout",
          "prompt",
          "confirm",
          "addEventListener",
          "parent",
          "getSelection",
          "Node",
          "NodeFilter",
          "Image",
          "FontFace",
          "__DSTAR_CONTEXT__",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
