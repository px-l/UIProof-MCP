import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtemp,
  writeFile,
  rm,
  symlink,
  mkdir,
  readFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { configSchema, loadConfig } from "../src/config.js";
import { runProof } from "../src/runner.js";
import { capture } from "../src/capture.js";
test("capture failures are errors, moving content cannot silently pass, masked timers stabilize", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/error") {
      res.statusCode = 500;
      res.end("error");
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<style>body{margin:0}#clock{width:100px;height:100px;background:blue}</style><div id="clock"></div><script>let n=0;setInterval(()=>document.querySelector("#clock").style.background="rgb("+(n++%255)+",40,90)",70)</script>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  if (!a || typeof a === "string") throw Error();
  const root = await mkdtemp(path.join(os.tmpdir(), "uiproof-errors-"));
  const png = new PNG({ width: 200, height: 200 });
  png.data.fill(255);
  await writeFile(path.join(root, "baseline.png"), PNG.sync.write(png));
  const config = configSchema.parse({
    url: `http://127.0.0.1:${a.port}/error`,
    viewport: { width: 200, height: 200 },
    timeoutMs: 1000,
    states: [{ name: "main", baseline: "baseline.png" }],
  });
  try {
    const bad = await runProof(root, config);
    assert.equal(bad.status, "error");
    assert.match(bad.states[0].error!, /500/);
    config.url = `http://127.0.0.1:${a.port}`;
    await assert.rejects(
      capture(config, config.states[0]),
      /stabilize|Timeout/,
    );
    config.alignment.x = 10;
    config.masks = [{ x: 10, y: 0, width: 100, height: 100 }];
    const stable = await capture(config, config.states[0]);
    assert.ok(stable.metadata.attempts >= 3);
    await writeFile(
      path.join(root, "uiproof.json"),
      JSON.stringify({
        ...config,
        states: [{ name: "main", baseline: "escape.txt" }],
      }),
    );
    await symlink("/etc/hosts", path.join(root, "escape.txt"));
    await assert.rejects(loadConfig(root, "uiproof.json"), /outside/);
    const html = await readFile(
      path.join(root, ".uiproof", bad.id, "index.html"),
      "utf8",
    );
    assert.ok(html.includes("HTTP 500"));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
