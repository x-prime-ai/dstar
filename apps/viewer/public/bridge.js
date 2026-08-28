(() => {
  const context = __DSTAR_CONTEXT__;
  const reportPreview = (status) =>
    parent.postMessage(
      {
        kind: "dstar-preview",
        capability: context.capability,
        revision: context.revision,
        status,
      },
      context.origin,
    );
  const verifyPreview = async () => {
    try {
      await Promise.all(
        [...document.querySelectorAll('link[rel~="stylesheet" i]')].map(
          (sheet) =>
            new Promise((resolve, reject) => {
              const cleanup = () => {
                sheet.removeEventListener("load", loaded);
                sheet.removeEventListener("error", failed);
              };
              const loaded = () => {
                cleanup();
                resolve();
              };
              const failed = () => {
                cleanup();
                reject(new Error("Stylesheet unavailable"));
              };
              sheet.addEventListener("load", loaded);
              sheet.addEventListener("error", failed);
              // A failed stylesheet can still expose an empty .sheet in Chromium.
              // Reload the same immutable URL in place, preserving cascade order,
              // so success is witnessed even if the initial event preceded us.
              const href = sheet.href;
              sheet.href = href;
            }),
        ),
      );
      // Check all canonical assets, including CSS backgrounds, lazy images and
      // hidden slides. The bridge may start after their original error events.
      const pending = [...context.assets];
      await Promise.all(
        Array.from({ length: Math.min(6, pending.length) }, async () => {
          let asset;
          while ((asset = pending.shift())) {
            if (asset.type === "font") {
              await new FontFace(
                "dstar-preview-check",
                `url("${asset.path}")`,
              ).load();
            } else {
              const image = new Image();
              image.src = asset.path;
              await image.decode();
            }
          }
        }),
      );
      await document.fonts.ready;
      if ([...document.fonts].some((font) => font.status === "error"))
        throw new Error("Font unavailable");
      reportPreview("ready");
    } catch {
      reportPreview("failed");
    }
  };
  if (document.readyState === "complete") void verifyPreview();
  else addEventListener("load", verifyPreview, { once: true });
  const excluded = (node) =>
    node.parentElement?.closest(
      '[hidden],[aria-hidden="true"],head,style,script',
    );
  const nodes = (element) => {
    const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const out = [];
    let node;
    while ((node = walk.nextNode())) if (!excluded(node)) out.push(node);
    return out;
  };
  const send = (target) =>
    parent.postMessage(
      { kind: "dstar-selection", capability: context.capability, target },
      context.origin,
    );
  const stable = (node) =>
    (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(
      "[data-dstar-id]",
    );
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a");
      if (link && !link.getAttribute("href")?.startsWith("#"))
        event.preventDefault();
      if (!event.altKey) return;
      event.preventDefault();
      const element = stable(event.target);
      if (element)
        send({
          revision: context.revision,
          element: element.dataset.dstarId,
          selector: { type: "element" },
        });
    },
    true,
  );
  document.addEventListener("mouseup", () => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0),
      element = stable(range.startContainer);
    if (
      !element ||
      element !== stable(range.endContainer) ||
      excluded(range.startContainer) ||
      excluded(range.endContainer)
    )
      return;
    const textNodes = nodes(element),
      text = textNodes.map((n) => n.data).join("");
    const offset = (container, at) => {
      const prefix = document.createRange();
      prefix.selectNodeContents(element);
      prefix.setEnd(container, at);
      let total = 0;
      for (const node of textNodes) {
        if (node === container) {
          total += [...node.data.slice(0, at)].length;
          break;
        }
        if (prefix.comparePoint(node, node.data.length) <= 0)
          total += [...node.data].length;
        else break;
      }
      return total;
    };
    const start = offset(range.startContainer, range.startOffset),
      end = offset(range.endContainer, range.endOffset),
      chars = [...text];
    if (end <= start) return;
    send({
      revision: context.revision,
      element: element.dataset.dstarId,
      selector: {
        type: "text-range",
        start,
        end,
        unit: "unicode-code-point",
        exact: chars.slice(start, end).join(""),
        prefix: chars.slice(Math.max(0, start - 24), start).join(""),
        suffix: chars.slice(end, end + 24).join(""),
      },
    });
  });
  let slide = 0;
  const slides = [...document.querySelectorAll("[data-dstar-slide]")];
  const showSlide = () => {
    if (!slides.length) return;
    slides.forEach((el, i) => {
      el.style.display = i === slide ? "" : "none";
    });
  };
  // Runtime-only slideshow behavior; canonical files are never rewritten.
  if (document.body.dataset.dstarMode === "slides") showSlide();
  addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.origin !== context.origin ||
      event.data?.capability !== context.capability
    )
      return;
    if (event.data.kind === "dstar-slide" && slides.length) {
      slide =
        (slide + (event.data.direction === -1 ? -1 : 1) + slides.length) %
        slides.length;
      showSlide();
    }
  });
})();
