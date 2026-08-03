import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PhotonImage } from "@silvia-odwyer/photon-node";
import { normalizeImageDataUrl } from "../imageNormalizer.js";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("normalizeImageDataUrl", () => {
  it("keeps a small image unchanged", async () => {
    const url = `data:image/png;base64,${ONE_PIXEL_PNG}`;
    assert.equal(await normalizeImageDataUrl(url), url);
  });

  it("resizes an image that exceeds the CLI dimension limit", async () => {
    const image = new PhotonImage(new Uint8Array(2_001 * 4).fill(255), 2_001, 1);
    try {
      const url = `data:image/png;base64,${Buffer.from(image.get_bytes()).toString("base64")}`;
      const normalized = await normalizeImageDataUrl(url);

      assert.notEqual(normalized, url);
      assert.match(normalized, /^data:image\/(png|jpeg);base64,/);
    } finally {
      image.free();
    }
  });

  it("passes non-data URLs through unchanged", async () => {
    const url = "https://example.com/image.png";
    assert.equal(await normalizeImageDataUrl(url), url);
  });

  it("passes malformed image data through unchanged", async () => {
    const url = "data:image/png;base64,not-an-image";
    assert.equal(await normalizeImageDataUrl(url), url);
  });
});
