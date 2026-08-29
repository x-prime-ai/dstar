export const AUTH_MESSAGE =
  "Viewer authorization required. Open the complete access link from the running terminal in this browser, or paste it into Authorize Viewer. Browser sessions are separate.";

const authError = () =>
  Object.assign(new Error(AUTH_MESSAGE), { code: "authorization_required" });

export function accessToken(input, origin) {
  let value = input.trim();
  if (!/^[A-Za-z0-9_-]{48,256}$/.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        "Paste the complete Viewer access link or session token.",
      );
    }
    if (
      url.origin !== origin ||
      url.pathname !== "/" ||
      url.search ||
      url.username ||
      url.password
    )
      throw new Error(
        "Use the access link for this exact Viewer address and port.",
      );
    value = url.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{48,256}$/.test(value))
      throw new Error(
        "The access link must include its #session-token fragment.",
      );
  }
  return value;
}

// Credentials stay inside this page's closure, never in WebMCP arguments/results.
export class ViewerSession {
  #token = "";
  #epoch = 0;
  authorized = false;
  session = null;

  constructor({ fetch, storage, onAuthorization }) {
    this.fetch = fetch;
    this.storage = storage;
    this.onAuthorization = onAuthorization;
  }

  #save(value) {
    try {
      if (value) this.storage().setItem("dstar-token", value);
      else this.storage().removeItem("dstar-token");
    } catch {
      // Blocked browser storage must not prevent an in-memory session.
    }
  }

  restore(location, history) {
    let value = "";
    if (location.hash) {
      value = location.hash.slice(1);
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      try {
        value = this.storage().getItem("dstar-token") || "";
      } catch {
        // The user can still authorize explicitly.
      }
    }
    try {
      this.#token = accessToken(value, location.origin);
    } catch {
      this.#save("");
    }
  }

  replace(input, origin) {
    const token = accessToken(input, origin);
    ++this.#epoch;
    this.#token = token;
    this.authorized = false;
    this.session = null;
    this.#save("");
    this.onAuthorization(false);
  }

  accessLink(origin) {
    if (!this.authorized) throw authError();
    if (!this.can("share"))
      throw Object.assign(
        new Error("Only the Owner can manage Viewer access links."),
        { code: "forbidden" },
      );
    return `${origin}/#${this.#token}`;
  }

  can(capability) {
    return Boolean(this.session?.capabilities?.includes(capability));
  }

  async request(path, body, signal) {
    if (!this.#token) throw authError();
    const epoch = this.#epoch;
    const fetch = this.fetch;
    const response = await fetch(`/api/${path}`, {
      signal,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    if (epoch !== this.#epoch)
      throw Object.assign(
        new Error("Viewer session changed; retry the request."),
        {
          code: "session_changed",
        },
      );
    if (response.status === 401) {
      ++this.#epoch;
      this.#token = "";
      this.authorized = false;
      this.session = null;
      this.#save("");
      this.onAuthorization(false);
      throw authError();
    }
    const data = await response.json();
    if (epoch !== this.#epoch)
      throw Object.assign(
        new Error("Viewer session changed; retry the request."),
        {
          code: "session_changed",
        },
      );
    if (!response.ok)
      throw Object.assign(new Error(data.error), { code: data.code });
    // Discoverability alone is not authentication. Verify an actual state read.
    if (path === "state" && !this.authorized) {
      this.session = data.session ??
        // Owner-only servers before the role-aware protocol remain usable.
        {
          role: "owner",
          identity: { id: "owner", displayName: "Owner", role: "owner" },
          capabilities: [
            "read",
            "comment",
            "suggest",
            "propose",
            "handoff",
            "reply",
            "decide",
            "resolve",
            "share",
          ],
        };
      this.authorized = true;
      this.#save(this.#token);
      this.onAuthorization(true);
    } else if (path === "state") {
      this.session = data.session ?? this.session;
    }
    return data;
  }
}
