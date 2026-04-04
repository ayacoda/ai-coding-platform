import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { fetchVersions, deleteVersion } from '../lib/versions';
import { supabase } from '../lib/supabase';
import { cancelGeneration } from '../lib/chat';
import type { ProjectVersion } from '../lib/versions';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface Props {
  projectId: string;
  show: boolean;
  onClose: () => void;
  /** Called when a version is successfully restored */
  onRestored?: () => void;
}

export default function VersionHistoryPanel({ projectId, show, onClose, onRestored }: Props) {
  const { setFiles, setMessages } = useStore();
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (show && projectId) {
      loadVersions();
    }
  }, [show, projectId]);

  async function loadVersions() {
    setLoading(true);
    const data = await fetchVersions(projectId);
    setVersions(data);
    setLoading(false);
  }

  async function handleRestore(version: ProjectVersion) {
    setRestoringId(version.id);

    // Stop any in-progress generation immediately before restoring
    cancelGeneration(true);
    useStore.getState().setIsGenerating(false);

    // 1. Set files directly in the store (instant, no AI involved)
    setFiles(version.files, true);

    // 2. Trim chat messages to the point this version was created.
    //    version.label = first 80 chars of the user prompt that triggered this snapshot.
    //    Walk the messages array backwards to find that user message, then keep only
    //    messages up to and including the assistant response that followed it.
    const { messages: currentMessages } = useStore.getState();
    let trimmedMessages = currentMessages;

    if (version.label && currentMessages.length > 0) {
      const label80 = version.label.slice(0, 80);
      let matchIdx = -1;
      for (let i = currentMessages.length - 1; i >= 0; i--) {
        const m = currentMessages[i];
        if (m.role === 'user' && m.content.slice(0, 80) === label80) {
          matchIdx = i;
          break;
        }
      }
      if (matchIdx !== -1) {
        // Keep up to the user message + its immediate assistant response
        const keepCount = Math.min(matchIdx + 2, currentMessages.length);
        trimmedMessages = currentMessages.slice(0, keepCount);
      }
    }

    setMessages(trimmedMessages);

    // 3. Immediately persist restored files + trimmed messages to the projects table
    await supabase
      .from('projects')
      .update({
        files: version.files,
        messages: trimmedMessages,
        updated_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    setRestoringId(null);
    onRestored?.();
    onClose();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await deleteVersion(id);
    setVersions((prev) => prev.filter((v) => v.id !== id));
    setDeletingId(null);
  }

  const previewVersion = previewId ? versions.find((v) => v.id === previewId) : null;

  return (
    <>
      {/* Backdrop */}
      {show && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
        />
      )}

      {/* Slide-over panel */}
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-[380px] bg-[#0d0d0d] border-l border-zinc-800 flex flex-col shadow-2xl transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-[13px] font-semibold text-zinc-100">Version History</h2>
              <p className="text-[10px] text-zinc-600">
                {loading ? 'Loading…' : `${versions.length} snapshot${versions.length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <svg className="w-5 h-5 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
              </svg>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-[13px] font-medium text-zinc-500">No versions yet</p>
              <p className="text-[11px] text-zinc-700 mt-1">
                Snapshots are saved automatically after each AI generation.
              </p>
            </div>
          ) : (
            versions.map((version, idx) => {
              const isFirst = idx === 0;
              const fileCount = Object.keys(version.files).length;
              const isPreviewing = previewId === version.id;

              return (
                <div
                  key={version.id}
                  className={`group rounded-xl border p-3 transition-all cursor-pointer ${
                    isPreviewing
                      ? 'border-indigo-500/50 bg-indigo-600/5'
                      : 'border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60'
                  }`}
                  onClick={() => setPreviewId(isPreviewing ? null : version.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {/* Version icon */}
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isFirst ? 'bg-indigo-600/20 border border-indigo-500/30' : 'bg-zinc-800 border border-zinc-700'
                      }`}>
                        <svg
                          className={`w-3 h-3 ${isFirst ? 'text-indigo-400' : 'text-zinc-500'}`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <circle cx="10" cy="10" r="4" />
                        </svg>
                      </div>

                      <div className="min-w-0 flex-1">
                        {/* Label */}
                        <p className="text-[12px] font-medium text-zinc-200 truncate leading-tight">
                          {version.label ? version.label.slice(0, 60) : `Snapshot #${versions.length - idx}`}
                          {version.label && version.label.length > 60 ? '…' : ''}
                        </p>
                        {/* Meta */}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-zinc-600">{timeAgo(version.created_at)}</span>
                          <span className="text-zinc-800">·</span>
                          <span className="text-[10px] text-zinc-600">{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
                          {isFirst && (
                            <>
                              <span className="text-zinc-800">·</span>
                              <span className="text-[10px] text-indigo-400 font-medium">Latest</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRestore(version); }}
                        disabled={!!restoringId}
                        title="Restore this version"
                        className="flex items-center gap-1 h-6 px-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-medium transition-colors"
                      >
                        {restoringId === version.id ? (
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                        )}
                        Restore
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(version.id); }}
                        disabled={deletingId === version.id}
                        title="Delete this snapshot"
                        className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-500/10 text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        {deletingId === version.id ? (
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded: file list preview */}
                  {isPreviewing && (
                    <div className="mt-2.5 pt-2.5 border-t border-zinc-800">
                      <p className="text-[10px] text-zinc-600 mb-1.5 font-medium uppercase tracking-wide">Files in this snapshot</p>
                      <div className="space-y-0.5">
                        {Object.keys(version.files).map((fname) => (
                          <div key={fname} className="flex items-center gap-1.5">
                            <svg className="w-3 h-3 text-zinc-700 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-[10px] text-zinc-500 font-mono truncate">{fname}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
          <p className="text-[10px] text-zinc-700 text-center">
            Snapshots saved automatically after each AI generation · Last {versions.length} kept
          </p>
        </div>
      </div>

      {/* File preview overlay for pre-restore inspection */}
      {previewVersion && (
        <div className="fixed inset-y-0 right-[380px] z-50 w-64 bg-zinc-950 border-l border-zinc-800 p-3 overflow-y-auto hidden lg:block">
          <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-wide mb-2">Preview — files</p>
          {Object.entries(previewVersion.files).map(([fname]) => (
            <div key={fname} className="text-[10px] text-zinc-500 font-mono py-0.5 truncate">{fname}</div>
          ))}
        </div>
      )}
    </>
  );
}
