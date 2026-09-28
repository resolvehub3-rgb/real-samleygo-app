import React from 'react';

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort handler for render-time crashes.
 *
 * Without it, a thrown error unmounts the entire React tree and the user is
 * left staring at a blank page with no explanation. With it, the failure is
 * shown on screen (and mirrored to the console) together with a reload action,
 * so a crash always leaves a visible trace.
 */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[SamleyGo] Uncaught render error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-5">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
              <span className="text-rose-400 font-black text-lg leading-none">!</span>
            </div>
            <div>
              <h1 className="text-base font-black text-white">
                SamleyGo hit an unexpected error
              </h1>
              <p className="text-xs text-slate-400">
                The message below is what stopped the page from rendering.
              </p>
            </div>
          </div>

          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-rose-300">
            {error.message || String(error)}
          </pre>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-bold text-white transition"
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="flex-1 rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-bold text-slate-200 transition"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
