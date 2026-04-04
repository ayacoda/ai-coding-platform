import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

interface VercelDeployModalProps {
  projectName?: string;
  onClose: () => void;
}

type DeployState = 'idle' | 'confirm' | 'deploying' | 'building' | 'ready' | 'error';
type SlugStatus = 'idle' | 'checking' | 'available' | 'yours';

const VERCEL_STATES: Record<string, string> = {
  QUEUED: 'Queued',
  INITIALIZING: 'Initializing',
  BUILDING: 'Building',
  READY: 'Ready',
  ERROR: 'Build failed',
  CANCELED: 'Canceled',
};

function toSlug(name: string): string {
  return (name || 'my-app')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'my-app';
}

export default function VercelDeployModal({ projectName, onClose }: VercelDeployModalProps) {
  const { files, storageMode, projectConfig } = useStore();

  // Key for localStorage — tracks which subdomain was last deployed for this project
  const projectKey = projectConfig?.id || projectName || 'default';
  const storageKey = `vercel_deployed_${projectKey}`;

  // Initialize subdomain from previously deployed name (if any), else project name
  const previousDeployName = (() => { try { return localStorage.getItem(storageKey); } catch { return null; } })();
  const [subdomain, setSubdomain] = useState(() => previousDeployName || toSlug(projectName || 'my-app'));
  const [customDomain, setCustomDomain] = useState('');
  const [deployState, setDeployState] = useState<DeployState>('idle');
  const [deployUrl, setDeployUrl] = useState('');
  const [customDomainUrls, setCustomDomainUrls] = useState<string[]>([]);
  const [deploymentId, setDeploymentId] = useState('');
  const [buildStatus, setBuildStatus] = useState('');
  const [error, setError] = useState('');
  const [inspectorUrl, setInspectorUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Realtime availability check
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [aliasAvailable, setAliasAvailable] = useState(true);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manage domains for already-deployed projects
  const [existingAliases, setExistingAliases] = useState<string[]>([]);
  const [loadingAliases, setLoadingAliases] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, []);

  // Debounced slug availability check
  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    const slug = toSlug(subdomain.trim());
    if (!slug || deployState !== 'idle') { setSlugStatus('idle'); setAliasAvailable(true); setExistingAliases([]); return; }

    setSlugStatus('checking');
    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/deploy/vercel/check-subdomain?name=${encodeURIComponent(slug)}`);
        const data = await res.json();
        if (res.ok) {
          const status = data.status === 'yours' ? 'yours' : 'available';
          setSlugStatus(status);
          setAliasAvailable(data.aliasAvailable !== false);
          if (status === 'yours') fetchExistingAliases(slug);
        } else {
          setSlugStatus('idle');
        }
      } catch {
        setSlugStatus('idle');
      }
    }, 600);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain]);

  async function fetchExistingAliases(slug: string) {
    setLoadingAliases(true);
    try {
      const res = await fetch(`/api/deploy/vercel/project-aliases?name=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (res.ok) setExistingAliases(data.aliases || []);
    } catch { /* ignore */ }
    setLoadingAliases(false);
  }

  async function handleDisconnect() {
    const projectName = toSlug(subdomain);
    setDisconnecting(projectName);
    try {
      const res = await fetch('/api/deploy/vercel/project', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName }),
      });
      if (res.ok) {
        // Clear saved deployment info for this project
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
        // Reset all deploy state
        setExistingAliases([]);
        setDeployUrl('');
        setCustomDomainUrls([]);
        setDeploymentId('');
        setBuildStatus('');
        setInspectorUrl(null);
        setSlugStatus('available');
        setDeployState('idle');
      }
    } catch { /* ignore */ }
    setDisconnecting(null);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function pollStatus(id: string) {
    try {
      const res = await fetch(`/api/deploy/vercel/${id}/status`);
      const data = await res.json();
      if (!res.ok) { stopPolling(); setError(data.error || 'Status check failed'); setDeployState('error'); return; }

      const state: string = data.readyState || '';
      setBuildStatus(VERCEL_STATES[state] || state);

      if (data.inspectorUrl) setInspectorUrl(data.inspectorUrl);

      if (state === 'READY') {
        stopPolling();
        setDeployState('ready');
      } else if (state === 'ERROR' || state === 'CANCELED') {
        stopPolling();
        const errMsg = data.errorMessage
          ? `Build failed: ${data.errorMessage}`
          : `Deployment ${state.toLowerCase()} on Vercel`;
        setError(errMsg);
        setDeployState('error');
      }
    } catch {
      // network hiccup — keep polling
    }
  }

  function handleDeploy() {
    const slug = toSlug(subdomain.trim());
    if (!slug) { setError('Subdomain is required'); return; }
    if (Object.keys(files).length === 0) { setError('No project files to deploy'); return; }
    setError('');
    setDeployState('confirm');
  }

  async function executeDeploy() {
    const slug = toSlug(subdomain.trim());
    setDeployState('deploying');

    // Pass previousSubdomain so server can rename if user changed it
    const prevName = previousDeployName && previousDeployName !== slug ? previousDeployName : undefined;

    try {
      const res = await fetch('/api/deploy/vercel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          projectName,
          storageMode,
          projectConfig,
          subdomain: slug,
          customDomains: customDomain.trim() ? expandDomains(customDomain.trim()) : [],
          previousSubdomain: prevName,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Deployment failed'); setDeployState('error'); return; }

      // Save the deployed subdomain for next time
      try { localStorage.setItem(storageKey, slug); } catch { /* ignore */ }

      setDeployUrl(data.url || '');
      if (data.customDomainUrls?.length) setCustomDomainUrls(data.customDomainUrls);
      else if (data.customDomainUrl) setCustomDomainUrls([data.customDomainUrl]);
      setDeploymentId(data.deploymentId || '');
      setBuildStatus('Building');
      setDeployState('building');

      if (data.deploymentId) {
        pollRef.current = setInterval(() => pollStatus(data.deploymentId), 4000);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error');
      setDeployState('error');
    }
  }

  function handleCopy(url: string) {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  }

  function handleRetry() {
    stopPolling();
    setError(''); setDeployUrl(''); setCustomDomainUrls([]); setDeploymentId(''); setBuildStatus(''); setInspectorUrl(null);
    setDeployState('idle');
  }

  /** For an apex domain (example.com) → attach both apex + www; otherwise just the one domain. */
  function expandDomains(domain: string): string[] {
    const d = domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!d) return [];
    const parts = d.split('.');
    if (parts.length === 2) return [d, `www.${d}`];
    return [d];
  }

  const isLoading = deployState === 'deploying' || deployState === 'building';
  const confirmedSlug = toSlug(subdomain);
  const confirmedCustomDomains = customDomain.trim() ? expandDomains(customDomain.trim()) : [];
  const isRename = !!(previousDeployName && previousDeployName !== confirmedSlug);
  const subdomainSlug = toSlug(subdomain);
  const previewUrl = `${subdomainSlug}.vercel.app`;
  // When the project is already deployed, use the real alias (may have team suffix)
  const displayUrl = (slugStatus === 'yours' && existingAliases.length > 0)
    ? existingAliases[0]
    : previewUrl;

  // Slug status indicator
  const slugHint = !subdomain.trim() ? null : slugStatus === 'checking' ? (
    <span className="flex items-center gap-1 text-zinc-500">
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
      </svg>
      Checking…
    </span>
  ) : slugStatus === 'available' && !aliasAvailable ? (
    <span className="flex items-center gap-1 text-amber-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Subdomain taken
    </span>
  ) : slugStatus === 'available' ? (
    <span className="flex items-center gap-1 text-emerald-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
      Available
    </span>
  ) : slugStatus === 'yours' ? (
    <span className="flex items-center gap-1 text-indigo-400">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {previousDeployName && previousDeployName !== subdomainSlug
        ? 'Will rename from ' + previousDeployName
        : 'Already deployed — will update'}
    </span>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={isLoading ? undefined : onClose} />

      <div className="relative z-10 w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl">

        {/* ── Delete confirmation dialog ── */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-zinc-900/95 backdrop-blur-sm">
            <div className="w-full max-w-xs mx-6 space-y-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/15 border border-red-500/25 mx-auto">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div className="text-center space-y-1.5">
                <h3 className="text-[14px] font-semibold text-zinc-100">Delete project?</h3>
                <p className="text-[12px] text-zinc-400 leading-relaxed">
                  <span className="font-mono text-zinc-300">{toSlug(subdomain)}.vercel.app</span> will be permanently removed from Vercel and the subdomain will be freed.
                </p>
              </div>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors border border-zinc-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); handleDisconnect(); }}
                  disabled={!!disconnecting}
                  className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-40"
                >
                  {disconnecting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-white flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 76 65" className="w-3.5 h-3.5" fill="black">
                <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
              </svg>
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-zinc-100">Deploy to Vercel</h2>
              <p className="text-[11px] text-zinc-500">Get a live URL in ~2 minutes</p>
            </div>
          </div>
          <button
            onClick={isLoading ? undefined : onClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {deployState === 'idle' || deployState === 'error' ? (
            <>
              {/* Subdomain picker */}
              <div>
                <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                  Subdomain
                </label>
                <div className="flex items-center gap-0 rounded-lg overflow-hidden border border-zinc-700 focus-within:border-indigo-500 transition-colors bg-zinc-800">
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => { setSubdomain(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && deployState === 'idle') handleDeploy(); }}
                    placeholder="my-app"
                    spellCheck={false}
                    disabled={isLoading}
                    className="flex-1 bg-transparent px-3 py-2.5 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none font-mono min-w-0"
                  />
                  <span className="px-3 py-2.5 text-[12px] text-zinc-500 font-mono bg-zinc-800/80 border-l border-zinc-700 flex-shrink-0 select-none">
                    .vercel.app
                  </span>
                </div>
                <div className="mt-1.5 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] text-zinc-600">
                      Your app will be live at{' '}
                      <span className="text-indigo-400 font-mono">{displayUrl}</span>
                    </p>
                    {slugStatus === 'yours' && (existingAliases.length > 0 || !loadingAliases) && (
                      <a
                        href={`https://${displayUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open ${displayUrl}`}
                        className="flex-shrink-0 text-zinc-600 hover:text-indigo-400 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>
                  {slugHint && (
                    <span className="text-[11px] font-medium block">{slugHint}</span>
                  )}
                </div>
              </div>

              {/* Custom domain (optional) */}
              <div>
                <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                  Custom Domain <span className="normal-case font-normal text-zinc-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && deployState === 'idle') handleDeploy(); }}
                  placeholder="app.yoursite.com"
                  spellCheck={false}
                  disabled={isLoading}
                  className="w-full bg-zinc-800 border border-zinc-700 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none transition-colors font-mono"
                />
                {customDomain.trim() && (() => {
                  const d = customDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
                  const isApex = d.split('.').length === 2;
                  return (
                    <>
                      {isApex && (
                        <p className="text-[11px] text-indigo-400 mt-1.5">
                          Both <span className="font-mono">{d}</span> and <span className="font-mono">www.{d}</span> will be attached.
                        </p>
                      )}
                      <DnsInstructions domain={d} />
                    </>
                  );
                })()}
              </div>

              {/* Manage existing domains — shown when project is already deployed */}
              {slugStatus === 'yours' && (existingAliases.length > 0 || loadingAliases) && (
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                    Active Domains
                  </label>
                  {loadingAliases ? (
                    <div className="flex items-center gap-2 text-[11px] text-zinc-600 py-1">
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                      </svg>
                      Loading…
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {existingAliases.map((alias) => (
                        <AliasRow
                          key={alias}
                          alias={alias}
                          isDisconnecting={!!disconnecting}
                          onDisconnect={() => setShowDeleteConfirm(true)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Supabase note */}
              {storageMode === 'supabase' && (
                <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-[11px] text-emerald-300 leading-relaxed">
                    Supabase credentials are injected automatically — your deployed app will connect to the same database as the preview.
                  </p>
                </div>
              )}
            </>
          ) : null}

          {/* ── Confirm step ── */}
          {deployState === 'confirm' && (
            <div className="space-y-3">
              <p className="text-[12px] text-zinc-400 leading-relaxed">
                Review your deployment settings before building.
              </p>

              {/* Primary subdomain */}
              <div className="rounded-lg border border-zinc-700/60 bg-zinc-800/50 overflow-hidden">
                <div className="px-3 py-2 border-b border-zinc-700/40 flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-zinc-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                    {isRename ? 'Renaming & deploying to' : 'Deploying to'}
                  </span>
                </div>
                <div className="px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                    <span className="text-[12px] font-mono text-zinc-100">{confirmedSlug}.vercel.app</span>
                  </div>
                  {isRename && (
                    <div className="flex items-center gap-2 pl-3">
                      <span className="text-[10px] text-zinc-500 font-mono">renamed from</span>
                      <span className="text-[10px] font-mono text-zinc-400 line-through">{previousDeployName}.vercel.app</span>
                    </div>
                  )}
                  {confirmedCustomDomains.map((d) => (
                    <div key={d} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                      <span className="text-[12px] font-mono text-zinc-300">{d}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subdomain taken warning */}
              {slugStatus === 'available' && !aliasAvailable && (
                <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-[11px] text-amber-300 leading-relaxed">
                    <span className="font-mono">{confirmedSlug}.vercel.app</span> is already taken by another Vercel user. Your app will be deployed with a different URL — go back and try a more unique subdomain.
                  </p>
                </div>
              )}

              {/* Update notice */}
              {slugStatus === 'yours' && !isRename && (
                <div className="flex items-start gap-2 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                  <svg className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-[11px] text-indigo-300 leading-relaxed">
                    This will update your existing deployment at <span className="font-mono">{confirmedSlug}.vercel.app</span>.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex flex-col gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-[12px] text-red-400">{error}</p>
              </div>
              {inspectorUrl && (
                <a
                  href={inspectorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-5 inline-flex items-center gap-1 text-[11px] text-red-300/70 hover:text-red-300 underline underline-offset-2 transition-colors"
                >
                  View build logs on Vercel
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          )}

          {/* Uploading spinner */}
          {deployState === 'deploying' && (
            <div className="flex items-center gap-3 py-1">
              <svg className="w-4 h-4 animate-spin text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
              </svg>
              <p className="text-[13px] text-zinc-400">Uploading to Vercel…</p>
            </div>
          )}

          {/* Live URLs */}
          {(deployState === 'building' || deployState === 'ready') && (
            <div className="space-y-3">
              {/* Build status badge */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Deployment</span>
                {deployState === 'ready' ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                    Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
                    <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                    </svg>
                    {buildStatus || 'Building'}
                  </span>
                )}
              </div>

              {/* Primary URL row */}
              {deployUrl && (
                <UrlRow
                  label="Your URL"
                  url={deployUrl}
                  copied={copiedUrl === deployUrl}
                  onCopy={() => handleCopy(deployUrl)}
                  isDisconnecting={!!disconnecting}
                  onDisconnect={deployState === 'ready' ? () => setShowDeleteConfirm(true) : undefined}
                />
              )}

              {/* Custom domain rows */}
              {customDomainUrls.map((url, i) => (
                <UrlRow
                  key={url}
                  label={i === 0 ? 'Custom Domain' : 'Custom Domain (www)'}
                  url={url}
                  copied={copiedUrl === url}
                  onCopy={() => handleCopy(url)}
                  isDisconnecting={!!disconnecting}
                  onDisconnect={deployState === 'ready' ? () => setShowDeleteConfirm(true) : undefined}
                />
              ))}

              {deployState === 'building' && (
                <p className="text-[11px] text-zinc-600">Vercel is building your app — usually ready in 1–2 min.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-zinc-800">
          {deployState === 'error' ? (
            <>
              <button onClick={handleRetry} className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">Try Again</button>
              <button onClick={onClose} className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors">Close</button>
            </>
          ) : deployState === 'ready' ? (
            <ReadyFooter onClose={onClose} onDeleteRequest={() => setShowDeleteConfirm(true)} isDeleting={!!disconnecting} />
          ) : deployState === 'confirm' ? (
            <>
              <button
                onClick={() => setDeployState('idle')}
                className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Back
              </button>
              <button
                onClick={executeDeploy}
                className="flex-1 py-2 text-[13px] font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 transition-colors flex items-center justify-center gap-2"
              >
                <svg viewBox="0 0 76 65" className="w-3.5 h-3.5" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>
                Confirm & Deploy
              </button>
            </>
          ) : (
            <>
              {slugStatus === 'yours' ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isLoading || !!disconnecting}
                  className="py-2 px-3 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 border border-zinc-700 hover:border-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 flex-shrink-0"
                  title="Delete this Vercel project"
                >
                  {disconnecting ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              ) : (
                <button onClick={isLoading ? undefined : onClose} disabled={isLoading} className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  Cancel
                </button>
              )}
              <button
                onClick={handleDeploy}
                disabled={isLoading || !subdomain.trim()}
                className="flex-1 py-2 text-[13px] font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/></svg>Deploying…</>
                ) : (
                  <><svg viewBox="0 0 76 65" className="w-3.5 h-3.5" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>{slugStatus === 'yours' ? 'Update' : 'Deploy'}</>
                )}
              </button>
              {slugStatus === 'yours' && (
                <button onClick={isLoading ? undefined : onClose} disabled={isLoading} className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Row for an existing alias with a disconnect button */
function AliasRow({ alias, isDisconnecting, onDisconnect }: {
  alias: string;
  isDisconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg">
      <span className="flex-1 text-[11px] font-mono text-zinc-300 truncate">{alias}</span>
      <button
        onClick={onDisconnect}
        disabled={isDisconnecting}
        title="Delete project from Vercel"
        className="flex-shrink-0 flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded transition-colors disabled:opacity-40 bg-zinc-700/50 border border-zinc-600/50 text-zinc-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10"
      >
        {isDisconnecting ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
          </svg>
        ) : (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        )}
        {isDisconnecting ? 'Deleting…' : 'Delete project'}
      </button>
    </div>
  );
}

function DnsInstructions({ domain }: { domain: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  // Apex domain = only one dot (e.g. example.com); subdomain = 2+ dots or explicit prefix
  const parts = domain.replace(/^https?:\/\//, '').split('.');
  const isApex = parts.length === 2;

  // Apex: needs A record for @ AND CNAME for www
  // Subdomain: only needs CNAME (no A record required)
  const records = isApex
    ? [
        { type: 'A',     host: '@',   value: '76.76.21.21',        note: 'root domain' },
        { type: 'CNAME', host: 'www', value: 'cname.vercel-dns.com', note: 'www redirect' },
      ]
    : [{ type: 'CNAME', host: parts.slice(0, -2).join('.') || 'www', value: 'cname.vercel-dns.com', note: '' }];

  function copy(val: string) {
    navigator.clipboard.writeText(val);
    setCopied(val);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-amber-500/15">
        <svg className="w-3 h-3 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[11px] font-semibold text-amber-400">DNS Configuration Required</span>
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-[11px] text-zinc-400">
          {isApex
            ? 'Add both records in your domain registrar\'s DNS settings:'
            : 'Add this record in your domain registrar\'s DNS settings (no A record needed for subdomains):'}
        </p>
        <div className="grid grid-cols-[auto_auto_1fr_auto] gap-x-3 gap-y-1.5 items-center">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Type</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Host</span>
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Value</span>
          <span />
          {records.map((r, i) => (
            <>
              <span key={`t-${i}`} className="text-[11px] font-mono font-semibold text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded px-1.5 py-0.5 w-fit">{r.type}</span>
              <span key={`h-${i}`} className="text-[11px] font-mono text-zinc-300">{r.host}</span>
              <div key={`v-${i}`} className="min-w-0">
                <span className="text-[11px] font-mono text-zinc-200 truncate block">{r.value}</span>
                {r.note && <span className="text-[10px] text-zinc-600">{r.note}</span>}
              </div>
              <button
                key={`c-${i}`}
                onClick={() => copy(r.value)}
                title="Copy value"
                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors flex-shrink-0"
              >
                {copied === r.value
                  ? <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                  : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                }
              </button>
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReadyFooter({ onClose, onDeleteRequest, isDeleting }: {
  onClose: () => void;
  onDeleteRequest: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="flex gap-3 w-full">
      <button
        onClick={onDeleteRequest}
        disabled={isDeleting}
        className="flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 border border-zinc-700 hover:border-red-500/30"
      >
        {isDeleting ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        )}
        {isDeleting ? 'Deleting…' : 'Delete project'}
      </button>
      <button onClick={onClose} className="flex-1 py-2 text-[13px] font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors">
        Done
      </button>
    </div>
  );
}

function UrlRow({ label, url, copied, onCopy, isDisconnecting, onDisconnect }: {
  label: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
  isDisconnecting?: boolean;
  onDisconnect?: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">{label}</p>
      <div className="flex items-center gap-2 p-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-lg">
        <p className="flex-1 text-[12px] text-indigo-300 font-mono truncate">{url}</p>
        <button onClick={onCopy} title="Copy" className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors flex-shrink-0">
          {copied ? (
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          )}
        </button>
        <a href={url} target="_blank" rel="noreferrer" title="Open" className="p-1.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors flex-shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        </a>
        {onDisconnect && (
          <button
            onClick={onDisconnect}
            disabled={isDisconnecting}
            title="Delete project from Vercel"
            className="p-1.5 rounded transition-colors flex-shrink-0 disabled:opacity-40 text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
          >
            {isDisconnecting ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
