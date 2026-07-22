export function UploadDropzone({ onFile }: { onFile: (file: File) => void }) {
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  };

  return (
    <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-hairline-strong bg-surface p-6 text-center transition-colors hover:border-gold/50 hover:bg-surface-raised">
      <span className="text-sm font-medium text-ink">Upload a photo</span>
      <span className="mt-1 text-xs text-ink-tertiary">or use your camera</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Upload a photo"
        onChange={handle}
      />
    </label>
  );
}
