import { z } from "zod";
import { mkdir, writeFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { hash, outputRoot } from "./runner.js";
import { designSchema, type Design } from "./design.js";
import { remoteJson, boundedBody } from "./network.js";
interface Node {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  children?: Node[];
}
export const figmaInput = z
  .object({
    fileKey: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    nodeId: z.string().regex(/^\d+[:-]\d+$/),
    version: z.string().min(1).optional(),
  })
  .strict();
export async function importFigma(
  root: string,
  input: z.infer<typeof figmaInput>,
  token = process.env.FIGMA_ACCESS_TOKEN,
  fetcher: typeof fetch = fetch,
) {
  input = figmaInput.parse(input);
  root = await realpath(root);
  if (!token)
    throw new Error("Set FIGMA_ACCESS_TOKEN with file_content:read access");
  const nodeId = input.nodeId.replace("-", ":"),
    query = new URLSearchParams({ ids: nodeId });
  if (input.version) query.set("version", input.version);
  const headers = { "X-Figma-Token": token };
  const data = z
    .object({
      version: z.string().min(1),
      nodes: z.record(z.string(), z.unknown()),
    })
    .parse(
      await remoteJson(
        `https://api.figma.com/v1/files/${input.fileKey}/nodes?${query}`,
        { headers },
        fetcher,
      ),
    );
  const node = z
    .object({
      document: z
        .object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          absoluteBoundingBox: z.object({
            x: z.number(),
            y: z.number(),
            width: z.number().min(100).max(2560),
            height: z.number().min(100).max(2560),
          }),
        })
        .passthrough(),
    })
    .parse(data.nodes[nodeId]).document as Node;
  // Pin rendering to the exact version of the fetched node tree, avoiding design edits between API calls.
  const renderQuery = new URLSearchParams({
    ids: nodeId,
    format: "png",
    scale: "1",
    use_absolute_bounds: "true",
    version: data.version,
  });
  const renders = z
    .object({ images: z.record(z.string(), z.string().nullable()) })
    .parse(
      await remoteJson(
        `https://api.figma.com/v1/images/${input.fileKey}?${renderQuery}`,
        { headers },
        fetcher,
      ),
    );
  const imageURL = renders.images[nodeId];
  if (!imageURL) throw new Error("Figma did not render this node");
  const download = new URL(imageURL);
  if (
    download.protocol !== "https:" ||
    download.username ||
    download.password ||
    !(
      download.hostname === "figma.com" ||
      download.hostname.endsWith(".figma.com") ||
      download.hostname.endsWith(".amazonaws.com")
    )
  )
    throw new Error("Unexpected Figma image download origin");
  // Never send the Figma token to the image CDN; never follow redirects with secrets.
  const bytes = await boundedBody(
    await fetcher(download.href, {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    }),
    20 * 1024 * 1024,
  );
  const image = await sharp(bytes, {
    limitInputPixels: 2560 * 2560,
  }).metadata();
  const frame = node.absoluteBoundingBox!;
  if (
    image.format !== "png" ||
    !image.width ||
    !image.height ||
    Math.abs(image.width - frame.width) > 1 ||
    Math.abs(image.height - frame.height) > 1
  )
    throw new Error("Figma image dimensions do not match the frame");
  const nodes: Design["nodes"] = [];
  function walk(n: Node) {
    if (n.visible === false) return;
    const b = n.absoluteBoundingBox;
    if (b && b.width > 0 && b.height > 0) {
      nodes.push({
        id: n.id,
        name: n.name,
        type: n.type,
        ...(n.characters ? { text: n.characters } : {}),
        box: {
          x: b.x - frame.x,
          y: b.y - frame.y,
          width: b.width,
          height: b.height,
        },
      });
      if (nodes.length > 10000) throw new Error("Figma node limit exceeded");
    }
    for (const child of n.children ?? []) walk(child);
  }
  walk(node);
  const design = designSchema.parse({
    source: "figma",
    fileKey: input.fileKey,
    nodeId,
    version: data.version,
    imageHash: hash(bytes),
    width: image.width,
    height: image.height,
    nodes,
  });
  const parent = path.join(await outputRoot(root), "designs");
  await mkdir(parent, { recursive: true });
  if ((await realpath(parent)) !== parent)
    throw new Error("Design directory must not be a symlink");
  const dir = path.join(parent, randomUUID());
  await mkdir(dir);
  await writeFile(path.join(dir, "baseline.png"), bytes);
  await writeFile(
    path.join(dir, "design.json"),
    JSON.stringify(design, null, 2),
  );
  return {
    baseline: path.relative(root, path.join(dir, "baseline.png")),
    designMetadata: path.relative(root, path.join(dir, "design.json")),
    viewport: { width: image.width, height: image.height },
    version: design.version,
    nodeCount: nodes.length,
  };
}
