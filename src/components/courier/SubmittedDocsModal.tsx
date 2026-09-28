import React, { useEffect, useState } from 'react';
import { X, FileText, ShieldCheck, RefreshCw, AlertCircle, Hash, ClipboardCheck } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { CourierDocument } from '../../types/database';
import { DocumentImage } from '../common/DocumentImage';
import { maskGhanaCardNumber, maskLicenseNumber } from '../../lib/verification';

interface SubmittedDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  courierId: string;
}

/**
 * Modal listing the courier's submitted verification documents
 * (Ghana Card front/back, driving licence). Private-bucket photos are
 * rendered through signed URLs via <DocumentImage />.
 */
export const SubmittedDocsModal: React.FC<SubmittedDocsModalProps> = ({
  isOpen,
  onClose,
  courierId,
}) => {
  const [documents, setDocuments] = useState<CourierDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !courierId || !isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: fetchError } = await supabase
          .from('courier_documents')
          .select('*')
          .eq('courier_id', courierId)
          .order('created_at', { ascending: true });

        if (cancelled) return;
        if (fetchError) throw fetchError;
        setDocuments((data as CourierDocument[]) || []);
      } catch {
        if (!cancelled) setError('Could not load your documents. Please try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, courierId]);

  if (!isOpen) return null;

  const ghanaCardDocs = documents.filter(
    (d) => d.document_type === 'GHANA_CARD_FRONT' || d.document_type === 'GHANA_CARD_BACK'
  );
  const licenceDoc = documents.find((d) => d.document_type === 'DRIVING_LICENCE');
  const otherDocs = documents.filter(
    (d) =>
      d.document_type !== 'GHANA_CARD_FRONT' &&
      d.document_type !== 'GHANA_CARD_BACK' &&
      d.document_type !== 'DRIVING_LICENCE'
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Submitted verification documents"
    >
      <div
        className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 max-h-[88dvh] flex flex-col animate-in fade-in slide-in-from-bottom-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <FileText className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm sm:text-base">
                Submitted Documents
              </h3>
              <p className="text-[11px] text-slate-400">
                Stored securely · only you and admins can view
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center hover:bg-slate-200 transition flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin mx-auto" />
              <p className="text-xs text-slate-500">Loading your documents…</p>
            </div>
          ) : error ? (
            <div className="py-8 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <p className="text-xs text-rose-700 font-semibold">{error}</p>
            </div>
          ) : documents.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <FileText className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-700">No documents on file</p>
              <p className="text-xs text-slate-400">
                Your submitted verification documents will appear here.
              </p>
            </div>
          ) : (
            <>
              {/* Ghana Card photos */}
              {ghanaCardDocs.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Hash className="w-3 h-3" /> Ghana Card
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    {ghanaCardDocs.map((doc) => (
                      <div key={doc.id} className="space-y-1.5">
                        <DocumentImage
                          document={doc}
                          className="w-full h-32 object-cover rounded-xl border border-slate-200"
                        />
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-slate-600">
                            {doc.document_side === 'BACK' ? 'Back side' : 'Front side'}
                          </span>
                          <span
                            className={`font-black px-1.5 py-0.5 rounded ${
                              doc.status === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-700'
                                : doc.status === 'REJECTED'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {doc.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {ghanaCardDocs[0]?.document_number && (
                    <p className="text-[11px] text-slate-500 pt-1">
                      Card PIN: <span className="font-bold">{maskGhanaCardNumber(ghanaCardDocs[0].document_number)}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Driving licence */}
              {licenceDoc && (
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1.5">
                    <ClipboardCheck className="w-3 h-3" /> Driving Licence
                  </span>
                  <p className="text-xs text-slate-700">
                    Licence ID: <span className="font-bold">{maskLicenseNumber(licenceDoc.document_number)}</span>
                  </p>
                  <span
                    className={`inline-block text-[10px] font-black px-1.5 py-0.5 rounded ${
                      licenceDoc.status === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-700'
                        : licenceDoc.status === 'REJECTED'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {licenceDoc.status}
                  </span>
                </div>
              )}

              {/* Any other document types */}
              {otherDocs.map((doc) => (
                <div key={doc.id} className="p-3 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    {doc.document_type.replace(/_/g, ' ')}
                  </span>
                  <p className="text-xs text-slate-700">Status: {doc.status}</p>
                </div>
              ))}

              {/* Approved reassurance */}
              {documents.every((d) => d.status === 'APPROVED') && (
                <div className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  All documents approved — you are verified to deliver.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
