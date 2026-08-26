#!/usr/bin/env python3
"""Independent standard-library validator for the DSTAR minimal reference output."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / "spec" / "0.1" / "examples" / "minimal.dstar"
EXPECTED = ROOT / "spec" / "0.1" / "tests" / "roles" / "minimal.reference.json"


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, child in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = child
    return value


def read_ijson(path: Path) -> Any:
    text = path.read_text(encoding="utf-8")
    if text.startswith("\ufeff"):
        raise ValueError(f"BOM is forbidden: {path}")
    return json.loads(text, object_pairs_hook=reject_duplicate_keys)


def canonical_json(value: Any) -> bytes:
    # The published minimal vector contains only I-JSON integers. This
    # independent implementation deliberately refuses floats instead of
    # silently claiming the full RFC 8785 number algorithm.
    if isinstance(value, float):
        raise ValueError("minimal independent vector does not permit floats")
    if isinstance(value, list):
        for child in value:
            canonical_json(child)
    elif isinstance(value, dict):
        for child in value.values():
            canonical_json(child)
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def revision(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value)).hexdigest()


def node_count(node: dict[str, Any]) -> int:
    return 1 + sum(node_count(child) for child in node.get("children", []))


def main() -> None:
    manifest = read_ijson(PACKAGE / "manifest.json")
    document = read_ijson(PACKAGE / "document.json")
    genesis = read_ijson(PACKAGE / "changes" / "change_genesis_0001.json")
    expected = read_ijson(EXPECTED)
    computed = revision(document)
    core = expected["roles"]["Core Reader"]
    version = expected["roles"]["Version Reader"]

    assert computed == manifest["revision"] == core["documentRevision"]
    assert computed == version["revision"]
    assert node_count(document) == core["nodeCount"]
    assert genesis["author"]["type"] == "agent"
    assert genesis["decision"]["actor"]["type"] == "human"
    assert genesis["decision"]["resultRevision"] == computed
    print(
        "Independent Python validator: canonical revision, tree, history, "
        "and authority provenance passed."
    )


if __name__ == "__main__":
    main()
