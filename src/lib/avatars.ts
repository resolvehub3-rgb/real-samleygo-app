import { supabase } from './supabase';
import { prepareImage, uploadToBucketWithRetry } from './restaurantMedia';

/**
 * Profile photos (courier rider photos first, any signed-in user after that).
 *
 * Stored in the PUBLIC `avatars` Supabase Storage bucket created by
 * /supabase/migrations/20260929_courier_avatar.sql so the customer's order
 * screen and the restaurant's dispatch board can render the assigned
 * courier's face with a plain <img src> — no signed URL round-trip, so the
 * photo appears the instant the profile row changes over realtime.
 *
 * The public URL is saved on `profiles.avatar_url`.
 */

export const AVATAR_BUCKET = 'avatars';

/** Profile photos only ever need to be a small circle — keep uploads tiny. */
export const AVATAR_MAX_DIMENSION = 640;

export interface UploadedAvatar {
  /** URL to persist on profiles.avatar_url */
  url: string;
  /** True when Storage was unreachable and the compressed data-URL was used */
  usedFallback: boolean;
}

/**
 * Compress → upload (with transient-error retries) → public URL.
 * If Storage is unreachable the photo is saved as a smaller data URL instead,
 * so the courier is never blocked from finishing their profile.
 */
export async function uploadProfilePhoto(userId: string, file: File): Promise<UploadedAvatar> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file (JPG, PNG or WebP).');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('That photo is larger than 8 MB. Please pick a smaller image.');
  }
  if (!userId) {
    throw new Error('You must be signed in to upload a photo.');
  }

  const { blob } = await prepareImage(file, AVATAR_MAX_DIMENSION, 0.82);
  const storagePath = `${userId}/avatar-${Date.now()}.jpg`;

  try {
    await uploadToBucketWithRetry(AVATAR_BUCKET, storagePath, blob);

    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath);
    if (!data?.publicUrl) {
      throw new Error('Upload succeeded but no public URL was returned.');
    }

    // Cache-bust so an old copy never lingers behind the browser cache after
    // the courier swaps their photo.
    const separator = data.publicUrl.includes('?') ? '&' : '?';
    return { url: `${data.publicUrl}${separator}v=${Date.now()}`, usedFallback: false };
  } catch (storageError) {
    try {
      const { dataUrl } = await prepareImage(file, Math.round(AVATAR_MAX_DIMENSION * 0.7), 0.7);
      return { url: dataUrl, usedFallback: true };
    } catch {
      throw storageError;
    }
  }
}

/** Maps raw storage errors to a friendly, actionable message. */
export function describeAvatarError(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Photo upload failed. Please try again.';
  const lower = raw.toLowerCase();
  if (lower.includes('bucket')) {
    return `${raw}. The "avatars" bucket was not found — run supabase/migrations/20260929_courier_avatar.sql in the SQL editor.`;
  }
  if (lower.includes('row-level') || lower.includes('policy')) {
    return `${raw}. Upload was blocked by storage policies — re-run the courier avatar migration SQL.`;
  }
  if (lower.includes('failed to fetch') || lower.includes('network')) {
    return 'Cloud storage is unreachable right now. Please try again in a moment.';
  }
  return raw;
}
