import {
  documentRevision,
  type DstarDocument,
  type DstarManifest,
  type InMemoryPackage,
} from "@dstar/core";
import { PackageSnapshot, openPackage } from "@dstar/node";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { safeAssetResponse } from "./assets.js";
import { verifyRenderedProjection } from "./publish.js";
import { renderCanonicalHtml, renderProjection } from "./renderers.js";
import { sanitizeStoredProjectionHtml } from "./safety.js";

const fixtureRoot = resolve(
  import.meta.dirname,
  "../../../spec/0.1/examples/minimal.dstar",
);

function memorySnapshot(
  document: DstarDocument,
  files: ReadonlyMap<string, Uint8Array> = new Map(),
): PackageSnapshot {
  const revision = documentRevision(document);
  const manifest: DstarManifest = {
    dstar: "0.1",
    id: "doc_render_test",
    revision,
    headChange: "change_genesis_test",
    title: "Render test",
    profiles: ["dstar:base", "example:unknown"],
    document: "document.json",
    changes: "changes",
  };
  const pkg: InMemoryPackage = {
    manifest,
    document,
    annotations: [],
    changes: [],
  };
  return new PackageSnapshot({
    root: "/memory/test.dstar",
    snapshotId: "snapshot:memory",
    inventory: [],
    pkg,
    bytes: files,
    diagnostics: [],
  });
}

describe("deterministic renderer", () => {
  it("emits byte-identical canonical and projection output with verified mappings", async () => {
    const snapshot = await openPackage(fixtureRoot);
    const mappingGolden = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "../fixtures/minimal/mappings.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const first = renderCanonicalHtml(snapshot);
    const second = renderCanonicalHtml(snapshot);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.nodeOrder).toEqual([
      "node_root",
      "node_title",
      "node_promise",
      "node_resources",
      "node_architecture",
    ]);
    expect(first.html).toContain('data-dstar-text-run="node_resources:text:1"');
    expect(first.html).not.toMatch(/<script|<svg|onerror=/iu);

    for (const kind of ["html", "markdown", "plain-text"] as const) {
      const left = renderProjection(snapshot, kind);
      const right = renderProjection(snapshot, kind);
      expect(left.bytes).toEqual(right.bytes);
      expect({
        revision: left.revision,
        reviewable: left.reviewable,
        segments: left.segments,
      }).toEqual(mappingGolden[kind]);
      const extension =
        kind === "html" ? "html" : kind === "markdown" ? "md" : "txt";
      expect(left.bytes).toEqual(
        new Uint8Array(
          await readFile(
            resolve(
              import.meta.dirname,
              `../fixtures/minimal/document.${extension}`,
            ),
          ),
        ),
      );
      expect(left.segments).toEqual(right.segments);
      expect(left.reviewable).toBe(true);
      expect(() => verifyRenderedProjection(snapshot, left)).not.toThrow();
      if (kind === "html") {
        const sanitized = sanitizeStoredProjectionHtml(left.bytes, {
          id: "projection_html_test",
          role: left.role,
          mediaType: left.mediaType,
          path: "projections/document.html",
          reviewable: left.reviewable,
          generatedFromRevision: snapshot.manifest.revision,
          revision: left.revision,
          segments: [...left.segments],
        });
        expect(sanitized.reviewable).toBe(true);
        expect(sanitized.html).not.toMatch(/<script|<form|\son[a-z]+=/iu);
        for (const segment of left.segments)
          expect(sanitized.html).toContain(
            `data-dstar-segment="${segment.id}"`,
          );
      }
    }
  });

  it("tracks Unicode code-point offsets and canonical mark order", () => {
    const document: DstarDocument = {
      id: "node_root",
      type: "document",
      children: [
        {
          id: "node_unicode",
          type: "paragraph",
          content: [
            { type: "text", text: "A😀" },
            {
              type: "text",
              text: "B",
              marks: [
                { type: "strong" },
                { type: "link", attrs: { href: "https://example.com" } },
              ],
            },
          ],
        },
      ],
    };
    const result = renderCanonicalHtml(memorySnapshot(document));
    expect(result.textRuns.map(({ start, end }) => [start, end])).toEqual([
      [0, 2],
      [2, 3],
    ]);
    expect(result.html).toContain(
      '<a href="https://example.com/" rel="noopener noreferrer" target="_blank"><strong>B</strong></a>',
    );
  });

  it("escapes active content, removes unsafe link behavior, and visibly preserves unsupported nodes", () => {
    const document: DstarDocument = {
      id: "node_root",
      type: "document",
      children: [
        {
          id: "node_attack",
          type: "paragraph",
          content: [
            {
              type: "text",
              text: '<script>alert("x")</script>',
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
        {
          id: "node_unknown",
          type: "example:widget",
          attrs: { html: '<img src=x onerror="alert(1)">' },
        },
      ],
    };
    const snapshot = memorySnapshot(document);
    const result = renderCanonicalHtml(snapshot);
    expect(result.html).not.toContain("<script>alert");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("<img src=x");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("Unsupported content: example:widget");
    expect(result.html).toContain("node_unknown");
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "PROFILE_UNSUPPORTED",
      ),
    ).toBe(true);
    const projection = renderProjection(snapshot, "html");
    expect(() => verifyRenderedProjection(snapshot, projection)).not.toThrow();
  });

  it("never renders SVG/HTML as active inline assets and serves them only as attachments", () => {
    const svg = new TextEncoder().encode(
      '<svg onload="alert(1)"><script/></svg>',
    );
    const html = new TextEncoder().encode(
      "<!doctype html><script>alert(1)</script>",
    );
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const document: DstarDocument = {
      id: "node_root",
      type: "document",
      children: [
        {
          id: "node_image",
          type: "image",
          attrs: { src: "assets/attack.svg", alt: "Architecture" },
        },
      ],
    };
    const snapshot = memorySnapshot(
      document,
      new Map([
        ["assets/attack.svg", svg],
        ["assets/attack.html", html],
        ["assets/safe.png", png],
      ]),
    );
    const rendered = renderProjection(snapshot, "html");
    const output = new TextDecoder().decode(rendered.bytes);
    expect(output).toContain("Image unavailable");
    expect(output).not.toContain("<svg");
    expect(
      safeAssetResponse(snapshot, "assets/attack.svg").headers[
        "Content-Disposition"
      ],
    ).toBe("attachment");
    expect(
      safeAssetResponse(snapshot, "assets/attack.html").headers[
        "Content-Disposition"
      ],
    ).toBe("attachment");
    expect(safeAssetResponse(snapshot, "assets/safe.png")).toMatchObject({
      status: 200,
      headers: { "Content-Disposition": "inline", "Content-Type": "image/png" },
    });
    expect(safeAssetResponse(snapshot, "../secret").status).toBe(404);
  });

  it("sanitizes untrusted stored HTML and disables review when mappings do not survive", () => {
    const projection = {
      id: "projection_attack",
      role: "reading",
      mediaType: "text/html",
      path: "projections/attack.html",
      reviewable: true,
      generatedFromRevision:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      revision:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      segments: [
        {
          id: "segment_attack",
          selectors: [
            { type: "FragmentSelector", value: "segment_attack" },
            { type: "TextQuoteSelector", exact: "Safe words" },
          ],
          derivedFrom: [
            {
              relation: "exact",
              selector: { type: "NodeSelector", node: "node_attack" },
            },
          ],
        },
      ],
    } as const;
    const result = sanitizeStoredProjectionHtml(
      new TextEncoder().encode(
        '<p onclick="alert(1)">Safe words</p><script>steal()</script><form action="https://evil.example"><input></form>',
      ),
      projection,
    );
    expect(result.html).not.toMatch(/script|onclick|form|input/iu);
    expect(result.reviewable).toBe(false);
    expect(result.diagnostics).not.toHaveLength(0);
  });
});
