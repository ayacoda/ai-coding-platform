import { useState } from 'react';
import { useStore } from '../store/useStore';
import { KNOWN_INTEGRATIONS } from '../lib/integrations';

interface EnvVarsModalProps {
  onClose: () => void;
}

export default function EnvVarsModal({ onClose }: EnvVarsModalProps) {
  const { projectSecrets, setProjectSecret, removeProjectSecret } = useStore();

  // Local editable state — changes commit to store immediately on blur/enter
  const [localVars, setLocalVars] = useState<Record<string, string>>(() => ({ ...projectSecrets }));
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [customKey, setCustomKey] = useState('');
  const [customVal, setCustomVal] = useState('');
  const [customErr, setCustomErr] = useState('');

  // All keys currently in local state
  const currentKeys = Object.keys(localVars);

  // Known integration keys not yet added
  const availableIntegrations = KNOWN_INTEGRATIONS.filter(
    (def) => !def.keys.every((k) => currentKeys.includes(k.envName))
  );

  function commit(key: string, value: string) {
    setLocalVars((v) => ({ ...v, [key]: value }));
    setProjectSecret(key, value);
  }

  function removeKey(key: string) {
    setLocalVars((v) => {
      const next = { ...v };
      delete next[key];
      return next;
    });
    removeProjectSecret(key);
  }

  function addIntegration(integration: typeof KNOWN_INTEGRATIONS[0]) {
    const newVars: Record<string, string> = {};
    for (const k of integration.keys) {
      if (!currentKeys.includes(k.envName)) {
        newVars[k.envName] = '';
      }
    }
    setLocalVars((v) => ({ ...v, ...newVars }));
  }

  function handleAddCustom() {
    const key = customKey.trim().toUpperCase().replace(/\s+/g, '_');
    if (!key) { setCustomErr('Key name is required'); return; }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) { setCustomErr('Use only letters, numbers, and underscores'); return; }
    if (localVars[key] !== undefined) { setCustomErr('Key already exists'); return; }
    setCustomErr('');
    setLocalVars((v) => ({ ...v, [key]: customVal }));
    setProjectSecret(key, customVal);
    setCustomKey('');
    setCustomVal('');
  }

  // Get the label for a key from known integrations
  function getLabelForKey(envName: string): { label: string; hint?: string; isSecret?: boolean } | null {
    for (const def of KNOWN_INTEGRATIONS) {
      const kd = def.keys.find((k) => k.envName === envName);
      if (kd) return { label: `${def.service} — ${kd.name}`, hint: kd.hint, isSecret: kd.isSecret !== false };
    }
    return null;
  }

  const isSecret = (key: string) => {
    const meta = getLabelForKey(key);
    if (meta) return meta.isSecret !== false;
    return true; // custom keys are masked by default
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-100">Project API Keys</h2>
            <p className="text-[12px] text-zinc-500 mt-0.5">
              Accessible in your app as <code className="text-zinc-400">window.ENV.KEY_NAME</code>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">

          {/* Current keys */}
          {currentKeys.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Configured Keys
              </h3>
              <div className="space-y-2">
                {currentKeys.map((key) => {
                  const meta = getLabelForKey(key);
                  const masked = isSecret(key) && !visible[key];
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <div className="flex-1 space-y-0.5">
                        <p className="text-[11px] text-zinc-500 font-mono">{key}</p>
                        {meta?.label && (
                          <p className="text-[10px] text-zinc-600">{meta.label}</p>
                        )}
                        <div className="relative">
                          <input
                            type={masked ? 'password' : 'text'}
                            value={localVars[key] ?? ''}
                            onChange={(e) => {
                              setLocalVars((v) => ({ ...v, [key]: e.target.value }));
                            }}
                            onBlur={(e) => commit(key, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') commit(key, localVars[key] ?? ''); }}
                            placeholder={meta ? '' : 'value'}
                            spellCheck={false}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 pr-8 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500 transition-colors font-mono"
                          />
                          {isSecret(key) && (
                            <button
                              type="button"
                              onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              {!masked ? (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                </svg>
                              ) : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                        {meta?.hint && (
                          <p className="text-[10px] text-zinc-600">
                            Find it: {meta.hint}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => removeKey(key)}
                        className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors flex-shrink-0"
                        title="Remove key"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add integration */}
          {availableIntegrations.length > 0 && (
            <div>
              <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                Add Integration
              </h3>
              <div className="flex flex-wrap gap-2">
                {availableIntegrations.map((def) => (
                  <button
                    key={def.service}
                    onClick={() => addIntegration(def)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-[12px] text-zinc-300 transition-colors"
                  >
                    <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    {def.service}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom key */}
          <div>
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              Custom Key
            </h3>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <input
                  type="text"
                  value={customKey}
                  onChange={(e) => { setCustomKey(e.target.value); setCustomErr(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustom(); }}
                  placeholder="MY_API_KEY"
                  spellCheck={false}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500 transition-colors font-mono"
                />
                {customErr && <p className="text-[11px] text-red-400 mt-1">{customErr}</p>}
              </div>
              <input
                type="text"
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustom(); }}
                placeholder="value"
                spellCheck={false}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500 transition-colors font-mono"
              />
              <button
                onClick={handleAddCustom}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 rounded-lg text-[12px] text-zinc-300 transition-colors flex-shrink-0"
              >
                Add
              </button>
            </div>
          </div>

          {currentKeys.length === 0 && (
            <div className="text-center py-4 text-zinc-600 text-[13px]">
              No keys configured yet. Add an integration above or enter a custom key.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <p className="text-[12px] text-zinc-600">
            Keys are stored locally and injected into the preview sandbox
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
