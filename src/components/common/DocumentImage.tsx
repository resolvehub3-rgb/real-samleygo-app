import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { CourierDocument } from '../../types/database';
import { resolveDocumentUrl } from '../../lib/documents';

interface DocumentImageProps {
  document: CourierDocument;
  className?: string;
}

/**
 * Renders a courier verification photo.
 * Private-bucket photos are resolved through a short-lived signed URL that only
 * the owning courier or a super admin is allowed to mint (storage RLS).
 */
export const DocumentImage: React.FC<DocumentImageProps> = ({
  document,
  className = 'w-full h-28 object-cover',
}) => {
  const [src, setSrc] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  const { id, storage_path: storagePath, document_url: documentUrl, updated_at: updatedAt } = document;

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setHasFailed(false);

    if (documentUrl && documentUrl.startsWith('data:')) {
      setSrc(documentUrl);
      return () => {
        cancelled = true;
      };
    }

    if (!storagePath && !documentUrl) {
      setHasFailed(true);
      return () => {
        cancelled = true;
      };
    }

    resolveDocumentUrl(document)
      .then((url) => {
        if (cancelled) return;
        if (url) setSrc(url);
        else setHasFailed(true);
      })
      .catch(() => {
        if (!cancelled) setHasFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, storagePath, documentUrl, updatedAt]);

  if (hasFailed) {
    return (
      <div className={`${className} bg-slate-100 flex flex-col items-center justify-center text-slate-400`}>
        <ImageOff className="w-5 h-5 mb-1" />
        <span className="text-[9px] font-bold">Photo unavailable</span>
      </div>
    );
  }

  if (!src) {
    return <div className={`${className} bg-slate-200 animate-pulse`} />;
  }

  return (
    <img
      src={src}
      alt={document.document_type.replace(/_/g, ' ')}
      className={className}
      onError={() => setHasFailed(true)}
    />
  );
};
