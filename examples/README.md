# DSTAR sample documents

Each directory is a complete, validated DSTAR candidate with canonical
`document.html` and `styles.css`. The four samples use DSTAR itself as their
subject while demonstrating different document forms.

Start the Documents service and open the printed URL:

```sh
pnpm examples:start
```

The service opens every sample through its own DSTAR Viewer, so text selection,
comments, suggestions and versions work from the library rows. Opening the raw
`document.html` files is preview-only and does not provide review controls.

**New document** creates a private 15-minute handoff for an external agent. The handoff page exposes
`get_document_creation_request` and `submit_created_document` through WebMCP;
the agent reads the exact brief and returns a complete self-contained HTML
document. Only the returned result is stored in the browser and shown under
**Your documents**. Generated documents can be downloaded as standalone HTML,
but they are not added to the repository or converted into a persistent DSTAR
package automatically.

| Sample                                             | Purpose                        | Notable elements                                                                    |
| -------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| [`dstar-doc`](dstar-doc/document.html)             | Conventional product brief     | Long-form text, metadata, a process diagram, table, ordered principles, callouts    |
| [`dstar-rich`](dstar-rich/document.html)           | Rich HTML explainer            | Editorial hero, CSS system map, bento layout, journey, live-context panel, details  |
| [`dstar-slides`](dstar-slides/document.html)       | Six-slide product story        | Title, problem, state model, review loop, WebMCP context, closing slides            |
| [`dstar-ui-design`](dstar-ui-design/document.html) | Viewer UI design specification | Interface mockup, component anatomy, annotation states, tokens, responsive behavior |

Validate any candidate directly:

```sh
pnpm dstar validate examples/dstar-doc
pnpm dstar validate examples/dstar-rich
pnpm dstar validate examples/dstar-slides
pnpm dstar validate examples/dstar-ui-design
```

To review one in the DSTAR Viewer, create a package from it and start the local
service:

```sh
pnpm dstar propose ./sample.dstar --candidate examples/dstar-rich --base none --request "Create the sample" --key sample-genesis
pnpm dstar serve ./sample.dstar
```

The slide sample uses the same canonical format with
`body[data-dstar-mode="slides"]` and one `data-dstar-slide` section per slide.
The trusted Viewer bridge supplies slide navigation; the candidate itself
contains no script.
