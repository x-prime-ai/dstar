# DSTAR sample documents

Each directory is a complete, validated DSTAR candidate with canonical
`document.html` and `styles.css`. The four samples use DSTAR itself as their
subject while demonstrating different document forms.

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
