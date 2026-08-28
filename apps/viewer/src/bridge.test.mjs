import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";

const bridge = readFileSync(
  new URL("../public/bridge.js", import.meta.url),
  "utf8",
);
async function run({
  sheet = true,
  image = true,
  font = true,
  assets = [],
  readyState = "complete",
} = {}) {
  const messages = [],
    loads = [],
    listeners = {};
  const fonts = Object.assign([], { ready: Promise.resolve() });
  const sheetListeners = {};
  const stylesheet = {
    // Even failed CSS can expose a CSSStyleSheet object in a real browser.
    sheet: {},
    addEventListener: (name, fn) => {
      sheetListeners[name] = fn;
    },
    removeEventListener: (name) => {
      delete sheetListeners[name];
    },
    get href() {
      return "http://host/frame/cap/styles.css";
    },
    set href(value) {
      loads.push(value);
      Promise.resolve().then(() => sheetListeners[sheet ? "load" : "error"]());
    },
  };
  runInNewContext(bridge, {
    __DSTAR_CONTEXT__: {
      capability: "cap",
      revision: "rev",
      origin: "http://host",
      assets,
    },
    parent: { postMessage: (data, origin) => messages.push({ data, origin }) },
    document: {
      readyState,
      fonts,
      body: { dataset: {} },
      addEventListener() {},
      querySelectorAll: (selector) =>
        selector.startsWith("link") ? [stylesheet] : [],
    },
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    Image: class {
      decode() {
        loads.push(this.src);
        return image
          ? Promise.resolve()
          : Promise.reject(new Error("Broken image"));
      }
    },
    FontFace: class {
      constructor(_name, url) {
        this.url = url;
      }
      load() {
        loads.push(this.url);
        return font
          ? Promise.resolve()
          : Promise.reject(new Error("Broken font"));
      }
    },
  });
  await setImmediate();
  return { messages, loads, listeners };
}
it("acknowledges the exact revision only after load and all asset checks", async () => {
  const { messages, loads, listeners } = await run({
    readyState: "loading",
    assets: [
      { path: "assets/background.png", type: "image" },
      { path: "assets/type.woff2", type: "font" },
    ],
  });
  expect(messages).toEqual([]);
  await listeners.load();
  expect(loads).toEqual([
    "http://host/frame/cap/styles.css",
    "assets/background.png",
    'url("assets/type.woff2")',
  ]);
  expect(messages).toEqual([
    {
      origin: "http://host",
      data: {
        kind: "dstar-preview",
        capability: "cap",
        revision: "rev",
        status: "ready",
      },
    },
  ]);
});
it.each([
  { sheet: false },
  { image: false, assets: [{ path: "assets/photo.png", type: "image" }] },
  { font: false, assets: [{ path: "assets/type.woff2", type: "font" }] },
])(
  "reports failed stylesheet/image/font checks instead of ready",
  async (options) => {
    const { messages } = await run(options);
    expect(messages).toHaveLength(1);
    expect(messages[0].data.status).toBe("failed");
  },
);
