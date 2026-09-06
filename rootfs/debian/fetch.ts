// Only cache population downloads. Installation consumes verified local files.
const [url, destination] = Bun.argv.slice(2);
if (!url || !destination || !url.startsWith("https://")) {
  throw new Error("usage: fetch.ts <https-url> <destination>");
}
for (let attempt = 1; ; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.url.startsWith("https://")) {
      throw new Error(`download failed: ${response.status} ${url}`);
    }
    await Bun.write(destination, response);
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    await Bun.sleep(1_000 * attempt);
  }
}
