"use client";

import Link from "next/link";
import { useState } from "react";
import { PhotoPicker } from "@/components/PhotoPicker";
import { describeFace, FaceError } from "@/lib/face";
import { CATEGORIES } from "@/lib/site";

export default function JoinPage() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [faceConsent, setFaceConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; token: string; faceConsent: boolean } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    if (!photo) {
      setError("Add a photo of yourself to continue.");
      return;
    }
    form.set("photo", photo);
    try {
      if (faceConsent) {
        setBusy("Reading your photo…");
        form.set("descriptor", JSON.stringify(await describeFace(photo)));
      }
      setBusy("Creating your profile…");
      const res = await fetch("/api/talents", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new FaceError(data.error ?? "Something went wrong. Try again.");
      setDone({ ...data, faceConsent });
    } catch (err) {
      setError(
        err instanceof FaceError
          ? err.message
          : "We couldn't create your profile. Check your connection and try again."
      );
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    const manageUrl = `${window.location.origin}/manage/${done.token}`;
    return (
      <div className="narrow">
        <p className="eyebrow">You&apos;re in</p>
        <h1>Your profile is live.</h1>
        <div className="panel" style={{ marginTop: 28 }}>
          <h2>Save your private link</h2>
          <p>
            This link is the only way to manage your profile: switch face search{" "}
            {done.faceConsent ? "off" : "on"}, read inquiries, or delete everything. It is shown
            only once, so keep it somewhere safe.
          </p>
          <code className="linkbox">{manageUrl}</code>
          <div className="actions">
            <button className="btn" onClick={() => navigator.clipboard?.writeText(manageUrl)}>
              Copy link
            </button>
            <Link className="btn ghost" href={`/talent/${done.id}`}>
              View my profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="narrow">
      <p className="eyebrow">For talents</p>
      <h1>Create your profile.</h1>
      <p className="lede">
        You decide what casting teams see. Contact details stay private; inquiries reach you
        through the platform.
      </p>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input type="text" name="name" required maxLength={80} autoComplete="name" />
        </label>
        <div className="row">
          <label className="field">
            <span>Category</span>
            <select name="category" required defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>City</span>
            <input type="text" name="city" required maxLength={60} placeholder="Kuala Lumpur" />
          </label>
        </div>
        <label className="field">
          <span>
            Height in cm <small>(optional)</small>
          </span>
          <input type="number" name="heightCm" min={100} max={230} inputMode="numeric" />
        </label>
        <label className="field">
          <span>
            About you <small>(optional)</small>
          </span>
          <textarea name="bio" maxLength={600} placeholder="Experience, languages, skills…" />
        </label>

        <div className="field">
          <span>Your photo</span>
          <PhotoPicker
            file={photo}
            onChange={setPhoto}
            title="Choose a photo"
            hint="Clear, front-facing, just you. JPG, PNG or WebP up to 5 MB."
          />
        </div>

        <label className="check">
          <input type="checkbox" name="confirmAdultOwnPhoto" value="yes" required />
          <span>
            <strong>I am 18 or older and this is a photo of me.</strong>
            <span className="hint">Profiles made with someone else&apos;s photo are removed.</span>
          </span>
        </label>

        <label className="check optional">
          <input
            type="checkbox"
            name="faceConsent"
            value="yes"
            checked={faceConsent}
            onChange={(e) => setFaceConsent(e.target.checked)}
          />
          <span>
            <strong>
              Include me in lookalike search <span className="tag">Optional</span>
            </strong>
            <span className="hint">
              I agree that the platform analyses the facial features in my photo and stores the
              result, only so casting teams can find me when they search with a similar-looking
              reference photo. It is not used for anything else or shared. I can switch this off
              at any time, which deletes the stored face data. My profile works either way.
            </span>
          </span>
        </label>

        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div>
          <button className="btn" type="submit" disabled={busy !== null}>
            {busy ?? "Create profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
