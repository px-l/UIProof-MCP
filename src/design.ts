import { z } from "zod";
export const designSchema = z.object({
  source: z.literal("figma"),
  fileKey: z.string(),
  nodeId: z.string(),
  version: z.string(),
  imageHash: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().positive(),
  height: z.number().positive(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        text: z.string().optional(),
        box: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number().positive(),
          height: z.number().positive(),
        }),
      }),
    )
    .max(10000),
});
export type Design = z.infer<typeof designSchema>;
