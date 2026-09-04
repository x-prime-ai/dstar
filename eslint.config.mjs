import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      "apps/viewer/public/*.js",
      "apps/workspaces/public/*.js",
      "examples/*.js",
    ],
    languageOptions: {
      globals: Object.fromEntries(
        [
          "document",
          "location",
          "history",
          "sessionStorage",
          "localStorage",
          "navigator",
          "URL",
          "Blob",
          "DOMParser",
          "FormData",
          "crypto",
          "fetch",
          "setTimeout",
          "clearTimeout",
          "requestAnimationFrame",
          "prompt",
          "confirm",
          "addEventListener",
          "parent",
          "getSelection",
          "Node",
          "NodeFilter",
          "Image",
          "FontFace",
          "AbortController",
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
        AbortController: "readonly",
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
