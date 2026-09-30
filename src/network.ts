export async function boundedBody(
  response: Response,
  limit: number,
): Promise<Buffer> {
  if (!response.ok)
    throw new Error(
      `Remote service returned HTTP ${response.status}${response.status === 429 ? " (rate limited; retry later)" : ""}`,
    );
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Remote response exceeds size limit");
  }
  if (!response.body) throw new Error("Empty remote response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) throw new Error("Remote response exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export async function remoteJson(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  return JSON.parse(
    (await boundedBody(response, 5 * 1024 * 1024)).toString("utf8"),
  );
}
