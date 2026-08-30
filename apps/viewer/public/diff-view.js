// A bounded line LCS. Common edges are stripped first; a large rewrite falls
// back to exact removed/added blocks instead of allocating an unbounded matrix.
export function diffLines(before, after) {
  const left = before === "" ? [] : before.split("\n");
  const right = after === "" ? [] : after.split("\n");
  let prefix = 0,
    suffix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  )
    prefix++;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++;
  const a = left.slice(prefix, left.length - suffix),
    b = right.slice(prefix, right.length - suffix);
  const rows = [];
  let oldLine = 1,
    newLine = 1;
  const add = (kind, text) =>
    rows.push({
      kind,
      text,
      oldLine: kind === "add" ? null : oldLine++,
      newLine: kind === "remove" ? null : newLine++,
    });
  left.slice(0, prefix).forEach((line) => add("equal", line));
  const coarse = (a.length + 1) * (b.length + 1) > 500000;
  if (coarse) {
    a.forEach((line) => add("remove", line));
    b.forEach((line) => add("add", line));
  } else {
    const width = b.length + 1,
      matrix = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        matrix[i * width + j] =
          a[i] === b[j]
            ? 1 + matrix[(i + 1) * width + j + 1]
            : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        add("equal", a[i++]);
        j++;
      } else if (
        i < a.length &&
        (j === b.length ||
          matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])
      )
        add("remove", a[i++]);
      else add("add", b[j++]);
    }
  }
  left.slice(left.length - suffix).forEach((line) => add("equal", line));
  return { rows, coarse };
}

export function compactDiff(rows, context = 3) {
  const compact = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== "equal") {
      compact.push(rows[i++]);
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end].kind === "equal") end++;
    const leading = i === 0 ? 0 : context,
      trailing = end === rows.length ? 0 : context;
    if (end - i <= leading + trailing + 1) compact.push(...rows.slice(i, end));
    else {
      compact.push(
        ...rows.slice(i, i + leading),
        { kind: "skip", count: end - i - leading - trailing },
        ...rows.slice(end - trailing, end),
      );
    }
    i = end;
  }
  return compact;
}

export function changedText(before, after) {
  const a = [...before],
    b = [...after];
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return {
    prefix: a.slice(0, start).join(""),
    removed: a.slice(start, a.length - end).join(""),
    added: b.slice(start, b.length - end).join(""),
    suffix: a.slice(a.length - end).join(""),
  };
}

const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const labels = {
  inserted: "Added",
  removed: "Removed",
  text: "Text edited",
  tag: "Element type",
  position: "Moved",
  "attributes/style": "Style / attributes",
};

export function renderFileDiff(root, data) {
  root.replaceChildren();
  const controls = node("div", undefined, "file-diff-toolbar");
  controls.append(node("strong", data.path));
  const switches = node("div", undefined, "diff-format");
  switches.hidden = !data.isText;
  const content = node("button", "Content"),
    source = node("button", "Source");
  content.disabled = !data.elements.length;
  source.disabled = !data.isText;
  switches.append(content, source);
  controls.append(switches);
  const body = node("div", undefined, "file-diff-body");
  root.append(controls, body);
  let fullContext = false;
  const show = (mode) => {
    body.replaceChildren();
    content.setAttribute("aria-pressed", String(mode === "content"));
    source.setAttribute("aria-pressed", String(mode === "source"));
    if (mode === "content") {
      const heading = node("div", undefined, "comparison-labels");
      heading.append(
        node("span", "Before", "before-label"),
        node("span", "After", "after-label"),
      );
      body.append(heading);
      if (data.elements.length < data.elementChangeCount)
        body.append(
          node(
            "p",
            `Showing ${data.elements.length} of ${data.elementChangeCount} changed elements. Use Source or Preview for the full document.`,
            "diff-notice",
          ),
        );
      for (const change of data.elements) {
        const card = node("section", undefined, "element-diff");
        const title = node("div", undefined, "element-diff-heading");
        title.append(
          node("code", change.id),
          node(
            "span",
            change.changes.map((kind) => labels[kind] ?? kind).join(" · "),
          ),
        );
        const comparison = node("div", undefined, "text-comparison");
        const parts = changedText(
          change.before?.text.trim() ?? "",
          change.after?.text.trim() ?? "",
        );
        for (const [key, className, changeTag] of [
          ["before", "before-text", "del"],
          ["after", "after-text", "ins"],
        ]) {
          const side = change[key],
            pane = node("div", undefined, className);
          pane.append(
            node(
              "span",
              key === "before" ? "Before" : "After",
              "mobile-side-label",
            ),
          );
          if (!side)
            pane.append(
              node(
                "p",
                key === "before" ? "New element" : "Element removed",
                "empty-diff",
              ),
            );
          else {
            const text = node("p", undefined, "diff-prose");
            text.append(
              node("span", parts.prefix),
              node(changeTag, parts[key === "before" ? "removed" : "added"]),
              node("span", parts.suffix),
            );
            if (!side.text)
              text.append(
                node("span", `〈${side.tag}〉 · No text content`, "empty-diff"),
              );
            pane.append(text);
            if (side.truncated)
              pane.append(
                node(
                  "small",
                  "Text shortened. Check Source or return to the document for the complete content.",
                  "diff-notice",
                ),
              );
          }
          comparison.append(pane);
        }
        card.append(title, comparison);
        body.append(card);
      }
      return;
    }
    if (!data.isText) {
      body.append(
        node(
          "p",
          `Binary asset · ${data.before.bytes.toLocaleString()} → ${data.after.bytes.toLocaleString()} bytes. Check Preview to review the visual change.`,
          "diff-notice",
        ),
      );
      return;
    }
    if (data.before.omitted || data.after.omitted) {
      body.append(
        node(
          "p",
          "This file exceeds the inline diff limit (512 KiB per side). Return to the document for the complete version; no partial source diff is shown.",
          "diff-notice",
        ),
      );
      return;
    }
    const diff = diffLines(data.before.text, data.after.text);
    const sourceSummary = node("div", undefined, "source-summary");
    const added = diff.rows.filter((row) => row.kind === "add").length;
    const removed = diff.rows.filter((row) => row.kind === "remove").length;
    sourceSummary.append(node("span", `−${removed} removed · +${added} added`));
    const context = node(
      "button",
      fullContext ? "Hide unchanged lines" : "Show all lines",
    );
    context.setAttribute("aria-pressed", String(fullContext));
    context.onclick = () => {
      fullContext = !fullContext;
      show("source");
    };
    sourceSummary.append(context);
    body.append(sourceSummary);
    if (diff.coarse)
      body.append(
        node(
          "p",
          "Large rewrite: showing removed and added blocks without line pairing.",
          "diff-notice",
        ),
      );
    const code = node("div", undefined, "source-diff");
    code.setAttribute("role", "table");
    code.setAttribute("aria-label", `${data.path} source changes`);
    const tableHead = node("div", undefined, "source-row source-heading");
    for (const label of ["Old", "New", "", "Source changes"]) {
      const cell = node("span", label);
      cell.setAttribute("role", "columnheader");
      tableHead.append(cell);
    }
    tableHead.setAttribute("role", "row");
    code.append(tableHead);
    const rows = fullContext ? diff.rows : compactDiff(diff.rows);
    // Bound DOM work independently of the diff algorithm for minified/generated files.
    for (const row of rows.slice(0, 2500)) {
      if (row.kind === "skip") {
        code.append(
          node(
            "div",
            `⋯ ${row.count} unchanged ${row.count === 1 ? "line" : "lines"}`,
            "source-skip",
          ),
        );
        continue;
      }
      const line = node("div", undefined, `source-row ${row.kind}`);
      line.setAttribute("role", "row");
      for (const [tag, value, className] of [
        ["span", row.oldLine ?? "", "line-number"],
        ["span", row.newLine ?? "", "line-number"],
        [
          "span",
          row.kind === "remove" ? "−" : row.kind === "add" ? "+" : "",
          "line-sign",
        ],
        ["code", row.text, "line-code"],
      ]) {
        const cell = node(tag, value, className);
        cell.setAttribute("role", "cell");
        line.append(cell);
      }
      code.append(line);
    }
    if (rows.length > 2500)
      body.append(
        node(
          "p",
          "Showing the first 2,500 diff rows. Return to the document to review the complete version.",
          "diff-notice",
        ),
      );
    body.append(code);
  };
  content.onclick = () => show("content");
  source.onclick = () => show("source");
  show(data.elements.length ? "content" : "source");
}
