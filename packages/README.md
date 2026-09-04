# DSTAR packages

`@dstar/engine` is the TypeScript implementation behind the HTML-first CLI,
Viewer and workspace services. It validates complete HTML/CSS/asset candidates,
stores exact revisions and compact history, and records proposals and comments.

The package is currently private to this workspace. Its exports are an internal
integration boundary, not a published or compatibility-stable SDK. External
hosts should use the documented CLI or host the Engine and Viewer together until
a concrete SDK contract is defined.
