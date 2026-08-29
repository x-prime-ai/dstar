(() => {
  const context = __DSTAR_CONTEXT__;
  const reportPreview = (status) =>
    parent.postMessage(
      {
        kind: "dstar-preview",
        capability: context.capability,
        revision: context.revision,
        status,
        slides:
          document.body.dataset.dstarMode === "slides" &&
          document.querySelectorAll("[data-dstar-slide]").length > 1,
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
  const send = (target, rect, compose = false) =>
    parent.postMessage(
      {
        kind: "dstar-selection",
        capability: context.capability,
        revision: context.revision,
        target,
        rect: rect
          ? {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            }
          : null,
        compose,
      },
      context.origin,
    );
  const stable = (node) =>
    (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(
      "[data-dstar-id]",
    );
  let elementSelection = false;
  document.addEventListener("mousedown", () => {
    elementSelection = false;
  });
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest("a");
      if (link && !link.getAttribute("href")?.startsWith("#"))
        event.preventDefault();
      if (!event.altKey) return;
      event.preventDefault();
      const element = stable(event.target);
      clearTimeout(selectionTimer);
      elementSelection = !!element;
      if (element)
        send(
          {
            revision: context.revision,
            element: element.dataset.dstarId,
            selector: { type: "element" },
          },
          element.getBoundingClientRect(),
        );
    },
    true,
  );
  const reportSelection = (compose = false) => {
    const selection = getSelection();
    if (elementSelection && selection?.isCollapsed) return;
    if (!selection?.rangeCount || selection.isCollapsed) return send(null);
    const range = selection.getRangeAt(0),
      first = stable(range.startContainer),
      last = stable(range.endContainer);
    if (
      !first ||
      !last ||
      excluded(range.startContainer) ||
      excluded(range.endContainer)
    )
      return send(null);
    const stableElements = [...document.querySelectorAll("[data-dstar-id]")],
      firstIndex = stableElements.indexOf(first),
      lastIndex = stableElements.indexOf(last);
    if (firstIndex < 0 || lastIndex < firstIndex) return send(null);
    const parts = [];
    for (let position = firstIndex; position <= lastIndex; position++) {
      const element = stableElements[position],
        textNodes = nodes(element),
        chars = [...textNodes.map((node) => node.data).join("")];
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
      const start =
          position === firstIndex
            ? offset(range.startContainer, range.startOffset)
            : 0,
        end =
          position === lastIndex
            ? offset(range.endContainer, range.endOffset)
            : chars.length,
        exact = chars.slice(start, end).join("");
      if (end <= start || !exact.trim()) continue;
      parts.push({
        element: element.dataset.dstarId,
        start,
        end,
        unit: "unicode-code-point",
        exact,
        prefix: chars.slice(Math.max(0, start - 24), start).join(""),
        suffix: chars.slice(end, end + 24).join(""),
      });
    }
    if (!parts.length || parts.length > 64) return send(null);
    const selector =
      parts.length === 1
        ? { type: "text-range", ...parts[0] }
        : { type: "text-ranges", ranges: parts };
    if (selector.type === "text-range") delete selector.element;
    send(
      {
        revision: context.revision,
        element: parts[0].element,
        selector,
      },
      range.getBoundingClientRect(),
      compose,
    );
  };
  let selectionTimer;
  const clearSelection = () => {
    elementSelection = false;
    clearTimeout(selectionTimer);
    send(null);
  };
  document.addEventListener("mouseup", (event) => {
    clearTimeout(selectionTimer);
    if (!event.altKey) reportSelection();
  });
  // selectionchange also handles keyboard selection and touch selection handles.
  document.addEventListener("selectionchange", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(reportSelection, 100);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSelection();
    if (
      (event.ctrlKey || event.metaKey) &&
      event.altKey &&
      (event.code === "KeyM" || event.key.toLowerCase() === "m")
    ) {
      event.preventDefault();
      clearTimeout(selectionTimer);
      reportSelection(true);
    }
  });
  addEventListener("scroll", clearSelection, true);
  addEventListener("resize", clearSelection);
  let slide = 0;
  const slides = [...document.querySelectorAll("[data-dstar-slide]")];
  const showSlide = () => {
    if (!slides.length) return;
    slides.forEach((el, i) => {
      el.style.display = i === slide ? "" : "none";
    });
  };
  // Review UI lives in a shadow overlay, never in canonical content or its text
  // nodes. Numbers and resolved offsets are supplied by the authorized parent.
  let annotationLayer, markerLayer, highlightLayer;
  let annotationRecords = [],
    activeAnnotation = null,
    annotationTimer;
  const ensureAnnotations = () => {
    if (annotationLayer) return;
    annotationLayer = document.createElement("div");
    annotationLayer.setAttribute("data-dstar-review-ui", "");
    annotationLayer.style.cssText =
      "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;";
    const shadow = annotationLayer.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light; }
      button { position:absolute;box-sizing:border-box;width:28px;height:28px;padding:0;border:1px solid #cfdbd1;border-radius:50%;background:#fff;color:#28604b;font:600 12px/1 system-ui,sans-serif;box-shadow:0 2px 8px #24352b18;pointer-events:auto;cursor:pointer; }
      button:hover { background:#edf3ec;border-color:#8daa95; }
      button[aria-pressed="true"] { background:#315fba;border-color:#315fba;color:#fff;font-weight:700;box-shadow:0 0 0 3px #dce7ff,0 2px 8px #24352b18; }
      button:focus-visible { outline:2px solid #315fba;outline-offset:5px; }
      button.resolved:not([aria-pressed="true"]) { color:#747e77;background:#f4f6f3;border-style:dashed; }
      button::after { content:"";position:absolute;top:50%;width:7px;border-top:1px solid #b7c5ba; }
      button[data-side="left"]::after { left:100%; }
      button[data-side="right"]::after { right:100%; }
      button[aria-pressed="true"]::after { border-color:#7296da; }
      button[hidden] { display:none; }
      .highlight { position:absolute;background:#315fba14;border-bottom:2px solid #7296da;box-sizing:border-box;border-radius:2px; }
    `;
    highlightLayer = document.createElement("div");
    highlightLayer.setAttribute("aria-hidden", "true");
    markerLayer = document.createElement("div");
    shadow.append(style, highlightLayer, markerLayer);
    document.documentElement.append(annotationLayer);
  };
  const annotationRange = (element, anchor) => {
    if (
      !element ||
      anchor.type !== "text-range" ||
      !Number.isInteger(anchor.start) ||
      !Number.isInteger(anchor.end) ||
      anchor.start < 0 ||
      anchor.end <= anchor.start
    )
      return null;
    const textNodes = nodes(element);
    const point = (offset) => {
      for (const node of textNodes) {
        const chars = [...node.data];
        if (offset <= chars.length)
          return [node, chars.slice(0, offset).join("").length];
        offset -= chars.length;
      }
      return null;
    };
    const start = point(anchor.start),
      end = point(anchor.end);
    if (!start || !end) return null;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    return range;
  };
  const placeAnnotations = () => {
    if (!annotationLayer) return;
    highlightLayer.replaceChildren();
    const width = document.documentElement.clientWidth,
      height = document.documentElement.clientHeight;
    const placed = [];
    for (const record of annotationRecords) {
      const { element, button, group, ranges } = record;
      const rect = element.getBoundingClientRect();
      const visible =
        element.getClientRects().length &&
        rect.bottom > 0 &&
        rect.top < height &&
        rect.right > 0 &&
        rect.left < width;
      button.hidden = !visible;
      button.setAttribute(
        "aria-pressed",
        String(group.id === activeAnnotation),
      );
      if (!visible) continue;
      const rects = ranges.flatMap((range) =>
          range ? [...range.getClientRects()] : [rect],
        ),
        anchor =
          [...rects]
            .reverse()
            .find(
              (candidate) =>
                candidate.width &&
                candidate.height &&
                candidate.bottom > 0 &&
                candidate.top < height,
            ) ?? rect,
        size = 28,
        gap = 8,
        leftGutter = rect.left - size - gap,
        rightGutter = rect.right + gap,
        side = leftGutter >= 6 ? "left" : "right";
      let left = side === "left" ? leftGutter : rightGutter;
      if (left + size > width - 6) left = Math.max(6, width - size - 6);
      button.setAttribute("data-side", side);
      let top = Math.max(
        6,
        Math.min(anchor.top + (anchor.height - size) / 2, height - size - 6),
      );
      for (const previous of placed) {
        if (
          Math.abs(left - previous.left) < 32 &&
          Math.abs(top - previous.top) < 32
        )
          top = previous.top + 32;
      }
      button.hidden = top > height - 28;
      placed.push({ left, top });
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      if (group.id !== activeAnnotation) continue;
      for (const highlight of rects) {
        if (
          !highlight.width ||
          !highlight.height ||
          highlight.bottom <= 0 ||
          highlight.top >= height
        )
          continue;
        const mark = document.createElement("div");
        mark.className = "highlight";
        mark.style.cssText = `left:${highlight.left}px;top:${highlight.top}px;width:${highlight.width}px;height:${highlight.height}px;`;
        highlightLayer.append(mark);
      }
    }
  };
  const scheduleAnnotations = () => {
    clearTimeout(annotationTimer);
    annotationTimer = setTimeout(placeAnnotations, 0);
  };
  addEventListener("scroll", scheduleAnnotations, true);
  addEventListener("resize", scheduleAnnotations);
  const renderAnnotations = (data) => {
    if (!Array.isArray(data.groups)) return;
    ensureAnnotations();
    const elements = new Map(
      [...document.querySelectorAll("[data-dstar-id]")].map((element) => [
        element.dataset.dstarId,
        element,
      ]),
    );
    const existing = new Map(
      annotationRecords.map((record) => [record.group.id, record]),
    );
    annotationRecords = [];
    activeAnnotation = typeof data.active === "string" ? data.active : null;
    for (const group of data.groups) {
      const element = elements.get(group.id);
      if (
        !element ||
        !Number.isSafeInteger(group.number) ||
        group.number < 1 ||
        !Array.isArray(group.anchors) ||
        !group.anchors.length
      )
        continue;
      const button =
        existing.get(group.id)?.button ?? document.createElement("button");
      existing.delete(group.id);
      button.type = "button";
      button.textContent = group.number;
      button.className = group.resolved ? "resolved" : "";
      button.setAttribute(
        "aria-label",
        `Open comment location ${group.number}`,
      );
      button.title = `Comments ${group.number}${group.resolved ? " · Resolved" : ""}`;
      button.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        activeAnnotation = group.id;
        placeAnnotations();
        parent.postMessage(
          {
            kind: "dstar-annotation-focus",
            capability: context.capability,
            revision: context.revision,
            group: group.id,
          },
          context.origin,
        );
      };
      markerLayer.append(button);
      annotationRecords.push({
        element,
        group,
        button,
        ranges: group.anchors.flatMap((anchor) =>
          anchor.type === "text-ranges" && Array.isArray(anchor.ranges)
            ? anchor.ranges.map((part) =>
                annotationRange(elements.get(part.element), {
                  type: "text-range",
                  ...part,
                }),
              )
            : [annotationRange(element, anchor)],
        ),
      });
    }
    for (const record of existing.values()) record.button.remove();
    const focused = annotationRecords.find(
      (record) => record.group.id === data.focus,
    );
    if (focused) {
      const slideIndex = slides.findIndex((slideElement) =>
        slideElement.contains(focused.element),
      );
      if (slideIndex >= 0 && document.body.dataset.dstarMode === "slides") {
        slide = slideIndex;
        showSlide();
      }
      focused.element.scrollIntoView({ block: "center", inline: "nearest" });
    }
    placeAnnotations();
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
    if (
      event.data.kind === "dstar-annotations" &&
      event.data.revision === context.revision
    ) {
      renderAnnotations(event.data);
      return;
    }
    if (event.data.kind === "dstar-slide" && slides.length) {
      clearSelection();
      slide =
        (slide + (event.data.direction === -1 ? -1 : 1) + slides.length) %
        slides.length;
      showSlide();
      placeAnnotations();
    }
  });
})();
