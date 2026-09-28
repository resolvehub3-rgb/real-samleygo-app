import { supabase } from './supabase';
import { CourierDocument } from '../types/database';

/**
 * Supabase Storage bucket that holds courier verification photos
 * (Ghana Card front & back). Created by the SQL migrations in
 * /supabase/migrations/20260925_samleygo_schema.sql
 */
export const COURIER_DOC_BUCKET = 'courier-documents';

export interface PreparedDocument {
  blob: Blob;
  dataUrl: string;
  contentType: string;
  width: number;
  height: number;
}

export interface UploadedDocument {
  /** Private bucket path — required to mint a signed URL later */
  storagePath?: string;
  /** Set only when Storage was unreachable; the compressed copy is stored inline instead */
  inlineUrl: string | null;
  fallback: boolean;
}

const dataUrlToBlob = (dataUrl: string): Blob => {
  const [header, body] = dataUrl.split(',');
  const mimeMatch = /data:(.*?);/.exec(header);
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeMatch?.[1] || 'image/jpeg' });
};

/**
 * Compresses an ID photo in the browser so uploads stay fast on Ghanaian
 * mobile data. Returns both a Blob (for Supabase Storage) and a data URL
 * (used as a fallback if the Storage bucket is not reachable).
 */
export const prepareDocumentImage = (
  file: File,
  maxDimension = 1400,
  quality = 0.8
): Promise<PreparedDocument> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select an image file for the ID photo.'));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      try {
        const longestSide = Math.max(image.width, image.height) || 1;
        const scale = Math.min(1, maxDimension / longestSide);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('Image processing is not supported on this device.');
        }

        context.drawImage(image, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        resolve({
          blob: dataUrlToBlob(dataUrl),
          dataUrl,
          contentType: 'image/jpeg',
          width,
          height,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not process this image.'));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('That file could not be opened as an image. Please try another photo.'));
    };

    image.src = objectUrl;
  });

/**
 * Uploads a courier verification photo to the PRIVATE Supabase Storage bucket
 * `courier-documents` under `<userId>/<key>-<timestamp>.jpg`, so a courier can
 * only ever write inside their own folder (enforced by the storage RLS policy).
 * Falls back to the compressed inline copy if Storage is unavailable.
 */
export const uploadCourierDocument = async (
  userId: string,
  key: string,
  document: PreparedDocument
): Promise<UploadedDocument> => {
  const storagePath = `${userId}/${key}-${Date.now()}.jpg`;

  try {
    const { error } = await supabase.storage.from(COURIER_DOC_BUCKET).upload(storagePath, document.blob, {
      contentType: document.contentType,
      cacheControl: '86400',
      upsert: true,
    });

    if (error) {
      throw error;
    }

    return { storagePath, inlineUrl: null, fallback: false };
  } catch (error) {
    console.warn('[courier-documents] Storage upload failed, storing compressed copy inline.', error);
    return { storagePath: undefined, inlineUrl: document.dataUrl, fallback: true };
  }
};

/**
 * Resolves a displayable URL for an uploaded document.
 * Private bucket objects are exposed through a short-lived signed URL that can
 * only be minted by the courier who owns the photo or a super admin.
 */
export const resolveDocumentUrl = async (document: CourierDocument): Promise<string | null> => {
  if (document.storage_path) {
    const { data, error } = await supabase.storage
      .from(COURIER_DOC_BUCKET)
      .createSignedUrl(document.storage_path, 3600);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
    // Fall through: the object may have been stored inline instead
  }

  return document.document_url || null;
};
