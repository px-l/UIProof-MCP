import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PNG } from "pngjs";
import { importFigma } from "../src/figma.js";
import { hash } from "../src/runner.js";
test("Figma import pins render version, normalizes node coordinates and keeps token off CDN", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uiproof-figma-"));
  const png = new PNG({ width: 100, height: 100 });
  png.data.fill(255);
  const bytes = PNG.sync.write(png);
  let calls = 0;
  const fake = async (url: unknown, init?: RequestInit) => {
    calls++;
    const u = new URL(String(url));
    if (u.hostname === "api.figma.com")
      assert.equal(
        (init?.headers as Record<string, string>)["X-Figma-Token"],
        "test-token",
      );
    if (u.pathname.includes("/nodes"))
      return Response.json({
        version: "locked-version",
        nodes: {
          "1:2": {
            document: {
              id: "1:2",
              name: "Frame",
              type: "FRAME",
              absoluteBoundingBox: { x: 100, y: 200, width: 100, height: 100 },
              children: [
                {
                  id: "1:3",
                  name: "Title",
                  type: "TEXT",
                  characters: "Hello",
                  absoluteBoundingBox: {
                    x: 110,
                    y: 220,
                    width: 50,
                    height: 20,
                  },
                },
                {
                  id: "1:4",
                  name: "Hidden",
                  type: "TEXT",
                  visible: false,
                  characters: "Hidden",
                  absoluteBoundingBox: {
                    x: 100,
                    y: 200,
                    width: 10,
                    height: 10,
                  },
                },
              ],
            },
          },
        },
      });
    if (u.pathname.includes("/images/")) {
      assert.equal(u.searchParams.get("version"), "locked-version");
      return Response.json({
        images: { "1:2": "https://s3-alpha.figma.com/image.png" },
      });
    }
    assert.equal(init?.headers, undefined);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/png" },
    });
  };
  try {
    await assert.rejects(
      importFigma(
        root,
        { fileKey: "file", nodeId: "1:2" },
        "",
        fake as typeof fetch,
      ),
      /FIGMA_ACCESS_TOKEN/,
    );
    assert.equal(calls, 0);
    const r = await importFigma(
      root,
      { fileKey: "file", nodeId: "1-2" },
      "test-token",
      fake as typeof fetch,
    );
    assert.equal(r.version, "locked-version");
    const metadata = JSON.parse(
      await readFile(path.join(root, r.designMetadata), "utf8"),
    );
    assert.equal(metadata.nodes.length, 2);
    assert.deepEqual(metadata.nodes[1].box, {
      x: 10,
      y: 20,
      width: 50,
      height: 20,
    });
    assert.equal(metadata.imageHash, hash(bytes));
    assert.equal(calls, 3);
    const hostile = async (url: unknown, init?: RequestInit) =>
      String(url).includes("/images/")
        ? Response.json({ images: { "1:2": "http://127.0.0.1/secrets" } })
        : fake(url, init);
    await assert.rejects(
      importFigma(
        root,
        { fileKey: "file", nodeId: "1:2" },
        "test-token",
        hostile as typeof fetch,
      ),
      /Unexpected/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
