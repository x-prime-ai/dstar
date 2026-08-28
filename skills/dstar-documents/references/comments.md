# Comments and replies

A target binds the exact viewed revision, a stable element and an optional
Unicode code-point range. It never stores a CSS path as identity.

```json
{
  "revision": "sha256:FULL_VIEWED_REVISION",
  "element": "headline",
  "selector": {
    "type": "text-range",
    "start": 6,
    "end": 12,
    "unit": "unicode-code-point",
    "exact": "better",
    "prefix": "Build ",
    "suffix": " documents"
  }
}
```

For layout, styling or an image, use `"selector": {"type":"element"}`.

Offsets refer to `dom-text-v1`: HTML5-parsed, decoded descendant DOM text concatenated in
order, excluding hidden/aria-hidden=true/head/style subtrees. No whitespace is
collapsed or invented for layout, paragraphs or br tags. CSS-computed visibility
is not part of this static text model. Source CR/CRLF becomes LF, and a leading
LF in pre is removed by HTML5 parsing; character references are decoded under
HTML5 rules. These affect the text index, not the canonical file bytes.
Use the exact `index.elements[id].text`
from `inspect`; do not use raw HTML offsets, UTF-16 offsets or normalized
`innerText`. The Viewer converts browser selections to this same stream.
Cross-element range comments are not implemented: select within one stable
element, or comment on the enclosing element.

Write a target JSON file, then call:

```sh
pnpm dstar comment /absolute/path/document.dstar --target /absolute/path/target.json --body "Please clarify this passage" --author agent
pnpm dstar reply /absolute/path/document.dstar --comment COMMENT_ID --body "Prepared a candidate addressing this request" --author agent
```

The Engine validates the exact target against its original accepted or proposed
revision. A comment/reply changes collaboration metadata, not HTML or head.
Replies do not resolve comments. Human resolve is available in the Viewer;
assignment and automatic agent execution are not implemented.

Across revisions the original target is retained. Recovery checks the same
element and exact range, then searches exact quotation plus optional surrounding
context. One match is recovered, multiple matches are ambiguous, and no reliable
match is orphaned. Never silently move feedback to a different element.

Read the original thread and current content before preparing a comment-driven
candidate. The `propose` result reports anchor risks at submission time; comments
added afterward can be examined against current head in the Viewer.
