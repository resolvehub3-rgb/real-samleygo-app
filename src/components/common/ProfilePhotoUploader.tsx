import React, { useRef, useState } from 'react';
import { Camera, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { UserAvatar } from './UserAvatar';
import { uploadProfilePhoto, describeAvatarError } from '../../lib/avatars';

/**
 * "Add / change profile picture" control.
 *
 * Used by the courier (and every other role) on the profile screen: pick or
 * snap a photo → compressed in the browser → uploaded to the public `avatars`
 * bucket → `onUploaded` persists the URL on `profiles.avatar_url`, which the
 * customer's order page and the restaurant's dispatch board pick up in
 * realtime.
 */
export interface ProfilePhotoUploaderProps {
  userId: string;
  name?: string | null;
  photoUrl?: string | null;
  /** Persist the new URL (e.g. `updateProfile({ avatar_url: url })`) */
  onUploaded: (url: string) => Promise<void> | void;
  /** Extra copy shown under the control, e.g. courier-specific guidance */
  hint?: string;
  className?: string;
}

export const ProfilePhotoUploader: React.FC<ProfilePhotoUploaderProps> = ({
  userId,
  name,
  photoUrl,
  onUploaded,
  hint,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change event
    event.target.value = '';
    if (!file) return;

    setError(null);
    setNotice(null);
    setIsUploading(true);

    try {
      const { url, usedFallback } = await uploadProfilePhoto(userId, file);
      await onUploaded(url);
      setNotice(
        usedFallback
          ? 'Photo saved in compressed mode because cloud storage was unavailable. It is visible to everyone already.'
          : 'Profile photo updated — it is now live for customers and restaurants.'
      );
    } catch (err) {
      setError(describeAvatarError(err));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="relative">
        <UserAvatar
          src={photoUrl}
          name={name}
          sizeClassName="w-20 h-20"
          shapeClassName="rounded-3xl"
          className="ring-2 ring-white shadow-lg shadow-emerald-900/10"
        />

        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          aria-label="Upload a profile photo"
          className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center justify-center shadow-md border-2 border-white transition active:scale-95"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="user"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      <div className="min-w-0 space-y-1.5">
        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition disabled:opacity-60 active:scale-95"
        >
          {isUploading ? 'Uploading…' : photoUrl ? 'Change Photo' : 'Add Photo'}
        </button>

        <p className="text-[11px] text-slate-500">
          {hint ?? 'JPG, PNG or WebP · it appears live on every active delivery.'}
        </p>

        {notice && (
          <p className="text-[11px] font-semibold text-emerald-700 flex items-start gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{notice}</span>
          </p>
        )}

        {error && (
          <p className="text-[11px] font-semibold text-rose-600 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  );
};
