import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixture } from "../examples/fixture.js";
import { configSchema } from "../src/config.js";
import { capture } from "../src/capture.js";
import { verifyImage, portableReport } from "../src/remote.js";
test("remote reference accepts image input, persists provenance and embeds all report assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uiproof-remote-")),
    app = await fixture();
  try {
    const config = configSchema.parse({
      url: app.url,
      viewport: { width: 1000, height: 700 },
      states: [{ name: "default", baseline: "unused" }],
    });
    const image = (await capture(config, config.states[0])).screenshot;
    app.setBroken(true);
    const context = {
      taskId: "task-a",
      prototypeId: "prototype-a",
      tree: "a".repeat(40),
    };
    const result = await verifyImage(root, {
      baselineBase64: image.toString("base64"),
      config: { url: app.url, viewport: config.viewport },
      context,
    });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.clientContext, context);
    const html = await portableReport(root, result.id);
    assert.ok(html.includes("data:image/png;base64,"));
    assert.ok(!html.includes('src="default/'));
    assert.ok(!html.includes('href="run.json"'));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
