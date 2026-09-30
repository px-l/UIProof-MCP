import { PNG } from "pngjs";
import type { Issue } from "./runner.js";
export function trackRegions(before: Issue[], after: Issue[], diff: Buffer) {
  const image = PNG.sync.read(diff);
  const previous = before.map((issue) => {
    let remainingPixels = 0;
    const b = issue.box;
    for (let y = b.y; y < Math.min(image.height, b.y + b.height); y++)
      for (let x = b.x; x < Math.min(image.width, b.x + b.width); x++)
        if (image.data[(y * image.width + x) * 4 + 3]) remainingPixels++;
    return {
      issueId: issue.id,
      box: b,
      status: remainingPixels ? "remaining" : "resolved",
      remainingPixels,
    };
  });
  return {
    matching: "spatial evidence, not semantic identity",
    previous,
    newRegions: after
      .filter(
        (a) =>
          !before.some(
            (b) =>
              a.box.x < b.box.x + b.box.width &&
              a.box.x + a.box.width > b.box.x &&
              a.box.y < b.box.y + b.box.height &&
              a.box.y + a.box.height > b.box.y,
          ),
      )
      .map((i) => ({ issueId: i.id, box: i.box })),
  };
}
