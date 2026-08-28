# Canonical HTML contract

The supported development profile is `dstar-static-v1`. HTML is both source
and presentation. No parallel semantic JSON content is needed.

## File set

A staged candidate contains only:

- `document.html` (complete UTF-8 HTML with html/head/body);
- optional `styles.css` and/or CSS files beneath `styles/`;
- optional local PNG/JPEG/GIF/WebP images and WOFF/WOFF2 fonts beneath `assets/`.

Use relative ASCII paths. No symlinks, hidden files, external dependencies,
percent-encoded paths, query strings, data URLs or executable assets.
The current caps are 512 files, 8 MiB per file and 32 MiB total.
Link styles with `<link rel="stylesheet" href="styles.css">`.
Keep reusable images outside HTML so unchanged assets are stored once in history.

The accepted package adds Engine-owned `.dstar/state.json` and
`.dstar/objects/`. These are metadata/history, not a second document source.

## Identity

Meaningful text needs a stable `data-dstar-id` ancestor. Prefer an ID on each
independently reviewable paragraph, heading, figure, table or section.
Visible images require their own ID plus a nonempty `alt`.
IDs begin with a letter, contain only letters/digits/period/underscore/colon/hyphen
and have at most 128 characters.

Preserve IDs across editing, restyling and moves. Copies get new IDs. Remove
IDs only when their meaning is removed. Decorative wrappers need no ID.
Do not replace the whole DOM or reformat unrelated files for a small edit.

## Layout and safety

Use semantic HTML, grid, flex, positioning, responsive CSS and inline styles.
The current validator rejects scripts, event handlers, forms, iframes, SVG,
canvas, remote resources, `@import`, CSS escapes/comments and nonempty generated
CSS `content`. Meaningful text must remain DOM text.
CSS at-rules currently supported: media, supports, container, layer, keyframes,
font-face. External HTTPS navigation links may be present but the Viewer does
not follow them; assets must be local. Run `validate` for concrete diagnostics.

Slides use `<body data-dstar-mode="slides">` and slide sections with
`data-dstar-slide="1"`, etc. Put stable IDs on slide sections and their content.
The trusted Viewer supplies previous/next controls; your CSS defines the canvas.
Exported HTML shows all sections without requiring package scripts.
This MVP has no fullscreen, automatic fit-to-slide or arbitrary interactions.

All canonical file bytes and the fixed profile identifier affect the revision.
Format before proposing; do not sanitize, regenerate or modify a submitted
candidate after it is previewed.
