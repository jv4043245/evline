import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

for (const relativePage of ["index.html", "ru/index.html"]) {
  test(`${relativePage} uses optimized thumbnails and full-size gallery images`, async () => {
    const source = await readFile(path.join(root, relativePage), "utf8");
    const images = Array.from(source.matchAll(/<img class="gal"\s+src="([^"]+)"\s+data-full="([^"]+)"/g));

    assert.equal(images.length, 17);
    assert.match(source, /g\.dataset\.full\|\|g\.currentSrc\|\|g\.src/);

    for (const [, thumbnail, full] of images) {
      assert.match(thumbnail, /assets\/thumbs\/gallery-\d+\.webp$/);
      assert.match(full, /assets\/gallery-\d+\.jpg$/);
      await access(path.resolve(path.dirname(path.join(root, relativePage)), thumbnail));
      await access(path.resolve(path.dirname(path.join(root, relativePage)), full));
    }
  });
}
