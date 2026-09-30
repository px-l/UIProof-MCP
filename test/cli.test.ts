import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixture } from "../examples/fixture.js";
import { capture } from "../src/capture.js";
import { configSchema } from "../src/config.js";
test("CLI returns 0 for pass, 1 for differences and 2 for invalid configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uiproof-cli-")),
    app = await fixture();
  const invoke = (config: string) =>
    new Promise<{ code: number; stdout: string }>((resolve, reject) =>
      execFile(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "run",
          "--root",
          root,
          "--config",
          config,
        ],
        { timeout: 30000 },
        (error, stdout) => {
          if (error && typeof error.code !== "number") reject(error);
          else
            resolve({
              code: typeof error?.code === "number" ? error.code : 0,
              stdout,
            });
        },
      ),
    );
  try {
    const config = configSchema.parse({
      url: app.url,
      viewport: { width: 1000, height: 700 },
      states: [{ name: "main", baseline: "baseline.png" }],
    });
    await writeFile(
      path.join(root, "baseline.png"),
      (await capture(config, config.states[0])).screenshot,
    );
    await writeFile(path.join(root, "uiproof.json"), JSON.stringify(config));
    assert.equal((await invoke("uiproof.json")).code, 0);
    app.setBroken(true);
    const failure = await invoke("uiproof.json");
    assert.equal(failure.code, 1);
    assert.equal(JSON.parse(failure.stdout).status, "failed");
    assert.equal((await invoke("missing.json")).code, 2);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
