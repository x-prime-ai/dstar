import { mkdtempSync } from "node:fs";
import { request as requestHttp } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { startExampleLibrary } from "./server.mjs";

let service;
afterEach(async () => {
  await service?.close();
  service = undefined;
});

function gateway(path, headers) {
  return new Promise((resolve, reject) => {
    const request = requestHttp(
      {
        host: "127.0.0.1",
        port: service.server.address().port,
        path,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

it("serves the library and opens every sample through an isolated Viewer", async () => {
  service = await startExampleLibrary({
    port: 0,
    runtimeRoot: mkdtempSync(join(tmpdir(), "dstar-example-library-test-")),
    examplesRoot: resolve(import.meta.dirname, "../../../examples"),
  });

  const response = await fetch(`${service.origin}/examples/api/documents`);
  expect(response.status).toBe(200);
  const documents = await response.json();
  expect(documents).toHaveLength(4);
  expect(documents.map((document) => document.id)).toEqual([
    "dstar-doc",
    "dstar-rich",
    "dstar-slides",
    "dstar-ui-design",
  ]);
  for (const document of documents) {
    const url = new URL(document.viewerUrl);
    expect(url.hash).toHaveLength(65);
    expect(url.port).toBe(new URL(service.origin).port);
    expect(url.hostname).toBe("localhost");
    expect(url.pathname).toBe(`/documents/${document.id}/`);
    const token = url.hash.slice(1);
    url.hash = "";
    const viewer = await gateway(url.pathname, { Host: url.host });
    expect(viewer.status).toBe(200);
    expect(viewer.body).toContain('id="selection-comment"');
    expect(viewer.body).toContain(
      `name="dstar-base-path" content="/documents/${document.id}"`,
    );
    const state = await gateway(`${url.pathname}api/state`, {
      Authorization: `Bearer ${token}`,
      Host: url.host,
      Origin: url.origin,
    });
    expect(state.status).toBe(200);
    expect(JSON.parse(state.body).session.role).toBe("owner");
  }

  const library = await (await fetch(service.url)).text();
  expect(library).toContain("Documents");
  expect(library).toContain('data-sample-id="dstar-doc"');
  expect(library).toContain('src="index.js?v=viewer-links"');
  expect(
    await (await fetch(`${service.origin}/examples/index.js`)).text(),
  ).toContain('fetch("api/documents"');
  expect((await fetch(`${service.origin}/../package.json`)).status).toBe(404);
  expect(
    (await fetch(`${service.origin}/documents/not-a-document/`)).status,
  ).toBe(404);
  expect((await fetch(`${service.origin}/documents/dstar-doc`)).url).toBe(
    `${service.origin}/documents/dstar-doc/`,
  );
  expect(
    (
      await gateway("/", {
        Host: `unknown.localhost:${new URL(service.origin).port}`,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await gateway(new URL(documents[0].viewerUrl).pathname, {
        Forwarded: "host=evil.example;proto=https",
        Host: new URL(documents[0].viewerUrl).host,
      })
    ).status,
  ).toBe(400);
});

it("mounts the complete site under a public base path through a trusted proxy", async () => {
  const token = "t".repeat(64),
    publicOrigin = "https://thinkofu.example";
  service = await startExampleLibrary({
    port: 0,
    runtimeRoot: mkdtempSync(join(tmpdir(), "dstar-example-library-proxy-")),
    examplesRoot: resolve(import.meta.dirname, "../../../examples"),
    externalOrigin: publicOrigin,
    basePath: "/dstar",
    trustedProxyToken: token,
  });
  expect(service.url).toBe(`${publicOrigin}/dstar/`);
  expect(
    (
      await gateway("/dstar/", {
        Host: "private-upstream.example",
      })
    ).status,
  ).toBe(403);
  const proxyHeaders = {
    Host: "private-upstream.example",
    "X-DSTAR-Proxy-Token": token,
    Forwarded: "host=thinkofu.example;proto=https",
    "X-Forwarded-Host": "thinkofu.example",
  };
  expect((await gateway("/dstar/", proxyHeaders)).status).toBe(200);
  const documentsResponse = await gateway("/dstar/api/documents", proxyHeaders);
  expect(documentsResponse.status).toBe(200);
  const [document] = JSON.parse(documentsResponse.body),
    viewerUrl = new URL(document.viewerUrl),
    ownerToken = viewerUrl.hash.slice(1);
  expect(viewerUrl.origin).toBe(publicOrigin);
  expect(viewerUrl.pathname).toBe("/dstar/documents/dstar-doc/");
  const page = await gateway(viewerUrl.pathname, proxyHeaders);
  expect(page.status).toBe(200);
  expect(page.body).toContain(
    'name="dstar-base-path" content="/dstar/documents/dstar-doc"',
  );
  const state = await gateway(`${viewerUrl.pathname}api/state`, {
    ...proxyHeaders,
    Authorization: `Bearer ${ownerToken}`,
    Origin: publicOrigin,
  });
  expect(state.status).toBe(200);
  expect(JSON.parse(state.body).session.role).toBe("owner");
});
