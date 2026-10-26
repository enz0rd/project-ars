import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP, type LookupFunction } from "node:net";
import path from "node:path";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit, type Response as UndiciResponse } from "undici";
import { env } from "./env.ts";
import { UserError } from "./errors.ts";
import { db } from "./supabase.ts";

/**
 * Images live in the private Storage bucket "assets", under the owner's folder,
 * and nodes reference them as "asset:<user id>/<hash>.<ext>". Browsers upload
 * directly (storage policies restrict them to their own folder); this module is
 * for images that MCP clients ask the server to fetch.
 */
export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const TYPE_BY_EXT: Record<string, string> = { ...Object.fromEntries(Object.entries(IMAGE_TYPES).map(([t, e]) => [e, t])), jpeg: "image/jpeg" };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PUBLIC_HOST_ERROR = "That address is not allowed";
const lookupPublicAddress: LookupFunction = (hostname, options, done) => {
  resolvePublicAddress(hostname, options.family)
    .then((address) => done(null, address, isIP(address)))
    .catch((error) => done(error as Error, "", 0));
};
const publicNetworkAgent = new Agent({
  connect: {
    lookup: lookupPublicAddress,
  },
});

export async function storeAsset(userId: string, bytes: Buffer, type: string) {
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new UserError(`Unsupported image type: ${type || "unknown"}`);
  if (bytes.length > MAX_IMAGE_BYTES) throw new UserError("Image larger than 10 MB");
  if (ext === "svg") bytes = Buffer.from(withViewBox(bytes.toString("utf8")));
  const key = `${userId}/${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${ext}`;
  const { error } = await db().storage.from("assets").upload(key, bytes, { contentType: type, upsert: false });
  // Same content already uploaded: reuse it.
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(error.message);
  return { src: `asset:${key}`, ...imageSize(bytes, ext) };
}

/** Loads an image from base64 data, an https URL (SSRF-guarded) or, on local installs only, a file. */
export async function loadImage(source: { data?: string; mimeType?: string; url?: string; path?: string }) {
  if (source.data) {
    const type = source.mimeType ?? "";
    const bytes = Buffer.from(source.data.replace(/^data:[^,]*,/, ""), "base64");
    return { bytes, type: type || sniffType(bytes) };
  }
  if (source.url) return fetchImage(source.url);
  if (source.path) {
    if (!env.allowLocalFiles) throw new UserError("Reading server files is disabled. Send the image as base64 (data) or an https URL.");
    const type = TYPE_BY_EXT[path.extname(source.path).slice(1).toLowerCase()];
    if (!type) throw new UserError("The file must be .png, .jpg, .gif, .webp or .svg");
    return { bytes: await readFile(source.path), type };
  }
  throw new UserError("Give data, url or path");
}

/** Downloads a public https image, refusing private/internal addresses at every redirect. */
async function fetchImage(raw: string, redirects = 3): Promise<{ bytes: Buffer; type: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UserError("Invalid URL");
  }
  if (url.protocol !== "https:") throw new UserError("Only https URLs are allowed");
  const res = await fetchPublicUrl(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    if (!redirects) throw new UserError("Too many redirects");
    return fetchImage(new URL(res.headers.get("location")!, url).toString(), redirects - 1);
  }
  if (!res.ok || !res.body) throw new UserError(`Download failed: HTTP ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!IMAGE_TYPES[type]) throw new UserError(`Not a supported image: ${type || "unknown type"}`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new UserError("Image larger than 10 MB");
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks), type };
}

export async function assertPublicHost(hostname: string) {
  const addresses = await publicAddresses(hostname);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new UserError("That address is not allowed");
}

export async function fetchPublicUrl(url: URL, init: UndiciRequestInit = {}): Promise<UndiciResponse> {
  await assertPublicHost(url.hostname);
  try {
    return await undiciFetch(url, { ...init, dispatcher: publicNetworkAgent });
  } catch (error) {
    if (isBlockedAddressError(error)) throw new UserError(PUBLIC_HOST_ERROR);
    throw error;
  }
}

async function publicAddresses(hostname: string, family?: number): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return [host];
  const addresses = await lookup(host, { all: true, ...(family === 4 || family === 6 ? { family } : {}) });
  return addresses.map((a) => a.address);
}

async function resolvePublicAddress(hostname: string, family?: number | "IPv4" | "IPv6"): Promise<string> {
  if (family === "IPv4") family = 4;
  if (family === "IPv6") family = 6;
  const addresses = await publicAddresses(hostname, family);
  const address = addresses.find((ip) => !isPrivateAddress(ip));
  if (!address) throw new Error(PUBLIC_HOST_ERROR);
  return address;
}

function isBlockedAddressError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (current instanceof UserError && current.message === PUBLIC_HOST_ERROR) return true;
    if (current instanceof Error && current.message === PUBLIC_HOST_ERROR) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

function sniffType(b: Buffer): string {
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(b.toString("utf8", 0, 1024))) return "image/svg+xml";
  return "";
}

/** Gives an SVG without a viewBox one, so it scales to whatever box it is drawn in. */
function withViewBox(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    if (/\sviewBox=/i.test(tag)) return tag;
    const w = parseFloat(/\swidth="([\d.]+)/i.exec(tag)?.[1] ?? "");
    const h = parseFloat(/\sheight="([\d.]+)/i.exec(tag)?.[1] ?? "");
    return w && h ? tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`) : tag;
  });
}

/** Reads the natural size from the file header. */
export function imageSize(b: Buffer, ext: string): { width?: number; height?: number } {
  try {
    switch (ext) {
      case "png":
        return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
      case "gif":
        return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
      case "jpg": {
        // Walk the segments up to the start-of-frame marker.
        let i = 2;
        while (i < b.length) {
          const marker = b[i + 1];
          const len = b.readUInt16BE(i + 2);
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
          }
          i += 2 + len;
        }
        return {};
      }
      case "webp": {
        const chunk = b.toString("ascii", 12, 16);
        if (chunk === "VP8X") return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
        if (chunk === "VP8L") {
          const bits = b.readUInt32LE(21);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      }
      case "svg": {
        const tag = /<svg\b[^>]*>/i.exec(b.toString("utf8"))?.[0] ?? "";
        const vb = /\sviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
        if (vb) return { width: parseFloat(vb[1]), height: parseFloat(vb[2]) };
        return {};
      }
    }
  } catch {
    // truncated or unusual file: size unknown
  }
  return {};
}
