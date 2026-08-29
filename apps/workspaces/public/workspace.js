const status = document.querySelector("#status");
const create = document.querySelector("#create");
const manage = document.querySelector("#manage");
const reset = document.querySelector("#reset");
const match = /^\/workspaces\/([a-f0-9]{32})$/.exec(location.pathname);
const storageKey = match
  ? `dstar-workspace-owner:${match[1]}`
  : "dstar-workspace-creation";
let token = location.hash.slice(1);

if (token) {
  try {
    sessionStorage.setItem(storageKey, token);
  } catch {
    // The current page can still use the in-memory credential.
  }
} else {
  try {
    token = sessionStorage.getItem(storageKey) || "";
  } catch {
    // The authorization error below remains actionable.
  }
}

if (location.hash) history.replaceState(null, "", location.pathname);

function show(result) {
  document.querySelector("#workspace-id").textContent = result.workspace.id;
  document.querySelector("#generation").textContent =
    result.workspace.generation;
  document.querySelector("#expires").textContent = result.workspace.expiresAt;
  document.querySelector("#open-owner").href = result.sessions.ownerUrl;
  const reviewer = document.querySelector("#open-reviewer");
  reviewer.hidden = !result.sessions.reviewerUrl;
  if (result.sessions.reviewerUrl) reviewer.href = result.sessions.reviewerUrl;
  manage.hidden = false;
  create.hidden = true;
  reset.disabled = false;
  status.textContent = "Workspace ready.";
}

function adoptReset(result) {
  const next = new URL(result.manageUrl, location.href);
  token = next.hash.slice(1);
  try {
    sessionStorage.setItem(storageKey, token);
  } catch {
    // The current page can still use the in-memory rotated credential.
  }
  history.replaceState(null, "", next.pathname);
  show(result);
}

async function request(path, credential) {
  const response = await fetch(path, {
    method:
      path.endsWith("/reset") || path === "/api/v1/workspaces" ? "POST" : "GET",
    headers: {
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      "Content-Type": "application/json",
    },
    ...(path.endsWith("/reset") || path === "/api/v1/workspaces"
      ? { body: "{}" }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

create.addEventListener("click", async () => {
  create.disabled = true;
  status.textContent = "Creating workspace…";
  try {
    const result = await request("/api/v1/workspaces", token);
    location.assign(result.manageUrl);
  } catch (error) {
    status.textContent = error.message;
    create.disabled = false;
  }
});

reset.addEventListener("click", async () => {
  reset.disabled = true;
  status.textContent = "Resetting workspace…";
  try {
    const result = await request(`/api/v1/workspaces/${match[1]}/reset`, token);
    // The management path is stable across generations. A fragment-only
    // location.assign() is a same-document navigation, so explicitly adopt
    // the rotated credential and render the returned generation instead.
    adoptReset(result);
  } catch (error) {
    status.textContent = error.message;
    reset.disabled = false;
  }
});

if (match) {
  create.hidden = true;
  status.textContent = "Loading workspace…";
  request(`/api/v1/workspaces/${match[1]}`, token)
    .then(show)
    .catch((error) => {
      status.textContent = error.message;
    });
} else {
  reset.hidden = true;
}
