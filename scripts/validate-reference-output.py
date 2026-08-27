#!/usr/bin/env python3
"""Independent standard-library validator for DSTAR role reference output."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
ROLE_INDEX = ROOT / "spec" / "0.1" / "tests" / "roles" / "manifest.json"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
READER_CSP = "; ".join(
    [
        "default-src 'none'",
        "img-src 'self' data:",
        "style-src 'unsafe-inline'",
        "font-src 'self'",
        "script-src 'none'",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
    ]
)


def fail(message: str) -> None:
    raise ValueError(message)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, child in pairs:
        if key in value:
            fail(f"duplicate JSON key: {key}")
        value[key] = child
    return value


def read_ijson(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if text.startswith("\ufeff"):
        fail(f"BOM is forbidden: {path}")
    return json.loads(text, object_pairs_hook=reject_duplicate_keys)


def validate_ijson_numbers(value: Any) -> None:
    if isinstance(value, float):
        fail("independent role vectors do not permit floats")
    if isinstance(value, int) and not isinstance(value, bool):
        check(abs(value) <= MAX_SAFE_INTEGER, "integer is outside the I-JSON range")
    if isinstance(value, list):
        for child in value:
            validate_ijson_numbers(child)
    elif isinstance(value, dict):
        for child in value.values():
            validate_ijson_numbers(child)


def canonical_json(value: Any) -> bytes:
    # These fixtures contain only I-JSON integers. Refusing floats avoids
    # claiming an incomplete RFC 8785 binary64 implementation.
    validate_ijson_numbers(value)
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def revision(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value)).hexdigest()


def byte_revision(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def walk_nodes(node: dict[str, Any]) -> list[dict[str, Any]]:
    result = [node]
    for child in node.get("children", []):
        result.extend(walk_nodes(child))
    return result


def node_text(node: dict[str, Any]) -> str:
    return "".join(
        inline.get("text", "")
        for inline in node.get("content", [])
        if isinstance(inline, dict)
    )


def find_node(document: dict[str, Any], node_id: str) -> dict[str, Any]:
    for node in walk_nodes(document):
        if node.get("id") == node_id:
            return node
    fail(f"node does not exist: {node_id}")


def replace_text(document: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
    check(operation.get("op") == "replace_text", "unsupported fixture operation")
    range_ = operation["range"]
    check(
        range_.get("unit") == "unicode-code-point",
        "replace_text must use Unicode code points",
    )
    result = copy.deepcopy(document)
    node = find_node(result, operation["target"]["node"])
    text = node_text(node)
    start, end = range_["start"], range_["end"]
    check(0 <= start <= end <= len(text), "replace_text range is invalid")
    expected = operation.get("expectedText")
    if expected is not None:
        check(text[start:end] == expected, "replace_text expectedText mismatch")

    content = node.get("content", [])
    cursor = 0
    inserted = False
    updated: list[dict[str, Any]] = []
    for inline in content:
        run = inline.get("text", "")
        run_start, run_end = cursor, cursor + len(run)
        cursor = run_end
        if run_end <= start or run_start >= end:
            updated.append(copy.deepcopy(inline))
            continue
        left = run[: max(0, start - run_start)]
        right = run[max(0, end - run_start) :] if end <= run_end else ""
        replacement = operation["value"] if not inserted else ""
        inserted = True
        child = copy.deepcopy(inline)
        child["text"] = left + replacement + right
        updated.append(child)
    check(inserted, "replace_text did not touch a text run")
    node["content"] = updated
    return result


def review_target_state(
    document: dict[str, Any], document_revision: str, target: dict[str, Any]
) -> str:
    if target.get("source") != "document" or target.get("revision") != document_revision:
        return "orphaned"
    selector = target.get("selector", {})
    if selector.get("type") != "NodeSelector":
        return "ambiguous"
    try:
        node = find_node(document, selector["node"])
    except ValueError:
        return "orphaned"
    text = node_text(node)
    position = next(
        (
            item
            for item in selector.get("refinedBy", [])
            if item.get("type") == "TextPositionSelector"
        ),
        None,
    )
    quote = next(
        (
            item
            for item in selector.get("refinedBy", [])
            if item.get("type") == "TextQuoteSelector"
        ),
        None,
    )
    if position is None and quote is None:
        return "exact"
    if position is None or quote is None:
        return "ambiguous"
    start, end = position["start"], position["end"]
    if not (0 <= start <= end <= len(text)) or text[start:end] != quote["exact"]:
        return "orphaned"
    prefix = quote.get("prefix", "")
    suffix = quote.get("suffix", "")
    if prefix and not text[:start].endswith(prefix):
        return "orphaned"
    if suffix and not text[end:].startswith(suffix):
        return "orphaned"
    return "exact"


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def escape_attribute(value: str) -> str:
    return escape_html(value).replace("`", "&#96;")


def safe_link(value: str) -> str | None:
    if re.match(r"^(?:https?|mailto):", value):
        return value
    if not value.startswith(("/", "\\")) and ".." not in value.split("/"):
        return value
    return None


def inline_html(node: dict[str, Any], descriptors: bool) -> str:
    output: list[str] = []
    offset = 0
    for index, inline in enumerate(node.get("content", [])):
        text = inline.get("text", "")
        rendered = escape_html(text)
        for mark in inline.get("marks", []):
            kind = mark.get("type")
            if kind == "strong":
                rendered = f"<strong>{rendered}</strong>"
            elif kind == "emphasis":
                rendered = f"<em>{rendered}</em>"
            elif kind == "code":
                rendered = f"<code>{rendered}</code>"
            elif kind == "link":
                href = safe_link(mark.get("attrs", {}).get("href", ""))
                rendered = (
                    f'<a href="{escape_attribute(href)}" rel="noopener noreferrer" '
                    f'target="_blank">{rendered}</a>'
                    if href
                    else '<span class="dstar-unsafe-link" title="Unsafe link removed">'
                    f"{rendered}</span>"
                )
            else:
                rendered = (
                    '<span class="dstar-unsupported-mark" '
                    f'data-dstar-unsupported-mark="{escape_attribute(str(kind))}" '
                    f'title="Unsupported mark: {escape_attribute(str(kind))}">'
                    f"{rendered}</span>"
                )
        end = offset + len(text)
        if descriptors:
            run_id = f"{node['id']}:text:{index}"
            rendered = (
                f'<span data-dstar-end="{end}" data-dstar-start="{offset}" '
                f'data-dstar-text-run="{escape_attribute(run_id)}">{rendered}</span>'
            )
        output.append(rendered)
        offset = end
    return "".join(output)


def image_is_safe(package_root: Path, source: str) -> bool:
    path = package_root / source
    if source.startswith(("/", "\\")) or ".." in source.split("/") or not path.is_file():
        return False
    data = path.read_bytes()
    return (
        data.startswith(b"\x89PNG\r\n\x1a\n")
        or data.startswith(b"\xff\xd8\xff")
        or data[:6] in (b"GIF87a", b"GIF89a")
        or (data.startswith(b"RIFF") and data[8:12] == b"WEBP")
    )


def segment_id(kind: str, node_id: str) -> str:
    return f"segment_{kind}_{re.sub(r'[^A-Za-z0-9._:-]', '_', node_id)}"


def node_html(
    package_root: Path, node: dict[str, Any], mode: str, segment: str | None = None
) -> str:
    kind = node["type"]
    if kind == "document":
        attribute = f' data-dstar-node="{escape_attribute(node["id"])}"' if mode == "canonical" else ""
        children = "".join(
            node_html(
                package_root,
                child,
                mode,
                segment_id("projection", child["id"]) if mode == "projection" else None,
            )
            for child in node.get("children", [])
        )
        return f"<article{attribute}>{children}</article>"
    attribute = (
        f'data-dstar-node="{escape_attribute(node["id"])}"'
        if mode == "canonical"
        else f'data-dstar-segment="{escape_attribute(segment or "")}"'
    )
    if kind == "heading":
        level = node.get("attrs", {}).get("level")
        body = inline_html(node, mode == "canonical") or f'<span class="dstar-empty">Empty heading {escape_html(node["id"])}</span>'
        return f"<h{level} {attribute}>{body}</h{level}>"
    if kind == "paragraph":
        body = inline_html(node, mode == "canonical") or f'<span class="dstar-empty">Empty paragraph {escape_html(node["id"])}</span>'
        return f"<p {attribute}>{body}</p>"
    if kind == "image":
        attrs = node.get("attrs", {})
        source = attrs.get("src", "")
        alt = attrs.get("alt", "Image")
        if image_is_safe(package_root, source):
            return (
                f"<figure {attribute}><img alt=\"{escape_attribute(alt)}\" "
                f"src=\"../{escape_attribute(source)}\"><figcaption>"
                f"{escape_html(alt)}</figcaption></figure>"
            )
        return (
            f'<figure {attribute} class="dstar-asset-fallback" role="note">'
            f"<strong>Image unavailable</strong><figcaption>{escape_html(alt)}</figcaption>"
            f"<div>{escape_html(source or 'No asset path')}</div></figure>"
        )
    fail(f"independent renderer does not support node type {kind}")


def html_document(title: str, body: str) -> str:
    return "\n".join(
        [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '<meta charset="utf-8">',
            f'<meta content="{escape_attribute(READER_CSP)}" http-equiv="Content-Security-Policy">',
            '<meta content="width=device-width, initial-scale=1" name="viewport">',
            f"<title>{escape_html(title)}</title>",
            "<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0 auto;max-width:72ch;padding:2rem;line-height:1.55}img{height:auto;max-width:100%}pre{overflow:auto;white-space:pre-wrap}.dstar-unsupported,.dstar-asset-fallback{border:2px solid #b66;padding:1rem}.dstar-unsupported-mark,.dstar-unsafe-link{text-decoration:underline wavy #b66}</style>",
            "</head>",
            f"<body>{body}</body>",
            "</html>",
            "",
        ]
    )


def escape_markdown(value: str) -> str:
    return re.sub(r"([\\`*_{}<>#|\[\]])", r"\\\1", value)


def markdown_inline(inline: dict[str, Any]) -> str:
    output = escape_markdown(inline.get("text", ""))
    for mark in inline.get("marks", []):
        kind = mark.get("type")
        if kind == "strong":
            output = f"**{output}**"
        elif kind == "emphasis":
            output = f"_{output}_"
        elif kind == "code":
            escaped = output.replace("`", "\\`")
            output = f"`{escaped}`"
        elif kind == "link":
            href = safe_link(mark.get("attrs", {}).get("href", ""))
            output = f"[{output}]({href.replace(')', '%29')})" if href else f"{output} [unsafe link removed]"
        else:
            output = f"{output} [unsupported mark: {escape_markdown(str(kind))}]"
    return output


def markdown_node(package_root: Path, node: dict[str, Any]) -> str:
    kind = node["type"]
    if kind == "heading":
        return "#" * node.get("attrs", {}).get("level", 1) + " " + "".join(
            markdown_inline(inline) for inline in node.get("content", [])
        )
    if kind == "paragraph":
        text = "".join(markdown_inline(inline) for inline in node.get("content", []))
        return text or f"[Empty paragraph {node['id']}]"
    if kind == "image":
        attrs = node.get("attrs", {})
        source, alt = attrs.get("src", ""), attrs.get("alt", "Image")
        if image_is_safe(package_root, source):
            return f"![{escape_markdown(alt)}](../{source.replace(')', '%29')})"
        return f"[Image unavailable: {escape_markdown(alt)} ({escape_markdown(source)})]"
    fail(f"independent Markdown renderer does not support {kind}")


def plain_node(node: dict[str, Any]) -> str:
    kind = node["type"]
    if kind in ("heading", "paragraph"):
        return node_text(node) or f"Empty {kind} {node['id']}"
    if kind == "image":
        return f"Image: {node.get('attrs', {}).get('alt', 'Image')}"
    fail(f"independent text renderer does not support {kind}")


def render_summary(
    package_root: Path, manifest: dict[str, Any], document: dict[str, Any], kinds: list[str]
) -> dict[str, Any]:
    nodes = walk_nodes(document)
    meaningful = [node for node in nodes if node["type"] != "document"]
    title_node = next((node for node in meaningful if node["type"] == "heading" and node_text(node)), None)
    title = node_text(title_node) if title_node else manifest["title"]
    canonical = html_document(title, node_html(package_root, document, "canonical"))
    projections: list[dict[str, Any]] = []
    for kind in kinds:
        if kind == "html":
            value = html_document(title, node_html(package_root, document, "projection"))
        elif kind == "markdown":
            value = "\n\n".join(markdown_node(package_root, node) for node in meaningful) + "\n"
        elif kind == "plain-text":
            value = "\n".join(plain_node(node) for node in meaningful) + "\n"
        else:
            fail(f"unsupported projection kind: {kind}")
        projections.append(
            {
                "kind": kind,
                "revision": byte_revision(value),
                "reviewable": bool(meaningful),
                "segmentCount": len(meaningful),
            }
        )
    return {
        "canonicalByteLength": len(canonical.encode("utf-8")),
        "canonicalNodeOrder": [node["id"] for node in nodes],
        "projections": projections,
    }


def normalized_case(entry: dict[str, Any], fixture_directory: Path) -> dict[str, Any]:
    package_root = (fixture_directory / entry["package"]).resolve()
    manifest = read_ijson(package_root / "manifest.json")
    document = read_ijson(package_root / manifest["document"])
    computed = revision(document)
    check(computed == manifest["revision"], f"{entry['id']}: manifest revision mismatch")
    check(manifest["profiles"] == entry["profiles"], f"{entry['id']}: profile mismatch")
    nodes = walk_nodes(document)
    node_ids = [node["id"] for node in nodes]
    check(len(node_ids) == len(set(node_ids)), f"{entry['id']}: duplicate node ID")

    changes = {
        change["id"]: change
        for change in (
            read_ijson(path) for path in sorted((package_root / manifest["changes"]).glob("*.json"))
        )
    }
    head = changes[manifest["headChange"]]
    check(head["status"] == "accepted", f"{entry['id']}: head is not accepted")
    check(head["decision"]["resultRevision"] == computed, f"{entry['id']}: history revision mismatch")
    check(head["author"]["type"] == "agent", f"{entry['id']}: head author is not an agent")
    check(head["decision"]["actor"]["type"] == "human", f"{entry['id']}: head decision is not human")
    version_count = 0
    cursor: dict[str, Any] | None = head
    while cursor is not None:
        version_count += 1
        parent = cursor.get("baseChange")
        cursor = changes.get(parent) if parent else None

    exercise = entry["exercise"]
    operation = exercise["update"]["operation"]
    updated_document = replace_text(document, operation)
    result_revision = revision(updated_document)
    review = exercise["review"]
    annotation = read_ijson(package_root / manifest["annotations"] / f"{review['annotationId']}.json")
    target = annotation["canonicalTargets"][review.get("canonicalTargetIndex", 0)]
    target_state = review_target_state(document, computed, target)
    proposal = exercise["update"]["proposal"]
    decision = exercise["update"]["decision"]
    check(proposal["author"]["type"] == "agent", f"{entry['id']}: proposal author fixture is not an agent")
    check(decision["actor"]["type"] == "human", f"{entry['id']}: decision actor fixture is not human")

    available = {
        "Core Reader": {
            "valid": True,
            "documentId": manifest["id"],
            "documentRevision": computed,
            "nodeCount": len(nodes),
        },
        "Version Reader": {
            "valid": True,
            "targetChangeId": head["id"],
            "revision": head["decision"]["resultRevision"],
            "versionCount": version_count,
        },
        "Core Writer": {
            "applicable": True,
            "resultRevision": result_revision,
            "preservedRootId": updated_document["id"],
        },
        "Review Client": {
            "annotationId": annotation["id"],
            "targetState": target_state,
        },
        "Change Producer": {
            "valid": True,
            "authorType": "agent",
            "status": "proposed",
            "operationCount": 1,
        },
        "Change Applier": {
            "valid": True,
            "decisionActorType": "human",
            "resultRevision": result_revision,
        },
        "Projection Renderer": render_summary(
            package_root, manifest, document, exercise["projections"]
        ),
    }
    unknown = [role for role in entry["roles"] if role not in available]
    check(not unknown, f"{entry['id']}: unsupported roles: {unknown}")
    return {
        "format": "dstar-role-output/0.1",
        "caseId": entry["id"],
        "dstar": manifest["dstar"],
        "profiles": manifest["profiles"],
        "roles": {role: available[role] for role in entry["roles"]},
    }


def main() -> None:
    index = read_ijson(ROLE_INDEX)
    check(index.get("format") == "dstar-role-fixtures/0.1", "unsupported role fixture format")
    fixture_directory = ROLE_INDEX.parent
    for entry in index["cases"]:
        actual = normalized_case(entry, fixture_directory)
        expected = read_ijson(fixture_directory / entry["expected"])
        check(actual == expected, f"{entry['id']}: independent normalized output mismatch\n{json.dumps(actual, indent=2)}")
        print(f"Independent Python validator: {entry['id']} ({len(entry['roles'])} roles) passed.")


if __name__ == "__main__":
    main()
