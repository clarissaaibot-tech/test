"use client";

import Link from "next/link";
import { useState } from "react";
import { PhotoPicker } from "@/components/PhotoPicker";
import { describeFace, FaceError } from "@/lib/face";
import { INDUSTRIES, OPEN_TO } from "@/lib/site";

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
        You decide what employers see. Contact details stay private; inquiries reach you
        through the platform.
      </p>

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input type="text" name="name" required maxLength={80} autoComplete="name" />
        </label>
        <label className="field">
          <span>Current or target role</span>
          <input type="text" name="headline" required maxLength={100} placeholder="Product Designer" />
        </label>
        <div className="row">
          <label className="field">
            <span>Industry</span>
            <select name="category" required defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              {INDUSTRIES.map((c) => (
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
          <span>Skills</span>
          <input type="text" name="skills" required maxLength={400} placeholder="Figma, user research, prototyping" />
          <small>Separate with commas, up to 12.</small>
        </label>
        <label className="field">
          <span>
            Years of experience <small>(optional)</small>
          </span>
          <input type="number" name="yearsExp" min={0} max={60} inputMode="numeric" />
        </label>
        <fieldset className="field options">
          <legend className="label">
            Open to <small className="hint">(optional)</small>
          </legend>
          {OPEN_TO.map((o) => (
            <label key={o}>
              <input type="checkbox" name="openTo" value={o} /> {o}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>
            About you <small>(optional)</small>
          </span>
          <textarea name="bio" maxLength={600} placeholder="Projects, achievements, what you want next…" />
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
              result, only so people searching with a similar-looking
              reference photo can find me. It is not used for anything else or shared. I can switch this off
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
