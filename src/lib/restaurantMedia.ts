import { supabase } from './supabase';

/**
 * Shared helpers for uploading restaurant photos (logo, cover, dish images)
 * to the PUBLIC `restaurant-media` Supabase Storage bucket.
 *
 * Includes:
 * - Browser-side JPEG compression (fast uploads on mobile data)
 * - Automatic retries for transient Cloudflare 5xx/520 gateway errors
 * - A reduced-size data-URL fallback when Storage is unreachable, so photos
 *   still display for customers instead of blocking the owner.
 */

export const RESTAURANT_MEDIA_BUCKET = 'restaurant-media';

export interface PreparedImage {
  blob: Blob;
  dataUrl: string;
}

export interface UploadResult {
  /** Public URL (or fallback data URL) to save on the DB row */
  url: string;
  /** True when Storage was unreachable and the data-URL fallback was used */
  usedFallback: boolean;
}

// Compress any image file to a JPEG so uploads stay fast on mobile data and
// fit comfortably inside the 5 MB bucket limit. Returns both a Blob (for
// Supabase Storage) and a data URL (used as an offline fallback).
export async function prepareImage(
  file: File,
  maxDimension = 1200,
  quality = 0.82
): Promise<PreparedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error('That file could not be opened as an image. Please try another photo.'));
      img.src = objectUrl;
    });

    const longestSide = Math.max(image.width, image.height);
    const scale = Math.min(1, maxDimension / longestSide);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is not supported on this device.');

    ctx.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);

    const [header, body] = dataUrl.split(',');
    const mimeMatch = /data:(.*?);/.exec(header);
    const mime = mimeMatch?.[1] || 'image/jpeg';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { blob: new Blob([bytes], { type: mime }), dataUrl };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// HTTP 520 (and other 5xx) from Supabase Storage is a transient Cloudflare
// gateway error — Supabase's own troubleshooting guide recommends retrying.
// Fails fast on real permission/config errors (403/404/400).
export async function uploadToBucketWithRetry(
  bucketId: string,
  path: string,
  blob: Blob,
  attempts = 3
): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      // 800ms, 2s backoff before 2nd/3rd attempts
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt * attempt));
    }

    const { error } = await supabase.storage.from(bucketId).upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: true,
    });

    if (!error) return;
    lastError = error;

    const status = String((error as { statusCode?: string | number }).statusCode ?? '');
    const retryable =
      status === '' ||
      ['408', '409', '429', '500', '502', '503', '504', '520', '521', '522', '523', '524'].includes(
        status
      );

    if (!retryable) throw error;
  }

  throw lastError;
}

/**
 * Full upload pipeline for a restaurant photo:
 * compress → upload (with retries) → public URL. If Storage is unreachable,
 * saves a smaller data-URL instead so the photo still displays.
 */
export async function uploadRestaurantImage(
  userId: string,
  pathPrefix: string,
  file: File,
  opts?: { maxDimension?: number; quality?: number }
): Promise<UploadResult> {
  const maxDimension = opts?.maxDimension ?? 1200;
  const quality = opts?.quality ?? 0.82;

  const { blob } = await prepareImage(file, maxDimension, quality);
  const storagePath = `${userId}/${pathPrefix}-${Date.now()}.jpg`;

  try {
    await uploadToBucketWithRetry(RESTAURANT_MEDIA_BUCKET, storagePath, blob);

    const { data: urlData } = supabase.storage
      .from(RESTAURANT_MEDIA_BUCKET)
      .getPublicUrl(storagePath);

    if (!urlData.publicUrl) throw new Error('Upload succeeded but no public URL was returned.');
    return { url: urlData.publicUrl, usedFallback: false };
  } catch (storageError) {
    // Storage unreachable (e.g. persistent HTTP 520) → offline fallback
    try {
      const { dataUrl } = await prepareImage(
        file,
        Math.round(maxDimension * 0.65),
        0.7
      );
      return { url: dataUrl, usedFallback: true };
    } catch {
      throw storageError;
    }
  }
}

/** Maps raw storage errors to owner-friendly hints. */
export function describeUploadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Photo upload failed. Please try again.';
  const lower = raw.toLowerCase();
  if (lower.includes('bucket')) {
    return `${raw}. The "restaurant-media" bucket was not found — run supabase/migrations/20260928_restaurant_media_bucket.sql in the SQL editor.`;
  }
  if (lower.includes('row-level') || lower.includes('policy')) {
    return `${raw}. Upload was blocked by storage policies — re-run the restaurant-media migration SQL.`;
  }
  return `${raw}. If this is an HTTP 520 error it is a temporary Cloudflare issue on Supabase's side — wait a minute and retry.`;
}
