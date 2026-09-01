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
  const sendAnnotation = (kind, group) =>
    parent.postMessage(
      {
        kind,
        capability: context.capability,
        revision: context.revision,
        ...(group ? { group } : {}),
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
      if (event.composedPath?.().includes(annotationButton)) return;
      const link = event.target.closest("a");
      if (link && !link.getAttribute("href")?.startsWith("#"))
        event.preventDefault();
      sendAnnotation("dstar-annotation-clear");
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
    getSelection()?.removeAllRanges?.();
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
  const linkedSlide = (link) => {
    const href = link?.getAttribute?.("href");
    if (!href?.startsWith("#") || href === "#") return null;
    try {
      const target = document.getElementById(decodeURIComponent(href.slice(1)));
      return slides.find(
        (slideElement) =>
          slideElement === target || slideElement.contains(target),
      );
    } catch {
      return null;
    }
  };
  const showSlide = () => {
    if (!slides.length) return;
    slides.forEach((el, i) => {
      el.style.display = i === slide ? "" : "none";
    });
    for (const link of document.querySelectorAll('a[href^="#"]')) {
      const target = linkedSlide(link);
      if (!target) continue;
      if (target === slides[slide]) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  };
  if (document.body.dataset.dstarMode === "slides") {
    document.addEventListener("click", (event) => {
      const link = event.target?.closest?.('a[href^="#"]');
      const nextSlide = slides.indexOf(linkedSlide(link));
      if (nextSlide < 0) return;
      clearSelection();
      slide = nextSlide;
      showSlide();
      placeAnnotations();
    });
  }
  // Review highlights live in a shadow overlay, never in canonical content or
  // its text nodes. Resolved offsets come from the authorized parent.
  let annotationLayer, highlightLayer, annotationButton;
  let annotationRecords = [],
    annotationHitboxes = [],
    annotationAnchors = new Map(),
    activeAnnotation = null,
    annotationTimer,
    annotationHideTimer;
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
      .highlight { position:absolute;box-sizing:border-box;border-radius:2px;background:#e6c85b38;border-bottom:1px solid #c3a03588; }
      .highlight.active { background:#83aee85c;border-bottom:2px solid #315f9b;box-shadow:0 0 0 1px #5f8ecb3d; }
      .comment-jump { position:absolute;display:none;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1px solid #c3d1c7;border-radius:50%;background:#fff;color:#285743;box-shadow:0 3px 12px #203c3042;pointer-events:auto;cursor:pointer; }
      .comment-jump:hover,.comment-jump:focus-visible { background:#285743;color:#fff;outline:none; }
      .comment-jump svg { width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round; }
    `;
    highlightLayer = document.createElement("div");
    highlightLayer.setAttribute("aria-hidden", "true");
    annotationButton = document.createElement("button");
    annotationButton.className = "comment-jump";
    annotationButton.type = "button";
    annotationButton.setAttribute("aria-label", "Open comment thread");
    annotationButton.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>';
    annotationButton.onmouseenter = () => clearTimeout(annotationHideTimer);
    annotationButton.onmouseleave = () => scheduleAnnotationHide();
    annotationButton.onclick = (event) => {
      event.stopPropagation?.();
      if (annotationButton.annotationGroup)
        sendAnnotation(
          "dstar-annotation-focus",
          annotationButton.annotationGroup,
        );
    };
    shadow.append(style, highlightLayer, annotationButton);
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
    annotationHitboxes = [];
    annotationAnchors = new Map();
    clearTimeout(annotationHideTimer);
    annotationButton.style.display = "none";
    annotationButton.annotationGroup = null;
    const width = document.documentElement.clientWidth,
      height = document.documentElement.clientHeight;
    for (const record of annotationRecords) {
      const { element, group, ranges } = record;
      const rect = element.getBoundingClientRect();
      const visible =
        element.getClientRects().length &&
        rect.bottom > 0 &&
        rect.top < height &&
        rect.right > 0 &&
        rect.left < width;
      if (!visible) continue;
      const rects = ranges.flatMap((range) =>
        range ? [...range.getClientRects()] : [rect],
      );
      for (const highlight of rects) {
        if (
          !highlight.width ||
          !highlight.height ||
          highlight.bottom <= 0 ||
          highlight.top >= height
        )
          continue;
        const mark = document.createElement("div");
        mark.className =
          group.id === activeAnnotation ? "highlight active" : "highlight";
        mark.style.cssText = `left:${highlight.left}px;top:${highlight.top}px;width:${highlight.width}px;height:${highlight.height}px;`;
        highlightLayer.append(mark);
        annotationHitboxes.push({
          group: group.id,
          left: highlight.left,
          top: highlight.top,
          right: highlight.right,
          bottom: highlight.bottom,
        });
        const anchor = annotationAnchors.get(group.id);
        annotationAnchors.set(
          group.id,
          anchor
            ? {
                right: Math.max(anchor.right, highlight.right),
                top: Math.min(anchor.top, highlight.top),
                bottom: Math.max(anchor.bottom, highlight.bottom),
              }
            : {
                right: highlight.right,
                top: highlight.top,
                bottom: highlight.bottom,
              },
        );
      }
    }
  };
  const hideAnnotationButton = () => {
    annotationButton.style.display = "none";
    annotationButton.annotationGroup = null;
  };
  const scheduleAnnotationHide = () => {
    clearTimeout(annotationHideTimer);
    annotationHideTimer = setTimeout(hideAnnotationButton, 300);
  };
  document.addEventListener("mousemove", (event) => {
    if (!annotationButton || event.composedPath?.().includes(annotationButton))
      return;
    const hit = annotationHitboxes.findLast(
      (box) =>
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom,
    );
    if (!hit) {
      scheduleAnnotationHide();
      return;
    }
    clearTimeout(annotationHideTimer);
    const anchor = annotationAnchors.get(hit.group);
    if (!anchor) return;
    annotationButton.annotationGroup = hit.group;
    annotationButton.style.left = `${Math.max(
      2,
      Math.min(document.documentElement.clientWidth - 34, anchor.right - 24),
    )}px`;
    annotationButton.style.top = `${Math.max(
      2,
      (anchor.top + anchor.bottom) / 2 - 16,
    )}px`;
    annotationButton.style.display = "flex";
  });
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
    annotationRecords = [];
    activeAnnotation = typeof data.active === "string" ? data.active : null;
    for (const group of data.groups) {
      const element = elements.get(
        typeof group.element === "string" ? group.element : group.id,
      );
      if (
        !element ||
        typeof group.id !== "string" ||
        !Array.isArray(group.anchors) ||
        !group.anchors.length
      )
        continue;
      annotationRecords.push({
        element,
        group,
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
    if (
      event.data.kind === "dstar-clear-selection" &&
      event.data.revision === context.revision
    ) {
      clearSelection();
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
