import { z } from "zod";
import sharp from "sharp";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { configSchema, confined } from "./config.js";
import { runProof, outputRoot, readRun, persist } from "./runner.js";
export const remoteInput = z
  .object({
    baselineBase64: z
      .string()
      .min(4)
      .max(8 * 1024 * 1024),
    config: z
      .object({
        url: z.string().url(),
        viewport: z.object({
          width: z.number().int(),
          height: z.number().int(),
        }),
        readySelector: z.string().optional(),
      })
      .strict(),
    context: z
      .object({
        taskId: z.string().max(100),
        prototypeId: z.string().max(100),
        tree: z.string().regex(/^[a-f0-9]{40,64}$/),
      })
      .strict(),
  })
  .strict();
export async function verifyImage(
  root: string,
  input: z.infer<typeof remoteInput>,
) {
  input = remoteInput.parse(input);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.baselineBase64))
    throw new Error("Invalid base64 reference");
  const bytes = Buffer.from(input.baselineBase64, "base64");
  const png = await sharp(bytes, { limitInputPixels: 2560 * 2560 })
    .flatten({ background: "#fff" })
    .png()
    .toBuffer();
  const imports = path.join(await outputRoot(root), "inputs");
  await mkdir(imports, { recursive: true });
  await confined(root, imports);
  const dir = path.join(imports, randomUUID());
  await mkdir(dir);
  const baseline = path.join(dir, "baseline.png");
  await writeFile(baseline, png);
  const config = configSchema.parse({
    ...input.config,
    states: [{ name: "default", baseline }],
  });
  const run = await runProof(root, config);
  run.clientContext = input.context;
  await persist(path.join(await outputRoot(root), run.id), run);
  // Context is provenance only, never an instruction or file path.
  await writeFile(
    path.join(await outputRoot(root), run.id, "client-context.json"),
    JSON.stringify(input.context, null, 2),
  );
  return run;
}
export async function portableReport(root: string, id: string) {
  const { dir } = await readRun(root, id);
  let html = await readFile(await confined(dir, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
  for (const ref of new Set(refs)) {
    if (!/^[\w/-]+\.(png|json)$/.test(ref))
      throw new Error("Unexpected report asset");
    const data = await readFile(await confined(dir, ref));
    const mime = ref.endsWith(".png") ? "image/png" : "application/json";
    const uri = `data:${mime};base64,${data.toString("base64")}`;
    html = html.split(`="${ref}"`).join(`="${uri}"`);
    if (Buffer.byteLength(html) > 24 * 1024 * 1024)
      throw new Error("Portable report exceeds 24MB");
  }
  return html;
}
