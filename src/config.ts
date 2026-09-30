import { z } from 'zod';
import { realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
const rect = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict();
const step = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), selector: z.string().min(1) }).strict(),
  z.object({ action: z.literal('fill'), selector: z.string().min(1), value: z.string() }).strict(),
  z.object({ action: z.literal('hover'), selector: z.string().min(1) }).strict(),
  z.object({ action: z.literal('waitFor'), selector: z.string().min(1) }).strict(),
]);
export const configSchema = z.object({
  url: z.string().url().refine(s => ['http:', 'https:'].includes(new URL(s).protocol), 'Only HTTP(S) pages'),
  viewport: z.object({ width: z.number().int().min(100).max(2560), height: z.number().int().min(100).max(2560) }).strict(),
  readySelector: z.string().optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  locale: z.string().default('en-US'), timezoneId: z.string().default('UTC'),
  colorScheme: z.enum(['light', 'dark']).default('light'),
  threshold: z.number().min(0).max(1).default(0.1),
  maxDiffRatio: z.number().min(0).max(1).default(0.001),
  includeAA: z.boolean().default(false),
  alignment: z.object({ x: z.number().int().min(-64).max(64), y: z.number().int().min(-64).max(64) }).strict().default({ x: 0, y: 0 }),
  masks: z.array(rect).max(100).default([]),
  states: z.array(z.object({ name: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/), baseline: z.string().min(1), steps: z.array(step).max(30).default([]) }).strict()).min(1).max(30),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.states.map(s => s.name)).size !== v.states.length) ctx.addIssue({ code: 'custom', message: 'State names must be unique' });
  for (const m of v.masks) if (m.x + m.width > v.viewport.width || m.y + m.height > v.viewport.height) ctx.addIssue({ code: 'custom', message: 'Mask exceeds viewport' });
  if (v.masks.length && v.masks.some(m => m.width === v.viewport.width && m.height === v.viewport.height)) ctx.addIssue({code:'custom',message:'Cannot mask entire viewport'});
});
export type Config = z.infer<typeof configSchema>;
export type Rect = z.infer<typeof rect>;
export async function confined(root: string, file: string): Promise<string> {
  const base = await realpath(root);
  const resolved = await realpath(path.resolve(base, file));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Path is outside UIProof workspace');
  return resolved;
}
export async function loadConfig(root: string, file: string): Promise<Config> {
  root = await realpath(root);
  const filename = await confined(root, file);
  const value = configSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  for (const s of value.states) s.baseline = path.relative(root, await confined(root, path.resolve(path.dirname(filename), s.baseline)));
  return value;
}
