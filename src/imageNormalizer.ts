import type * as Photon from "@silvia-odwyer/photon-node";

const MAX_IMAGE_WIDTH = 2_000;
const MAX_IMAGE_HEIGHT = 2_000;
const MAX_BASE64_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITIES = [80, 85, 70, 55, 40] as const;

type PhotonModule = typeof Photon;

let photonModulePromise: Promise<PhotonModule> | undefined;

function loadPhoton(): Promise<PhotonModule> {
  photonModulePromise ??= import("@silvia-odwyer/photon-node");
  return photonModulePromise;
}

function parseBase64DataUrl(url: string): { mime: string; base64: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/is.exec(url);
  if (!match) {
    return undefined;
  }

  return { mime: match[1], base64: match[2] };
}

function candidateSizes(width: number, height: number): Array<{ width: number; height: number }> {
  const scale = Math.min(1, MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height);
  return Array.from({ length: 32 }).reduce<Array<{ width: number; height: number }>>((sizes) => {
    const previous = sizes.at(-1) ?? {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
    const next = sizes.length === 0
      ? previous
      : {
          width: previous.width === 1 ? 1 : Math.max(1, Math.floor(previous.width * 0.75)),
          height: previous.height === 1 ? 1 : Math.max(1, Math.floor(previous.height * 0.75)),
        };

    return sizes.some((size) => size.width === next.width && size.height === next.height)
      ? sizes
      : [...sizes, next];
  }, []);
}

/**
 * Mirrors OpenCode's image normalization before an image reaches a provider:
 * resize oversized dimensions and try PNG/JPEG encodings until the base64
 * payload fits. Unsupported or malformed images are passed through unchanged.
 */
export async function normalizeImageDataUrl(url: string): Promise<string> {
  const parsed = parseBase64DataUrl(url);
  if (!parsed) {
    return url;
  }

  let photon: PhotonModule;
  try {
    photon = await loadPhoton();
  } catch {
    return url;
  }

  let decoded: Photon.PhotonImage;
  try {
    decoded = photon.PhotonImage.new_from_byteslice(Buffer.from(parsed.base64, "base64"));
  } catch {
    return url;
  }

  try {
    const width = decoded.get_width();
    const height = decoded.get_height();
    const base64Bytes = Buffer.byteLength(parsed.base64, "utf8");

    if (width <= MAX_IMAGE_WIDTH && height <= MAX_IMAGE_HEIGHT && base64Bytes <= MAX_BASE64_BYTES) {
      return url;
    }

    for (const size of candidateSizes(width, height)) {
      const resized = photon.resize(decoded, size.width, size.height, photon.SamplingFilter.Lanczos3);
      try {
        const candidates: Array<{ mime: string; bytes: Uint8Array }> = [
          { mime: "image/png", bytes: resized.get_bytes() },
          ...JPEG_QUALITIES.map((quality) => ({
            mime: "image/jpeg",
            bytes: resized.get_bytes_jpeg(quality),
          })),
        ];

        for (const candidate of candidates) {
          const base64 = Buffer.from(candidate.bytes).toString("base64");
          if (Buffer.byteLength(base64, "utf8") <= MAX_BASE64_BYTES) {
            return `data:${candidate.mime};base64,${base64}`;
          }
        }
      } finally {
        resized.free();
      }
    }
  } catch {
    return url;
  } finally {
    decoded.free();
  }

  return url;
}
