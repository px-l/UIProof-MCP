import {
  mkdir,
  readFile,
  writeFile,
  realpath,
  rename,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { configSchema, confined, type Config, type Rect } from "./config.js";
import { capture, type ElementEvidence } from "./capture.js";
import { compare } from "./compare.js";
import { designSchema, type Design } from "./design.js";
import { trackRegions } from "./tracking.js";
import { report } from "./report.js";
export interface Issue {
  id: string;
  title: string;
  severity: "warning" | "error";
  box: Rect;
  elements: ElementEvidence[];
  designNodes?: Design["nodes"];
}
export interface StateResult {
  name: string;
  status: "passed" | "failed" | "error";
  baselineHash?: string;
  designHash?: string;
  design?: Design;
  ratio?: number;
  diffPixels?: number;
  ignoredPixels?: number;
  issues: Issue[];
  error?: string;
  capture?: Awaited<ReturnType<typeof capture>>["metadata"];
}
export interface Run {
  version: 1;
  id: string;
  status: "passed" | "failed" | "error";
  startedAt: string;
  sourceRevision?: string;
  config: Config;
  states: StateResult[];
  analysis?: unknown;
  recheck?: unknown;
}
export const hash = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export async function outputRoot(root: string) {
  const base = await realpath(root),
    out = path.join(base, ".uiproof");
  await mkdir(out, { recursive: true });
  if ((await realpath(out)) !== out)
    throw new Error("Output directory must not be a symlink");
  return out;
}
export async function readRun(
  root: string,
  id: string,
): Promise<{ run: Run; dir: string }> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid run ID");
  const dir = await confined(await outputRoot(root), id);
  const run = JSON.parse(
    await readFile(await confined(dir, "run.json"), "utf8"),
  ) as Run;
  if (run.id !== id || run.version !== 1)
    throw new Error("Invalid run manifest");
  return { run, dir };
}
export async function persist(dir: string, run: Run) {
  for (const [file, data] of [
    ["index.html", report(run)],
    ["run.json", JSON.stringify(run, null, 2)],
  ]) {
    const tmp = path.join(dir, `${file}.${randomUUID()}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, path.join(dir, file));
  }
}
export async function runProof(root: string, input: Config): Promise<Run> {
  root = await realpath(root);
  const config = configSchema.parse(input),
    id = randomUUID(),
    dir = path.join(await outputRoot(root), id);
  await mkdir(dir);
  const run: Run = {
    version: 1,
    id,
    status: "error",
    startedAt: new Date().toISOString(),
    sourceRevision: process.env.UIPROOF_REVISION ?? process.env.GITHUB_SHA,
    config,
    states: [],
  };
  for (const state of config.states) {
    const out = path.join(dir, state.name);
    await mkdir(out);
    const result: StateResult = {
      name: state.name,
      status: "error",
      issues: [],
    };
    run.states.push(result);
    try {
      const baseline = await readFile(await confined(root, state.baseline));
      result.baselineHash = hash(baseline);
      if (state.designMetadata) {
        const bytes = await readFile(
          await confined(root, state.designMetadata),
        );
        result.design = designSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (result.design.imageHash !== result.baselineHash)
          throw new Error("Design metadata does not match baseline image");
        result.designHash = hash(bytes);
        await writeFile(path.join(out, "design.source.json"), bytes);
      }
      await writeFile(path.join(out, "baseline.source"), baseline);
      const captured = await capture(config, state);
      result.capture = captured.metadata;
      await writeFile(path.join(out, "raw.png"), captured.screenshot);
      const diff = await compare(baseline, captured.screenshot, config);
      result.ratio = diff.ratio;
      result.diffPixels = diff.diffPixels;
      result.ignoredPixels = diff.ignoredPixels;
      result.status = diff.passed ? "passed" : "failed";
      for (const [file, data] of Object.entries({
        expected: diff.expected,
        actual: diff.actual,
        diff: diff.diff,
      }))
        await writeFile(path.join(out, file + ".png"), data);
      // Limit detailed crops, but retain all changed pixels and explicitly group the overflow region.
      const boxes = diff.boxes.slice(0, 99);
      if (diff.boxes.length > 99) {
        const rest = diff.boxes.slice(99),
          x = Math.min(...rest.map((b) => b.x)),
          y = Math.min(...rest.map((b) => b.y));
        boxes.push({
          x,
          y,
          width: Math.max(...rest.map((b) => b.x + b.width)) - x,
          height: Math.max(...rest.map((b) => b.y + b.height)) - y,
        });
      }
      for (const [index, box] of boxes.entries()) {
        const issue: Issue = {
          id: `issue-${String(index + 1).padStart(3, "0")}`,
          title:
            index === 99
              ? "Remaining difference regions (grouped)"
              : "Visual difference",
          severity: diff.passed ? "warning" : "error",
          box,
          elements: captured.elements
            .map((e) => ({
              ...e,
              box: {
                ...e.box,
                x: e.box.x + config.alignment.x,
                y: e.box.y + config.alignment.y,
              },
            }))
            .filter(
              (e) =>
                e.box.x < box.x + box.width &&
                e.box.x + e.box.width > box.x &&
                e.box.y < box.y + box.height &&
                e.box.y + e.box.height > box.y,
            )
            .sort(
              (a, b) => a.box.width * a.box.height - b.box.width * b.box.height,
            )
            .slice(0, 8),
        };
        if (result.design)
          issue.designNodes = result.design.nodes
            .filter(
              (n) =>
                n.box.x < box.x + box.width &&
                n.box.x + n.box.width > box.x &&
                n.box.y < box.y + box.height &&
                n.box.y + n.box.height > box.y,
            )
            .sort(
              (a, b) => a.box.width * a.box.height - b.box.width * b.box.height,
            )
            .slice(0, 12);
        result.issues.push(issue);
        for (const [kind, data] of Object.entries({
          expected: diff.expected,
          actual: diff.actual,
          diff: diff.diff,
        }))
          await sharp(data)
            .extract({
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
            })
            .png()
            .toFile(path.join(out, `${issue.id}-${kind}.png`));
      }
      const overlay = Buffer.from(
        `<svg width="${config.viewport.width}" height="${config.viewport.height}">${boxes.map((b, i) => `<rect x="${b.x + 1}" y="${b.y + 1}" width="${Math.max(1, b.width - 2)}" height="${Math.max(1, b.height - 2)}" fill="#ef444422" stroke="#ef4444" stroke-width="2"/><text x="${b.x + 4}" y="${b.y + 14}" fill="#a00" font-size="12">${i + 1}</text>`).join("")}</svg>`,
      );
      await sharp(diff.actual)
        .composite([{ input: overlay }])
        .png()
        .toFile(path.join(out, "annotated.png"));
    } catch (error) {
      result.status = "error";
      result.error = error instanceof Error ? error.message : String(error);
    }
  }
  run.status = run.states.some((s) => s.status === "error")
    ? "error"
    : run.states.some((s) => s.status === "failed")
      ? "failed"
      : "passed";
  await persist(dir, run);
  return run;
}
export async function recheck(root: string, id: string) {
  root = await realpath(root);
  const { run: previous, dir } = await readRun(root, id);
  if (previous.states.some((s) => !s.baselineHash))
    throw new Error("Previous run has no complete baseline snapshots");
  const config = structuredClone(previous.config);
  for (const state of config.states) {
    const file = await confined(dir, `${state.name}/baseline.source`),
      baseline = await readFile(file);
    if (
      hash(baseline) !==
      previous.states.find((s) => s.name === state.name)?.baselineHash
    )
      throw new Error("Baseline snapshot was modified");
    state.baseline = path.relative(root, file);
    if (state.designMetadata) {
      const meta = await confined(dir, `${state.name}/design.source.json`);
      if (
        hash(await readFile(meta)) !==
        previous.states.find((s) => s.name === state.name)?.designHash
      )
        throw new Error("Design metadata snapshot was modified");
      state.designMetadata = path.relative(root, meta);
    }
  }
  const run = await runProof(root, config);
  run.recheck = {
    previousRunId: id,
    previousRevision: previous.sourceRevision,
    currentRevision: run.sourceRevision,
    states: await Promise.all(
      run.states.map(async (s) => {
        const before = previous.states.find((p) => p.name === s.name)!;
        return {
          name: s.name,
          before: before.status,
          after: s.status,
          tracking:
            s.status === "error"
              ? null
              : trackRegions(
                  before.issues,
                  s.issues,
                  await readFile(
                    path.join(
                      await outputRoot(root),
                      run.id,
                      s.name,
                      "diff.png",
                    ),
                  ),
                ),
          ratioBefore: before.ratio,
          ratioAfter: s.ratio,
          improved:
            s.ratio !== undefined && before.ratio !== undefined
              ? s.ratio < before.ratio
              : null,
          environmentChanged:
            JSON.stringify({
              ...before.capture,
              capturedAt: undefined,
              attempts: undefined,
            }) !==
            JSON.stringify({
              ...s.capture,
              capturedAt: undefined,
              attempts: undefined,
            }),
        };
      }),
    ),
  };
  await persist(path.join(await outputRoot(root), run.id), run);
  return run;
}

export async function listRuns(root: string, limit = 20) {
  const entries = await readdir(await outputRoot(root), {
    withFileTypes: true,
  });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
    try {
      const { run } = await readRun(root, entry.name);
      runs.push({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        sourceRevision: run.sourceRevision,
      });
    } catch {
      /* Interrupted runs have no complete manifest. */
    }
  }
  return runs
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}
