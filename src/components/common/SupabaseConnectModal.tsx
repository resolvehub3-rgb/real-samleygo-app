import React, { useState } from 'react';
import { Database, CheckCircle2, AlertTriangle, Copy, ExternalLink, KeyRound, Server } from 'lucide-react';
import { saveSupabaseCredentials, getSupabaseCredentials } from '../../lib/supabase';

interface SupabaseConnectModalProps {
  isOpen: boolean;
  onClose?: () => void;
  mandatory?: boolean;
}

export const SupabaseConnectModal: React.FC<SupabaseConnectModalProps> = ({
  isOpen,
  onClose,
  mandatory = false,
}) => {
  const current = getSupabaseCredentials();
  const [url, setUrl] = useState(current.url);
  const [key, setKey] = useState(current.key);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedSQL, setCopiedSQL] = useState(false);

  if (!isOpen) return null;

  const handleTestAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !key.trim()) {
      setTestResult({
        success: false,
        message: 'Please provide both your Supabase Project URL and Anon/Public Key.',
      });
      return;
    }

    if (!url.startsWith('https://')) {
      setTestResult({
        success: false,
        message: 'Supabase URL must start with https:// (e.g. https://your-ref.supabase.co)',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // Direct REST health test
      const res = await fetch(`${url.trim()}/rest/v1/`, {
        headers: {
          apikey: key.trim(),
          Authorization: `Bearer ${key.trim()}`,
        },
      });

      if (res.status === 200 || res.status === 404 || res.ok) {
        setTestResult({
          success: true,
          message: 'Connection verified successfully! Reloading SamleyGo...',
        });
        setTimeout(() => {
          saveSupabaseCredentials(url.trim(), key.trim());
        }, 1000);
      } else {
        setTestResult({
          success: false,
          message: `Supabase returned HTTP status ${res.status}. Please check your Anon Key.`,
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Network error';
      setTestResult({
        success: false,
        message: `Failed to connect: ${errMsg}. Check URL format and CORS.`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const copySqlNotice = () => {
    setCopiedSQL(true);
    navigator.clipboard.writeText(`-- Run schema from /supabase/migrations/20260925_samleygo_schema.sql in your Supabase SQL Editor`);
    setTimeout(() => setCopiedSQL(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 md:p-8 shadow-2xl border border-slate-200">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 shadow-md">
            <Database className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-xl font-bold text-slate-900 leading-tight">
              Connect Supabase Database
            </h2>
            <p className="text-xs md:text-sm text-slate-500">
              SamleyGo Ghana requires a real Supabase backend for real-time orders, auth, &amp; tracking.
            </p>
          </div>
          {!mandatory && onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-sm font-medium p-1"
            >
              ✕
            </button>
          )}
        </div>

        <form onSubmit={handleTestAndSave} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-emerald-600" />
              <span>Supabase Project URL</span>
            </label>
            <input
              type="url"
              required
              placeholder="https://xyzcompany.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition"
            />
            <p className="mt-1 text-xs text-slate-400">
              Found in your Supabase Dashboard &rarr; Project Settings &rarr; API &rarr; Project URL
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-emerald-600" />
              <span>Supabase Anon / Public API Key</span>
            </label>
            <input
              type="text"
              required
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition font-mono text-xs"
            />
            <p className="mt-1 text-xs text-slate-400">
              Safe public key. Never paste your secret service-role key.
            </p>
          </div>

          {testResult && (
            <div
              className={`p-3.5 rounded-xl text-xs md:text-sm flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={isTesting}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-md transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isTesting ? (
                <span>Verifying Connection...</span>
              ) : (
                <span>Save &amp; Connect to Supabase</span>
              )}
            </button>
            <button
              type="button"
              onClick={copySqlNotice}
              className="py-3 px-4 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              <span>{copiedSQL ? 'Copied Path!' : 'Database SQL Schema'}</span>
            </button>
          </div>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Schema migration ready: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800 font-mono">/supabase/migrations/</code></span>
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-emerald-600 hover:underline font-medium"
            >
              <span>Supabase Console</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
