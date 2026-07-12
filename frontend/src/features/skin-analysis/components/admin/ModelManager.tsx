import { useEffect, useState } from 'react';

export default function ModelManager({ apiBase = '' }: { apiBase?: string }) {
  const [manifest, setManifest] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [modelId, setModelId] = useState('');
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    void fetch(`${apiBase}/api/models/manifest`).then((r) => r.json()).then((j) => setManifest(j.data || []));
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
      <h3 className="font-semibold mb-2">Model Manager</h3>
      <div className="mb-3">
        <input placeholder="model id" value={modelId} onChange={(e) => setModelId(e.target.value)} className="border p-1 mr-2" />
        <input type="file" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} />
        <input placeholder="version (optional)" value={version} onChange={(e) => setVersion(e.target.value)} className="border p-1 ml-2" />
        <button onClick={upload} className="ml-2 bg-clinical text-white px-3 py-1 rounded">Upload & Promote</button>
      </div>
      <div className="mb-2">Status: {status}</div>
      <div>
        {manifest.map((m) => (
          <div key={m.id} className="mb-2 border p-2 rounded">
            <div className="font-bold">{m.name} ({m.id})</div>
            <div className="text-sm">Current: {m.currentVersion}</div>
            <div className="mt-1 flex gap-2">
              {m.versions.map((v: any) => (
                <div key={v.id} className="border p-1 rounded">
                  <div className="text-xs">{v.version}</div>
                  <div className="text-xs">{v.isCurrent ? 'current' : ''} {v.isStable ? 'stable' : ''}</div>
                  <div className="mt-1">
                    {!v.isCurrent && (
                      <button onClick={() => promote(m.id, v.id)} className="text-xs mr-2">Promote</button>
                    )}
                    <button onClick={() => rollback(m.id)} className="text-xs">Rollback</button>
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
