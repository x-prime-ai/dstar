import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  resolveViewerConfig,
  viewerConfigFromEnv,
  viewerOrigin,
} from "./runtime-config.mjs";

const token = "a".repeat(64);
const cleanup = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const fn of cleanup.splice(0).reverse()) fn();
});
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "dstar-runtime-"));
  cleanup.push(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, "document"),
    tokenFile = join(temp, "secret");
  writeFileSync(tokenFile, token + "\n", { mode: 0o600 });
  return { temp, root, tokenFile };
}

it("keeps programmatic local defaults independent of ambient service configuration", () => {
  vi.stubEnv("DSTAR_BIND_HOST", "0.0.0.0");
  vi.stubEnv("DSTAR_VIEWER_TOKEN", token);
  vi.stubEnv("DSTAR_PACKAGE_ROOT", "/should-not-be-used");
  const config = resolveViewerConfig("document.dstar");
  expect(config.root).toBe(resolve("document.dstar"));
  expect(config.host).toBe("127.0.0.1");
  expect(config.port).toBe(0);
  expect(config.basePath).toBe("");
  expect(config.token).not.toBe(token);
  expect(config.token).toMatch(/^[a-f0-9]{48}$/);
  expect(config.reviewerToken).toMatch(/^[a-f0-9]{48}$/);
  expect(config.reviewerToken).not.toBe(config.token);
  expect(viewerOrigin(config, 12345)).toBe("http://127.0.0.1:12345");
  expect(resolveViewerConfig("doc").token).not.toBe(config.token);
  expect(
    viewerOrigin(resolveViewerConfig("doc", 0, { host: "::1" }), 12345),
  ).toBe("http://[::1]:12345");
});

it.each([
  ["root", "", 0, {}],
  [
    "relative remote root",
    "doc",
    0,
    { externalOrigin: "https://review.example.com", token },
  ],
  ["missing origin", "/doc", 3000, { host: "0.0.0.0", token }],
  [
    "missing credential",
    "/doc",
    3000,
    { externalOrigin: "https://review.example.com" },
  ],
  ["IPv6 wildcard", "/doc", 3000, { host: "::" }],
  ["DNS bind", "/doc", 3000, { host: "localhost" }],
  ["null bind", "/doc", 3000, { host: null }],
  ["URL bind", "/doc", 3000, { host: "http://127.0.0.1" }],
  ["negative port", "/doc", -1, {}],
  ["large port", "/doc", 65536, {}],
  ["fractional port", "/doc", 1.5, {}],
  ["string port", "/doc", "3000", {}],
  ["unknown option", "/doc", 0, { trustProxy: true }],
  ["root base path", "/doc", 0, { basePath: "/" }],
  ["trailing base slash", "/doc", 0, { basePath: "/documents/doc/" }],
  ["encoded base path", "/doc", 0, { basePath: "/documents/%64oc" }],
  ["uppercase base path", "/doc", 0, { basePath: "/documents/Doc" }],
  ["short token", "/doc", 0, { token: "secret" }],
  ["empty token", "/doc", 0, { token: "" }],
  ["null token", "/doc", 0, { token: null }],
  ["token newline", "/doc", 0, { token: token + "\n" }],
  ["token whitespace", "/doc", 0, { token: " " + token }],
  ["both sources", "/doc", 0, { token, tokenFile: "/secret" }],
])("rejects invalid configuration: %s", (_name, root, port, options) => {
  expect(() => resolveViewerConfig(root, port, options)).toThrow();
});

it.each([
  "http://review.example.com",
  "https://review.example.com/",
  "https://review.example.com/path",
  "https://user:password@review.example.com",
  "https://review.example.com?x=1",
  "https://review.example.com#fragment",
  "https://REVIEW.example.com",
  "https://review.example.com:443",
  "https://*.example.com",
  "https://review.example.com.",
  "https://review.example.com;",
  "null",
  "",
  "https://review.example.com https://evil.example",
])("rejects a noncanonical or unsafe trusted origin: %s", (externalOrigin) => {
  expect(() =>
    resolveViewerConfig("/doc", 3000, { externalOrigin, token }),
  ).toThrow();
});

it("accepts canonical HTTP only for a local single-port development gateway", () => {
  for (const externalOrigin of [
    "http://127.0.0.1:8765",
    "http://localhost:8765",
  ])
    expect(
      resolveViewerConfig("/doc", 0, { externalOrigin, token }).externalOrigin,
    ).toBe(externalOrigin);
  for (const externalOrigin of [
    "http://review.example.com",
    "http://localhost.example.com:8765",
  ])
    expect(() =>
      resolveViewerConfig("/doc", 0, { externalOrigin, token }),
    ).toThrow();
});

it("accepts a canonical document mount path", () => {
  expect(
    resolveViewerConfig("/doc", 0, {
      externalOrigin: "http://localhost:8765",
      basePath: "/documents/dstar-doc",
      token,
    }).basePath,
  ).toBe("/documents/dstar-doc");
});

it("loads exactly one explicit credential from env or an external regular file", () => {
  const { root, tokenFile } = fixture();
  const configured = viewerConfigFromEnv({
    DSTAR_PACKAGE_ROOT: root,
    DSTAR_BIND_HOST: "0.0.0.0",
    DSTAR_PORT: "3000",
    DSTAR_EXTERNAL_ORIGIN: "https://review.example.com:8443",
    DSTAR_VIEWER_TOKEN_FILE: tokenFile,
  });
  expect(configured).toEqual({
    root,
    port: 3000,
    options: {
      host: "0.0.0.0",
      externalOrigin: "https://review.example.com:8443",
      ownerToken: token,
      reviewerToken: undefined,
      ownerDisplayName: "Owner",
      reviewerDisplayName: undefined,
    },
  });
  expect(
    viewerOrigin(resolveViewerConfig(root, 3000, configured.options), 3000),
  ).toBe("https://review.example.com:8443");
  expect(
    viewerConfigFromEnv({ DSTAR_PACKAGE_ROOT: root, DSTAR_VIEWER_TOKEN: token })
      .options.ownerToken,
  ).toBe(token);
});

it("configures distinct named roles, validates identity boundaries and preserves explicit reviewer access", () => {
  const { root } = fixture(),
    reviewerToken = "b".repeat(64),
    config = resolveViewerConfig(root, 0, {
      ownerToken: token,
      reviewerToken,
      ownerDisplayName: "Renée Owner",
      reviewerDisplayName: "李 Reviewer",
    });
  expect(config.credentials.owner.identity).toEqual({
    id: "owner",
    displayName: "Renée Owner",
    role: "owner",
  });
  expect(config.credentials.reviewer.identity).toEqual({
    id: "reviewer",
    displayName: "李 Reviewer",
    role: "reviewer",
  });
  expect(config.reviewerToken).toBe(reviewerToken);
  for (const options of [
    { ownerToken: token, reviewerToken: token },
    { token, ownerToken: "c".repeat(64) },
    { ownerToken: token, reviewerDisplayName: "No credential" },
    { ownerToken: token, ownerDisplayName: " leading" },
    { ownerToken: token, ownerDisplayName: "x".repeat(81) },
    { ownerToken: token, ownerDisplayName: "Owner<script>" },
  ])
    expect(() => resolveViewerConfig(root, 0, options)).toThrow();
});

it("accepts only a private canonical workspace management link", () => {
  const { root } = fixture();
  const management = `https://manage.review.test/workspaces/${"a".repeat(32)}#${"m".repeat(64)}`;
  expect(
    resolveViewerConfig(root, 0, { workspaceManagementUrl: management })
      .workspaceManagementUrl,
  ).toBe(management);
  const local = `http://127.0.0.1:4173/workspaces/${"b".repeat(32)}#${"n".repeat(64)}`;
  expect(
    resolveViewerConfig(root, 0, { workspaceManagementUrl: local })
      .workspaceManagementUrl,
  ).toBe(local);
  for (const value of [
    "https://manage.review.test/",
    `http://manage.review.test/workspaces/${"a".repeat(32)}#${"m".repeat(64)}`,
    `https://manage.review.test/workspaces/${"a".repeat(32)}?leak=1#${"m".repeat(64)}`,
    `https://manage.review.test/workspaces/${"a".repeat(32)}#short`,
  ])
    expect(() =>
      resolveViewerConfig(root, 0, { workspaceManagementUrl: value }),
    ).toThrow("Invalid workspaceManagementUrl");
});

it("loads owner and reviewer service credentials without storing them in the package", () => {
  const { root } = fixture(),
    reviewerToken = "d".repeat(64),
    configured = viewerConfigFromEnv({
      DSTAR_PACKAGE_ROOT: root,
      DSTAR_OWNER_TOKEN: token,
      DSTAR_REVIEWER_TOKEN: reviewerToken,
      DSTAR_OWNER_DISPLAY_NAME: "Olivia Owner",
      DSTAR_REVIEWER_DISPLAY_NAME: "Ravi Reviewer",
    });
  expect(configured.options).toEqual({
    host: "127.0.0.1",
    externalOrigin: undefined,
    ownerToken: token,
    reviewerToken,
    ownerDisplayName: "Olivia Owner",
    reviewerDisplayName: "Ravi Reviewer",
  });
});

it.each([
  {},
  { DSTAR_PACKAGE_ROOT: "relative" },
  { DSTAR_PORT: "-1" },
  { DSTAR_PORT: "1.5" },
  { DSTAR_PORT: "65536" },
  { DSTAR_PORT: "03000" },
  { DSTAR_PORT: "" },
  { DSTAR_BIND_HOST: "" },
  { DSTAR_EXTERNAL_ORIGIN: "" },
  { DSTAR_VIEWER_TOKEN: "" },
])("fails closed on missing or invalid service env: %j", (bad) => {
  const env = { DSTAR_PACKAGE_ROOT: "/doc", DSTAR_VIEWER_TOKEN: token, ...bad };
  if (Object.keys(bad).length === 0) delete env.DSTAR_VIEWER_TOKEN;
  expect(() => viewerConfigFromEnv(env)).toThrow();
});

it("rejects credential paths in the package, symlinks, directories and oversized files without echoing secrets", () => {
  const { temp, root, tokenFile } = fixture();
  mkdirSync(root);
  const inside = join(root, "secret"),
    link = join(temp, "alias");
  writeFileSync(inside, token);
  symlinkSync(inside, link);
  for (const path of [inside, link, root, join(temp, "missing"), "relative"]) {
    expect(() => resolveViewerConfig(root, 0, { tokenFile: path })).toThrow();
    try {
      resolveViewerConfig(root, 0, { tokenFile: path });
    } catch (error) {
      expect(error.message).not.toContain(token);
      expect(error.message).not.toContain(temp);
    }
  }
  writeFileSync(tokenFile, token.repeat(6));
  expect(() => resolveViewerConfig(root, 0, { tokenFile })).toThrow();
  writeFileSync(tokenFile, token + "\n\n");
  expect(() => resolveViewerConfig(root, 0, { tokenFile })).toThrow();
});
