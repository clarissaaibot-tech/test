"use client";

import Link from "next/link";
import { useState } from "react";
import { PhotoPicker } from "@/components/PhotoPicker";
import { TalentCard } from "@/components/TalentCard";
import { describeFace, FaceError } from "@/lib/face";

type Match = { id: string; name: string; headline: string; city: string; skills: string[]; score: number };

export default function SearchPage() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);

  function pick(file: File | null) {
    setPhoto(file);
    setMatches(null);
    setError(null);
  }

  async function search() {
    if (!photo) return;
    setError(null);
    setMatches(null);
    try {
      setBusy("Reading the photo…");
      const descriptor = await describeFace(photo);
      setBusy("Searching…");
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor }),
      });
      const data = await res.json();
      if (!res.ok) throw new FaceError(data.error ?? "Search failed. Try again.");
      setMatches(data.matches);
    } catch (err) {
      setError(
        err instanceof FaceError
          ? err.message
          : "The search didn't go through. Check your connection and try again."
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="narrow">
        <p className="eyebrow">Lookalike search</p>
        <h1>Search by face.</h1>
        <p className="lede">
          Upload a reference photo and see which talents look most like it. Only talents who
          opted in appear in results.
        </p>
        <div className="form">
          <PhotoPicker
            file={photo}
            onChange={pick}
            title="Choose a reference photo"
            hint="One clear, front-facing face works best."
          />
          <div className="notice info">
            Your reference photo is analysed on this device. It is never uploaded or stored.
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <div>
            <button className="btn" onClick={search} disabled={!photo || busy !== null}>
              {busy ?? "Find lookalikes"}
            </button>
          </div>
        </div>
      </div>

      {matches && (
        <section style={{ marginTop: 44 }} aria-live="polite">
          <div className="section-head">
            <h2>Closest matches</h2>
            <span className="count">
              {matches.length} {matches.length === 1 ? "result" : "results"}
            </span>
          </div>
          {matches.length === 0 ? (
            <div className="empty">
              No talents have switched on lookalike search yet. <Link href="/">Browse all talents</Link>.
            </div>
          ) : (
            <div className="grid">
              {matches.map((m) => (
                <TalentCard key={m.id} {...m} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
