"use client";

import { useEffect, useState } from "react";

export function PhotoPicker(props: {
  file: File | null;
  onChange: (file: File | null) => void;
  title: string;
  hint: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!props.file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(props.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [props.file]);

  return (
    <label className="drop">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => props.onChange(e.target.files?.[0] ?? null)}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={preview} alt="Selected photo preview" />
      ) : (
        <span className="thumb blank" aria-hidden>
          +
        </span>
      )}
      <span>
        <span className="label">{props.file ? props.file.name : props.title}</span>
        <br />
        <span className="hint">{props.file ? "Tap to choose a different photo" : props.hint}</span>
      </span>
    </label>
  );
}
