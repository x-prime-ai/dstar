import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isIP } from "node:net";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const loopback = (host) =>
  host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
const localHostname = (host) =>
  loopback(host) || host === "localhost" || host.endsWith(".localhost");
const fail = (message) => {
  throw new Error(message);
};

// Canonical origins only: never normalize userinfo, paths or ambiguous input
// into a trusted value. HTTP is restricted to loopback/localhost development;
// deployed origins terminate TLS at a separately configured proxy.
function externalOrigin(value) {
  if (value === undefined) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Invalid externalOrigin: use a canonical HTTPS origin");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, ""),
    allowedProtocol =
      url.protocol === "https:" ||
      (url.protocol === "http:" && localHostname(hostname));
  if (typeof value !== "string" || value !== url.origin || !allowedProtocol)
    fail(
      "Invalid externalOrigin: use canonical HTTPS, or HTTP only for localhost development",
    );
  if (
    !isIP(hostname) &&
    (hostname.length > 253 ||
      !hostname
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
  )
    fail(
      "externalOrigin must have a literal IP or DNS hostname, without wildcards",
    );
  return value;
}

function workspaceManagementUrl(value) {
  if (value === undefined) return undefined;
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Invalid workspaceManagementUrl");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const allowedProtocol =
    url.protocol === "https:" ||
    (url.protocol === "http:" && loopback(hostname));
  if (
    typeof value !== "string" ||
    url.href !== value ||
    !allowedProtocol ||
    url.username ||
    url.password ||
    url.search ||
    !/^\/workspaces\/[a-f0-9]{32}$/.test(url.pathname) ||
    !/^#[A-Za-z0-9_-]{48,256}$/.test(url.hash)
  )
    fail("Invalid workspaceManagementUrl");
  return value;
}

// Resolve existing ancestors too, so aliases cannot place the credential in
// the document tree. The Engine independently rejects package symlinks.
function physicalPath(path) {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return resolve(physicalPath(dirname(path)), basename(path));
  }
}

function readTokenFile(path, root) {
  if (typeof path !== "string" || !isAbsolute(path))
    fail("tokenFile must be an absolute path outside the package root");
  let fd;
  try {
    const inside = relative(physicalPath(root), physicalPath(path));
    if (
      !inside ||
      (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))
    )
      fail("Credential is inside the package");
    // O_NONBLOCK avoids hanging on a FIFO; O_NOFOLLOW rejects a swapped symlink.
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 258) fail("Invalid credential file");
    return readFileSync(fd, "utf8").replace(/\r?\n$/, "");
  } catch {
    // Never echo the path, file contents or host-supplied credentials.
    fail(
      "Cannot read tokenFile: use a small regular file outside the package root",
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function credential(value, name) {
  if (
    typeof value !== "string" ||
    value.length < 48 ||
    value.length > 256 ||
    /[^A-Za-z0-9_-]/.test(value)
  )
    fail(
      `${name} must contain 48–256 base64url characters; generate it randomly`,
    );
  return value;
}

export function displayName(value, role) {
  const name =
    value === undefined ? role[0].toUpperCase() + role.slice(1) : value;
  if (
    typeof name !== "string" ||
    name !== name.trim() ||
    [...name].length < 1 ||
    [...name].length > 80 ||
    !/^[\p{L}\p{N}](?:[\p{L}\p{N} .,'’_-]*[\p{L}\p{N}])?$/u.test(name)
  )
    fail(
      `${role}DisplayName must be 1–80 letters/numbers with internal spaces or . , ' ’ _ -`,
    );
  return name;
}

function source(options, root, role) {
  const title = role[0].toUpperCase() + role.slice(1),
    tokenKey = `${role}Token`,
    fileKey = `${role}TokenFile`;
  if (options[tokenKey] !== undefined && options[fileKey] !== undefined)
    fail(`Configure only one of ${tokenKey} or ${fileKey}`);
  if (options[fileKey] !== undefined)
    return credential(
      readTokenFile(options[fileKey], root),
      `${title} credential`,
    );
  if (options[tokenKey] !== undefined)
    return credential(options[tokenKey], `${title} credential`);
  return undefined;
}

/** Explicit options only: programmatic/local callers never inherit process.env. */
export function resolveViewerConfig(root, port = 0, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    fail("Viewer options must be an object");
  for (const key of Object.keys(options))
    if (
      ![
        "host",
        "externalOrigin",
        "token",
        "tokenFile",
        "ownerToken",
        "ownerTokenFile",
        "reviewerToken",
        "reviewerTokenFile",
        "ownerDisplayName",
        "reviewerDisplayName",
        "workspaceManagementUrl",
      ].includes(key)
    )
      fail("Unknown Viewer option");
  if (typeof root !== "string" || !root.trim() || root.includes("\0"))
    fail("A package root is required");
  const host = options.host === undefined ? "127.0.0.1" : options.host;
  if (typeof host !== "string" || !isIP(host))
    fail("host must be an IPv4 or IPv6 address");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    fail("port must be an integer from 0 through 65535");
  const origin = externalOrigin(options.externalOrigin);
  const managementUrl = workspaceManagementUrl(options.workspaceManagementUrl);
  if (!loopback(host) && !origin)
    fail(
      "Non-loopback binding requires externalOrigin and an explicit credential",
    );
  if (origin && !isAbsolute(root))
    fail("externalOrigin requires an absolute persistent package root");
  const resolvedRoot = resolve(root);
  if (options.token !== undefined && options.tokenFile !== undefined)
    fail("Configure only one of token or tokenFile");
  const legacyOwner =
      options.token !== undefined || options.tokenFile !== undefined,
    namedOwner =
      options.ownerToken !== undefined || options.ownerTokenFile !== undefined;
  if (legacyOwner && namedOwner)
    fail(
      "Configure legacy token/tokenFile or ownerToken/ownerTokenFile, not both",
    );
  const normalized = {
      ...options,
      ownerToken: legacyOwner ? options.token : options.ownerToken,
      ownerTokenFile: legacyOwner ? options.tokenFile : options.ownerTokenFile,
    },
    explicitOwner = legacyOwner || namedOwner,
    explicitReviewer =
      options.reviewerToken !== undefined ||
      options.reviewerTokenFile !== undefined;
  if (origin && !explicitOwner)
    fail("externalOrigin requires an explicit owner credential");
  if (!explicitOwner && explicitReviewer)
    fail("A reviewer credential requires an explicit owner credential");
  let ownerToken = source(normalized, resolvedRoot, "owner"),
    reviewerToken = source(normalized, resolvedRoot, "reviewer");
  if (!explicitOwner) {
    ownerToken = randomBytes(24).toString("hex");
    reviewerToken = randomBytes(24).toString("hex");
  }
  if (reviewerToken && reviewerToken === ownerToken)
    fail("Owner and reviewer credentials must be different");
  if (options.reviewerDisplayName !== undefined && reviewerToken === undefined)
    fail("reviewerDisplayName requires a reviewer credential");
  const ownerIdentity = Object.freeze({
      id: "owner",
      displayName: displayName(options.ownerDisplayName, "owner"),
      role: "owner",
    }),
    reviewerIdentity = reviewerToken
      ? Object.freeze({
          id: "reviewer",
          displayName: displayName(options.reviewerDisplayName, "reviewer"),
          role: "reviewer",
        })
      : undefined;
  return Object.freeze({
    root: resolvedRoot,
    host,
    port,
    externalOrigin: origin,
    ...(managementUrl ? { workspaceManagementUrl: managementUrl } : {}),
    token: ownerToken,
    reviewerToken,
    credentials: Object.freeze({
      owner: Object.freeze({ token: ownerToken, identity: ownerIdentity }),
      ...(reviewerToken
        ? {
            reviewer: Object.freeze({
              token: reviewerToken,
              identity: reviewerIdentity,
            }),
          }
        : {}),
    }),
    ephemeral: !explicitOwner,
  });
}

/** Environment is consumed only by the dedicated persistent-service entrypoint. */
export function viewerConfigFromEnv(env = process.env) {
  const names = [
    "DSTAR_PACKAGE_ROOT",
    "DSTAR_BIND_HOST",
    "DSTAR_PORT",
    "DSTAR_EXTERNAL_ORIGIN",
    "DSTAR_VIEWER_TOKEN",
    "DSTAR_VIEWER_TOKEN_FILE",
    "DSTAR_OWNER_TOKEN",
    "DSTAR_OWNER_TOKEN_FILE",
    "DSTAR_REVIEWER_TOKEN",
    "DSTAR_REVIEWER_TOKEN_FILE",
    "DSTAR_OWNER_DISPLAY_NAME",
    "DSTAR_REVIEWER_DISPLAY_NAME",
  ];
  for (const name of names)
    if (
      env[name] !== undefined &&
      (typeof env[name] !== "string" || !env[name].trim())
    )
      fail(`Empty ${name} is not allowed`);
  if (!env.DSTAR_PACKAGE_ROOT || !isAbsolute(env.DSTAR_PACKAGE_ROOT))
    fail("DSTAR_PACKAGE_ROOT must be an absolute path");
  if (
    env.DSTAR_PORT !== undefined &&
    (!/^(0|[1-9][0-9]{0,4})$/.test(env.DSTAR_PORT) ||
      env.DSTAR_PORT !== env.DSTAR_PORT.trim())
  )
    fail("DSTAR_PORT must be a decimal port number");
  // Persistent services must never generate unreported ephemeral credentials.
  if (
    env.DSTAR_VIEWER_TOKEN === undefined &&
    env.DSTAR_VIEWER_TOKEN_FILE === undefined &&
    env.DSTAR_OWNER_TOKEN === undefined &&
    env.DSTAR_OWNER_TOKEN_FILE === undefined
  )
    fail("Set an owner token or owner token file");
  const port = env.DSTAR_PORT === undefined ? 0 : Number(env.DSTAR_PORT);
  const options = {
    host: env.DSTAR_BIND_HOST,
    externalOrigin: env.DSTAR_EXTERNAL_ORIGIN,
    token: env.DSTAR_VIEWER_TOKEN,
    tokenFile: env.DSTAR_VIEWER_TOKEN_FILE,
    ownerToken: env.DSTAR_OWNER_TOKEN,
    ownerTokenFile: env.DSTAR_OWNER_TOKEN_FILE,
    reviewerToken: env.DSTAR_REVIEWER_TOKEN,
    reviewerTokenFile: env.DSTAR_REVIEWER_TOKEN_FILE,
    ownerDisplayName: env.DSTAR_OWNER_DISPLAY_NAME,
    reviewerDisplayName: env.DSTAR_REVIEWER_DISPLAY_NAME,
  };
  // Validate before opening the Engine or binding a socket.
  const config = resolveViewerConfig(env.DSTAR_PACKAGE_ROOT, port, options);
  return {
    root: config.root,
    port: config.port,
    options: {
      host: config.host,
      externalOrigin: config.externalOrigin,
      ownerToken: config.token,
      reviewerToken: config.reviewerToken,
      ownerDisplayName: config.credentials.owner.identity.displayName,
      reviewerDisplayName: config.credentials.reviewer?.identity.displayName,
    },
  };
}

export function viewerOrigin(config, boundPort) {
  const host = isIP(config.host) === 6 ? `[${config.host}]` : config.host;
  return config.externalOrigin ?? `http://${host}:${boundPort}`;
}

/** No proxy-derived authority, allowlists, forwarded-header trust or URL roots. */
export function trustedRequestUrl(req, origin) {
  const critical = new Set(["host", "origin", "authorization", "content-type"]);
  const seen = new Set();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i].toLowerCase();
    if (name === "forwarded" || name.startsWith("x-forwarded-")) return null;
    if (critical.has(name) && seen.has(name)) return null;
    seen.add(name);
  }
  if (req.headers.host !== new URL(origin).host) return null;
  const target = req.url;
  if (
    !target?.startsWith("/") ||
    target.startsWith("//") ||
    /[\\#\s]/.test(target)
  )
    return null;
  try {
    const path = target.split("?")[0];
    for (const segment of path.split("/")) {
      const decoded = decodeURIComponent(segment);
      if (
        [".", ".."].includes(decoded) ||
        /[/\\]/.test(decoded) ||
        [...decoded].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        return null;
    }
    const url = new URL(target, origin);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

export function authorized(req, token) {
  const supplied = req.headers.authorization;
  if (typeof supplied !== "string" || supplied.length > 263) return false;
  const hash = (text) => createHash("sha256").update(text).digest();
  return timingSafeEqual(hash(supplied), hash(`Bearer ${token}`));
}
