import { useEffect, useState } from 'react';

export default function ModelManager({ apiBase = '' }: { apiBase?: string }) {
  const [manifest, setManifest] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [modelId, setModelId] = useState('');
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState('');

  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    void fetch(`${apiBase}/api/models/manifest`).then((r) => r.json()).then((j) => setManifest(j.data || []));
    // Check auth state to show/hide admin controls
    void fetch(`${apiBase}/api/auth/status`).then((r) => r.json()).then((j) => setAuthed(Boolean(j.authenticated)) ).catch(() => setAuthed(false));
  }, [apiBase]);

  async function upload() {
    if (!selectedFile || !modelId) return setStatus('modelId and file required');
    setStatus('uploading...');
    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('version', version || selectedFile.name);
    fd.append('setCurrent', 'true');
    const res = await fetch(`${apiBase}/api/models/${encodeURIComponent(modelId)}/upload`, { method: 'POST', body: fd });
    const j = await res.json();
    if (!res.ok) setStatus(j.error || 'upload failed');
    else setStatus('uploaded');
    // refresh manifest
    const m = await (await fetch(`${apiBase}/api/models/manifest`)).json();
    setManifest(m.data || []);
  }

  async function promote(mid: string, vid: string) {
    await fetch(`${apiBase}/api/models/${encodeURIComponent(mid)}/promote/${encodeURIComponent(vid)}`, { method: 'POST' });
    const m = await (await fetch(`${apiBase}/api/models/manifest`)).json();
    setManifest(m.data || []);
  }

  async function rollback(mid: string) {
    await fetch(`${apiBase}/api/models/${encodeURIComponent(mid)}/rollback`, { method: 'POST' });
    const m = await (await fetch(`${apiBase}/api/models/manifest`)).json();
    setManifest(m.data || []);
  }

  return (
    <div className="p-4">
      <h3 className="mb-3 font-serif text-lg font-semibold tracking-tight text-ink">Model Manager</h3>
      <div className="mb-4">
        {authed ? (
          <div className="flex flex-wrap items-center gap-2">
            <input placeholder="model id" value={modelId} onChange={(e) => setModelId(e.target.value)} className="field max-w-[10rem]" />
            <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} className="text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:text-ink" />
            <input placeholder="version (optional)" value={version} onChange={(e) => setVersion(e.target.value)} className="field max-w-[12rem]" />
            <button onClick={upload} className="btn-primary">Upload & Promote</button>
          </div>
        ) : (
          <div className="text-sm text-ink-secondary">Admin actions require login. Use /api/auth/login to authenticate.</div>
        )}
      </div>
      <div className="mb-3 text-sm text-ink-secondary">Status: <span className="text-ink">{status}</span></div>
      <div className="space-y-3">
        {manifest.map((m) => (
          <div key={m.id} className="card p-3">
            <div className="font-bold text-ink">{m.name} <span className="font-mono text-xs font-normal text-ink-tertiary">({m.id})</span></div>
            <div className="text-sm text-ink-secondary">Current: <span className="font-mono">{m.currentVersion}</span></div>
            <div className="mt-2 flex flex-wrap gap-2">
              {m.versions.map((v: any) => (
                <div key={v.id} className="rounded-lg border border-hairline bg-surface-raised p-2">
                  <div className="font-mono text-xs text-ink">{v.version}</div>
                  <div className="text-xs text-gold">{v.isCurrent ? 'current' : ''} {v.isStable ? 'stable' : ''}</div>
                  <div className="mt-1 flex gap-2">
                    {!v.isCurrent && authed && (
                      <button onClick={() => promote(m.id, v.id)} className="text-xs font-medium text-gold-bright hover:underline">Promote</button>
                    )}
                    {authed && <button onClick={() => rollback(m.id)} className="text-xs font-medium text-ink-secondary hover:text-ink">Rollback</button>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
