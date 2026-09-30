import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { analyze } from "../src/analysis.js";
import { configSchema } from "../src/config.js";
import { persist, type Run } from "../src/runner.js";
const findings = {
  summary: "A card is missing",
  findings: [
    {
      category: "missing-content",
      explanation: "Expected card is absent",
      confidence: 0.9,
      box: { x: 10, y: 10, width: 20, height: 20 },
      suggestion: "Restore the card component",
    },
  ],
};
test("vision requires opt-in, validates findings and preserves deterministic status", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uiproof-vision-")),
    id = randomUUID(),
    dir = path.join(root, ".uiproof", id);
  await mkdir(path.join(dir, "main"), { recursive: true });
  const run: Run = {
    version: 1,
    id,
    startedAt: new Date().toISOString(),
    status: "failed",
    config: configSchema.parse({
      url: "http://localhost",
      viewport: { width: 100, height: 100 },
      states: [{ name: "main", baseline: "baseline.png" }],
    }),
    states: [{ name: "main", status: "failed", issues: [] }],
  };
  await persist(dir, run);
  for (const kind of ["expected", "actual"])
    await writeFile(path.join(dir, "main", kind + ".png"), "fixture");
  const options = {
    enabled: true,
    endpoint: "https://api.example.com/v1/chat/completions",
    model: "test-model",
    apiKey: "test-key",
  };
  let calls = 0;
  const fake = async (_url: unknown, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(
      body.messages[0].content.filter(
        (c: { type: string }) => c.type === "image_url",
      ).length,
      2,
    );
    return Response.json({
      choices: [{ message: { content: JSON.stringify(findings) } }],
    });
  };
  try {
    await assert.rejects(
      analyze(root, id, { ...options, enabled: false }, fake as typeof fetch),
      /disabled/,
    );
    assert.equal(calls, 0);
    const analysis = await analyze(root, id, options, fake as typeof fetch);
    assert.equal(analysis.needsHumanReview, true);
    assert.equal(
      JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")).status,
      "failed",
    );
    const bad = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ...findings,
                findings: [
                  {
                    ...findings.findings[0],
                    box: { x: 99, y: 0, width: 20, height: 20 },
                  },
                ],
              }),
            },
          },
        ],
      });
    await assert.rejects(
      analyze(root, id, options, bad as typeof fetch),
      /out-of-bounds/,
    );
    await assert.rejects(
      analyze(
        root,
        id,
        options,
        (async () => new Response("", { status: 429 })) as typeof fetch,
      ),
      /429/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
