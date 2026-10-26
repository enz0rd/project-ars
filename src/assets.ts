import { create } from "zustand";
import { userId } from "./auth.ts";
import { supabase } from "./lib/supabase.ts";

/**
 * Images live in the private Storage bucket "assets" under the user's folder and
 * nodes reference them as "asset:<user id>/<hash>.<ext>". To draw them, the
 * browser asks for short-lived signed URLs, batched and cached here.
 */
export const ASSET_PREFIX = "asset:";
const BUCKET = "assets";
const URL_TTL = 3600;
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const isImageFile = (f: Blob) => f.type in EXT;

export interface UploadedImage {
  src: string;
  width?: number;
  height?: number;
}

export async function uploadImage(file: Blob): Promise<UploadedImage> {
  const uid = userId();
  if (!uid) throw new Error("unauthorized");
  if (!isImageFile(file)) throw new Error("unsupported_image");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  let blob = file;
  if (file.type === "image/svg+xml") blob = new Blob([withViewBox(await file.text())], { type: file.type });
  const hash = await sha256(await blob.arrayBuffer());
  const path = `${uid}/${hash}.${EXT[file.type]}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: file.type, upsert: false });
  // The same picture uploaded before: reuse it.
  if (error && !/exist|duplicate/i.test(error.message)) throw new Error(error.message);
  const local = URL.createObjectURL(blob);
  const size = await naturalSize(local);
  URL.revokeObjectURL(local);
  return { src: ASSET_PREFIX + path, ...size };
}

async function sha256(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function naturalSize(src: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : {});
    img.onerror = () => resolve({});
    img.src = src;
  });
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

// Signed URLs

interface AssetUrls {
  urls: Record<string, { url: string; expires: number }>;
}
const useAssetUrls = create<AssetUrls>(() => ({ urls: {} }));
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function request(path: string) {
  pending.add(path);
  flushTimer ??= setTimeout(flush, 0);
}

async function flush() {
  const paths = [...pending];
  pending = new Set();
  flushTimer = undefined;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, URL_TTL);
  const expires = Date.now() + (URL_TTL - 300) * 1000;
  const urls = { ...useAssetUrls.getState().urls };
  for (const item of data ?? []) if (item.signedUrl && item.path) urls[item.path] = { url: item.signedUrl, expires };
  useAssetUrls.setState({ urls });
}

/** A displayable URL for an image src (asset refs are signed; data:/https pass through). */
export function useAssetUrl(src: string | undefined): string | undefined {
  const path = src?.startsWith(ASSET_PREFIX) ? src.slice(ASSET_PREFIX.length) : null;
  const entry = useAssetUrls((s) => (path ? s.urls[path] : undefined));
  if (!src) return undefined;
  if (!path) return src;
  if ((!entry || entry.expires < Date.now()) && !pending.has(path)) request(path);
  return entry?.url;
}

async function resolveUrl(src: string): Promise<string | null> {
  if (!src.startsWith(ASSET_PREFIX)) return src;
  const path = src.slice(ASSET_PREFIX.length);
  const cached = useAssetUrls.getState().urls[path];
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, URL_TTL);
  return data?.signedUrl ?? null;
}

const inlined = new Map<string, Promise<string>>();

/** data: URLs for every image source, so exported files carry their images. */
export async function inlineImages(srcs: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    [...new Set(srcs)].map(async (src) => {
      if (src.startsWith("data:")) return out.set(src, src);
      if (!inlined.has(src)) {
        inlined.set(
          src,
          resolveUrl(src)
            .then((url) => (url ? fetch(url) : Promise.reject()))
            .then((r) => (r.ok ? r.blob() : Promise.reject()))
            .then(toDataUrl),
        );
      }
      try {
        out.set(src, await inlined.get(src)!);
      } catch {
        inlined.delete(src);
      }
    }),
  );
  return out;
}

/** Resolves images to display URLs (for previews), in one batch. */
export async function displayUrls(srcs: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all([...new Set(srcs)].map(async (src) => {
    const url = await resolveUrl(src);
    if (url) out.set(src, url);
  }));
  return out;
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",", 2);
  const type = /^data:([^;]+)/.exec(head)?.[1] ?? "";
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
