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
// THE DEADLINE COVERS THE BODY, NOT ONLY THE HANDSHAKE. `AbortSignal.timeout`
// passed to `fetch` alone stops governing the moment the response headers
// arrive: `Bun.write(destination, response)` then streams the body with no
// bound at all. Measured 2026-09-06: a cache run against snapshot.debian.org
// sat for EIGHT HOURS with an empty `.download.*` directory and not one byte
// written -- the retry loop never ran, because the first attempt never
// finished failing. One controller, aborted on a timer, covers both halves.
const DEADLINE_MS = 180_000;
for (let attempt = 1; ; attempt++) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) process.exit(ABSENT);
    if (!response.ok || !response.url.startsWith("https://")) {
      throw new Error(`download failed: ${response.status} ${url}`);
    }
    await Bun.write(destination, response);
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    await Bun.sleep(1_000 * attempt);
  } finally {
    clearTimeout(deadline);
  }
}
