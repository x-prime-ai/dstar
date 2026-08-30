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
  selection = null,
  documentOverrides = {},
} = {}) {
  const messages = [],
    loads = [],
    listeners = {},
    documentListeners = {},
    timers = new Map();
  let timerId = 0;
  const parent = {
    postMessage: (data, origin) => messages.push({ data, origin }),
  };
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
    parent,
    document: {
      readyState,
      fonts,
      body: { dataset: {} },
      addEventListener: (name, fn) => {
        documentListeners[name] = fn;
      },
      querySelectorAll: (selector) =>
        selector.startsWith("link") ? [stylesheet] : [],
      ...documentOverrides,
    },
    getSelection: () => selection,
    Node: { ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_TEXT: 4 },
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, fn) => {
      const previous = listeners[name];
      listeners[name] = (...args) => {
        previous?.(...args);
        return fn(...args);
      };
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
  return {
    messages,
    loads,
    listeners,
    documentListeners,
    parent,
    flushTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
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
        slides: false,
      },
    },
  ]);
});

function annotationDocument() {
  const fixture = textSelection(),
    ranges = [],
    scrolled = [];
  const createElement = () => ({
    children: [],
    style: {},
    attributes: {},
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    append(...children) {
      for (const child of children) {
        child.remove?.();
        child.owner = this;
        this.children.push(child);
      }
    },
    replaceChildren(...children) {
      this.children.forEach((c) => {
        c.owner = null;
      });
      this.children = [];
      this.append(...children);
    },
    remove() {
      if (this.owner)
        this.owner.children = this.owner.children.filter((c) => c !== this);
      this.owner = null;
    },
    attachShadow() {
      this.shadow = createElement();
      return this.shadow;
    },
  });
  const root = createElement();
  root.clientWidth = 800;
  root.clientHeight = 600;
  fixture.element.getClientRects = () => [fixture.rect];
  fixture.element.scrollIntoView = (options) => scrolled.push(options);
  Object.assign(fixture.rect, { width: 100, height: 20 });
  fixture.documentOverrides = {
    ...fixture.documentOverrides,
    documentElement: root,
    createElement,
    querySelectorAll: (selector) =>
      selector === "[data-dstar-id]" ? [fixture.element] : [],
    createRange: () => {
      const range = {
        setStart(node, offset) {
          this.start = [node, offset];
        },
        setEnd(node, offset) {
          this.end = [node, offset];
        },
        getClientRects: () => [fixture.rect],
      };
      ranges.push(range);
      return range;
    },
  };
  return { ...fixture, root, ranges, scrolled };
}
const annotationMessage = (page, extra = {}) => ({
  source: page.parent,
  origin: "http://host",
  data: {
    kind: "dstar-annotations",
    capability: "cap",
    revision: "rev",
    active: "thread-1",
    groups: [
      {
        id: "thread-1",
        element: "intro",
        number: 2,
        anchors: [{ type: "text-range", start: 6, end: 7 }],
      },
    ],
    ...extra,
  },
});

it("renders accessible markers in an isolated overlay and maps code points to DOM ranges", async () => {
  const fixture = annotationDocument(),
    page = await run(fixture);
  page.listeners.message(annotationMessage(page));
  const host = fixture.root.children[0],
    highlights = host.shadow.children[1],
    markers = host.shadow.children[2];
  const button = markers.children[0];
  expect(button.attributes["aria-label"]).toBe("Open comment thread 2");
  expect(button.attributes["aria-pressed"]).toBe("true");
  expect(button.style.left).toBe("118px");
  expect(button.style.top).toBe("56px");
  expect(button.attributes["data-side"]).toBe("right");
  expect(button.hidden).toBe(false);
  expect(fixture.ranges[0].start[1]).toBe(6);
  expect(fixture.ranges[0].end[1]).toBe(8);
  expect(highlights.children).toHaveLength(1);
  fixture.rect.left = 100;
  fixture.rect.right = 200;
  page.listeners.scroll();
  page.flushTimers();
  expect(button.style.left).toBe("64px");
  expect(button.attributes["data-side"]).toBe("left");
  page.listeners.message(annotationMessage(page, { active: null }));
  expect(button.attributes["aria-pressed"]).toBe("false");
  expect(highlights.children).toHaveLength(0);
  button.onclick({ preventDefault() {}, stopPropagation() {} });
  expect(button.attributes["aria-pressed"]).toBe("true");
  expect(highlights.children).toHaveLength(1);
  expect(page.messages.at(-1).data).toEqual({
    kind: "dstar-annotation-focus",
    capability: "cap",
    revision: "rev",
    group: "thread-1",
  });
  page.listeners.message(annotationMessage(page, { focus: "thread-1" }));
  expect(fixture.scrolled).toEqual([{ block: "center", inline: "nearest" }]);
  expect(markers.children).toHaveLength(1);
  page.listeners.message(
    annotationMessage(page, {
      groups: [
        {
          id: "thread-1",
          element: "intro",
          number: 2,
          anchors: [
            {
              type: "text-ranges",
              ranges: [
                { element: "intro", status: "exact", start: 0, end: 5 },
                { element: "intro", status: "exact", start: 6, end: 7 },
              ],
            },
          ],
        },
      ],
    }),
  );
  expect(highlights.children).toHaveLength(2);
  page.listeners.message(annotationMessage(page, { groups: [] }));
  expect(markers.children).toHaveLength(0);
});

it("ignores annotation messages from another source, origin, capability or revision", async () => {
  const fixture = annotationDocument(),
    page = await run(fixture),
    event = annotationMessage(page);
  for (const invalid of [
    { ...event, source: {} },
    { ...event, origin: "https://evil.invalid" },
    { ...event, data: { ...event.data, capability: "old" } },
    { ...event, data: { ...event.data, revision: "old" } },
  ])
    page.listeners.message(invalid);
  expect(fixture.root.children).toHaveLength(0);
});

it("hides offscreen markers after scrolling and clears active highlights", async () => {
  const fixture = annotationDocument(),
    page = await run(fixture);
  page.listeners.message(annotationMessage(page));
  const shadow = fixture.root.children[0].shadow;
  fixture.rect.top = 700;
  fixture.rect.bottom = 720;
  page.listeners.scroll();
  page.flushTimers();
  expect(shadow.children[2].children[0].hidden).toBe(true);
  expect(shadow.children[1].children).toHaveLength(0);
});

it("opens the matching slide when navigating to a comment on a hidden slide", async () => {
  const fixture = annotationDocument();
  const slides = [
    { style: {}, contains: () => false },
    { style: {}, contains: (element) => element === fixture.element },
  ];
  const query = fixture.documentOverrides.querySelectorAll;
  fixture.documentOverrides.body = { dataset: { dstarMode: "slides" } };
  fixture.documentOverrides.querySelectorAll = (selector) =>
    selector === "[data-dstar-slide]" ? slides : query(selector);
  const page = await run(fixture);
  expect(slides[1].style.display).toBe("none");
  page.listeners.message(annotationMessage(page, { focus: "thread-1" }));
  expect(slides[0].style.display).toBe("none");
  expect(slides[1].style.display).toBe("");
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

function textSelection() {
  const rect = { left: 10, top: 60, right: 110, bottom: 80 };
  const element = {
    nodeType: 1,
    dataset: { dstarId: "intro" },
    closest: (selector) => (selector === "[data-dstar-id]" ? element : null),
    getBoundingClientRect: () => rect,
  };
  const node = { data: "Hello 🌍 world", parentElement: element };
  const range = {
    startContainer: node,
    endContainer: node,
    startOffset: 6,
    endOffset: 8,
    getBoundingClientRect: () => rect,
  };
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
  };
  return {
    element,
    range,
    rect,
    selection,
    documentOverrides: {
      querySelectorAll: (selector) =>
        selector === "[data-dstar-id]" ? [element] : [],
      createTreeWalker: () => {
        let seen = false;
        return {
          nextNode: () => {
            if (seen) return null;
            seen = true;
            return node;
          },
        };
      },
      createRange: () => ({ selectNodeContents() {}, setEnd() {} }),
    },
  };
}

it("reports the selection rectangle and Unicode offsets without opening a composer", async () => {
  const fixture = textSelection();
  const page = await run(fixture);
  page.documentListeners.mouseup({ altKey: false });
  expect(page.messages.at(-1)).toEqual({
    origin: "http://host",
    data: {
      kind: "dstar-selection",
      capability: "cap",
      revision: "rev",
      compose: false,
      target: {
        revision: "rev",
        element: "intro",
        selector: {
          type: "text-range",
          start: 6,
          end: 7,
          unit: "unicode-code-point",
          exact: "🌍",
          prefix: "Hello ",
          suffix: " world",
        },
      },
      rect: fixture.rect,
    },
  });
});

it("keeps a triple-click selection whose only cross-element content is a trailing newline", async () => {
  const fixture = textSelection(),
    nextElement = {
      dataset: { dstarId: "next" },
      closest: (selector) =>
        selector === "[data-dstar-id]" ? nextElement : null,
    },
    nextNode = { data: "Next", parentElement: nextElement };
  fixture.range.startOffset = 0;
  fixture.range.endContainer = nextNode;
  fixture.range.endOffset = 0;
  fixture.selection.toString = () => "Hello 🌍 world\n";
  fixture.documentOverrides.querySelectorAll = (selector) =>
    selector === "[data-dstar-id]" ? [fixture.element, nextElement] : [];
  fixture.documentOverrides.createTreeWalker = (element) => {
    let seen = false;
    return {
      nextNode: () => {
        if (seen) return null;
        seen = true;
        return element === nextElement
          ? nextNode
          : fixture.range.startContainer;
      },
    };
  };
  const page = await run(fixture);
  page.documentListeners.mouseup({ altKey: false });
  expect(page.messages.at(-1).data.target).toMatchObject({
    element: "intro",
    selector: {
      type: "text-range",
      start: 0,
      end: 13,
      exact: "Hello 🌍 world",
    },
  });
});

it("reports a cross-element selection as independently anchored text ranges", async () => {
  const fixture = textSelection(),
    nextElement = {
      dataset: { dstarId: "next" },
      closest: (selector) =>
        selector === "[data-dstar-id]" ? nextElement : null,
    },
    nextNode = { data: "Next title", parentElement: nextElement };
  fixture.range.startOffset = 6;
  fixture.range.endContainer = nextNode;
  fixture.range.endOffset = 4;
  fixture.documentOverrides.querySelectorAll = (selector) =>
    selector === "[data-dstar-id]" ? [fixture.element, nextElement] : [];
  fixture.documentOverrides.createTreeWalker = (element) => {
    let seen = false;
    return {
      nextNode: () => {
        if (seen) return null;
        seen = true;
        return element === nextElement
          ? nextNode
          : fixture.range.startContainer;
      },
    };
  };
  const page = await run(fixture);
  page.documentListeners.mouseup({ altKey: false });
  expect(page.messages.at(-1).data.target).toMatchObject({
    element: "intro",
    selector: {
      type: "text-ranges",
      ranges: [
        { element: "intro", exact: "🌍 world", start: 6, end: 13 },
        { element: "next", exact: "Next", start: 0, end: 4 },
      ],
    },
  });
});

it("handles keyboard selection and explicit compose shortcuts", async () => {
  const page = await run(textSelection());
  page.documentListeners.selectionchange();
  page.flushTimers();
  expect(page.messages.at(-1).data.compose).toBe(false);
  let prevented = false;
  page.documentListeners.keydown({
    key: "m",
    ctrlKey: true,
    altKey: true,
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(true);
  expect(page.messages.at(-1).data.compose).toBe(true);
});

it("clears collapsed selections and selections ending outside stable content", async () => {
  const fixture = textSelection();
  const page = await run(fixture);
  fixture.selection.isCollapsed = true;
  page.documentListeners.mouseup({});
  expect(page.messages.at(-1).data.target).toBeNull();
  fixture.selection.isCollapsed = false;
  fixture.range.endContainer = { parentElement: { closest: () => ({}) } };
  page.documentListeners.mouseup({});
  expect(page.messages.at(-1).data.target).toBeNull();
});

it.each(["scroll", "resize", "Escape"])(
  "dismisses the icon on %s and cancels pending selection reports",
  async (action) => {
    const page = await run(textSelection());
    page.documentListeners.selectionchange();
    if (action === "Escape") page.documentListeners.keydown({ key: "Escape" });
    else page.listeners[action]();
    page.flushTimers();
    expect(page.messages.at(-1).data).toMatchObject({
      target: null,
      revision: "rev",
    });
  },
);

it("keeps Alt-click element selection through a delayed collapsed selectionchange", async () => {
  const fixture = textSelection();
  fixture.selection.isCollapsed = true;
  const page = await run(fixture);
  page.documentListeners.click({
    target: fixture.element,
    altKey: true,
    preventDefault() {},
  });
  page.documentListeners.selectionchange();
  page.flushTimers();
  expect(page.messages.at(-1).data).toMatchObject({
    target: { element: "intro", selector: { type: "element" } },
    rect: fixture.rect,
  });
  page.documentListeners.mousedown();
  page.documentListeners.mouseup({});
  expect(page.messages.at(-1).data.target).toBeNull();
});
