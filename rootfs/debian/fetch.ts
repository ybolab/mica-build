// Only cache population downloads. Installation consumes verified local files.
const [url, destination] = Bun.argv.slice(2);
if (!url || !destination || !url.startsWith("https://")) {
  throw new Error("usage: fetch.ts <https-url> <destination>");
}
// Exit 44 means "that host does not have this file", and it is kept apart from
// failure because run.sh's mirror fallback turns on exactly that distinction: a
// mirror carrying the CURRENT pool answers 404 for every pin a newer upload has
// superseded, which is normal rather than wrong. Absence is also not transient,
// so it must not be retried -- 172 pins against a live pool would otherwise
// spend three attempts and six seconds each re-proving the same thing.
const ABSENT = 44;
for (let attempt = 1; ; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (response.status === 404) process.exit(ABSENT);
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
