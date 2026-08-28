# HTML Document Runtime

> Earlier design exploration, not the implemented contract. The smaller
> Engine/CLI/Viewer architecture and exact current behavior are documented in
> [architecture](architecture.md) and [HTML-first MVP](html-mvp.md).
> MCP/SDK integration, assignment and broader guarantees here are deferred.

Status: **Redesign draft**

## 1. Purpose

DSTAR no longer renders a semantic JSON source into multiple presentations.
`document.html` is the canonical source and the exact presentation under
review. The HTML document runtime is responsible for safe validation, serving,
display, selection support, optional trusted behaviors, and agent-facing
authoring conventions.

## 2. One format, many authored experiences

The runtime treats these as examples of the same format:

```text
doc-like article    semantic flow HTML + restrained CSS
rich web page       arbitrary safe DOM structure + expressive CSS
slide deck          sections marked as slides + fixed-canvas CSS
```

An authoring request, template, or skill may tell an agent which experience to
create. That choice does not select another portable schema or projection.

Slides may use conventions such as:

```html
<main data-dstar-id="deck" data-dstar-mode="slides">
  <section data-dstar-id="slide_1" data-dstar-slide>
    <h1 data-dstar-id="title_1">A reviewable deck</h1>
  </section>
</main>
```

The viewer detects the declarative hint and supplies trusted navigation,
scaling, keyboard, and fullscreen behavior. Package-authored executable script
is not required.

## 3. Authoring contract

An agent or tool prepares a complete bounded candidate containing HTML, CSS,
and new asset objects. It may use any safe layout technique allowed by the CSS
policy. It must:

- preserve existing stable IDs for surviving semantic elements;
- assign unique stable IDs to new meaningful elements;
- keep meaningful text and accessibility names in HTML;
- use only declared package-local assets or allowed safe links;
- avoid executable code and unsupported active embeds;
- preserve requested human comments and constraints; and
- submit against the exact revision it inspected.

The system may provide deterministic formatting and reusable templates, but it
does not constrain every document to a shared component tree.

## 4. Validation

The HTML validator builds an immutable DOM index and checks:

- parser and nesting validity;
- unique, syntactically valid `data-dstar-id` values;
- reviewability of meaningful content;
- safe elements, attributes, URLs, and package references;
- absence of scripts, inline event handlers, forms, remote subresources,
  unsafe embeds, and active SVG;
- accessibility basics such as language, heading structure, image alternatives,
  and control names; and
- resource count, text, depth, attribute, CSS, and asset limits.

The CSS validator permits expressive presentation while denying execution and
exfiltration channels. External imports, remote fonts, network URLs, browser
extension URLs, and references outside the package are forbidden. The exact
allowlist remains normative-spec work.

Unsafe candidate bytes are rejected. They are not silently rewritten after the
reviewer has seen them.

## 5. Display

The workspace service serves validated canonical files through opaque,
snapshot-bound URLs. The browser frame receives a restrictive CSP and sandbox,
no workspace API credentials, and no host filesystem paths.

The host review UI overlays selection, comment indicators, diagnostics, and
proposal controls outside the untrusted frame. Package CSS cannot style or
obscure human decision controls.

## 6. Stable text model

For each stable element, the runtime computes a normalized visible text stream
in DOM order. Text selectors use Unicode code points. Hidden, decorative, and
generated content are handled by explicit rules so two conforming clients
derive the same target text.

The element index supports:

```ts
interface HtmlElementRecord {
  id: DstarElementId;
  tagName: string;
  parent?: DstarElementId;
  order: number;
  text: string;
  assetReferences: readonly PackagePath[];
}
```

## 7. Machine access

Agent context is extracted from the same canonical HTML rather than from a
parallel JSON tree. Bounded reads can return:

- a stable element's outer HTML and normalized text;
- ancestors and nearby stable elements;
- stylesheet rules and assets relevant to the element;
- matching comments and proposal context; and
- omitted-region markers when context is truncated.

Document text remains untrusted data and cannot change tool policy or authority.

## 8. Revision behavior

The document revision binds raw accepted HTML/CSS/asset bytes, not a regenerated
view. Deterministic formatting is recommended before proposal submission to
reduce noisy changes, but storage hashes preserve exact bytes.

Changes to trusted viewer behavior are bound through a manifest runtime
identifier. Disposable application chrome and review overlays are not part of
the document revision.

## 9. Tests

- doc-like, rich-page, and slide-deck fixtures using one canonical format;
- stable identity and normalized visible-text vectors;
- expressive grid, flex, fixed, responsive, and slide layouts;
- HTML/CSS parser limits and malicious-input corpus;
- package URL and asset containment;
- sandbox, CSP, and review-overlay isolation;
- trusted slide runtime navigation and accessibility;
- context extraction without executing document instructions; and
- raw-byte revision consistency across materialization.
