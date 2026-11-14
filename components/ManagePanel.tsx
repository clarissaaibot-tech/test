"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeFace, FaceError } from "@/lib/face";

export function ManagePanel(props: { token: string; talentId: string; faceConsent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function act(body: object) {
    const res = await fetch(`/api/manage/${props.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new FaceError(data.error ?? "That didn't work. Try again.");
  }

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof FaceError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const switchOn = () =>
    run("Reading your photo…", async () => {
      const descriptor = await describeFace(`/api/photos/${props.talentId}`);
      await act({ action: "giveFaceConsent", descriptor });
      router.refresh();
    });

  const switchOff = () =>
    run("Switching off…", async () => {
      await act({ action: "withdrawFaceConsent" });
      router.refresh();
    });

  const remove = () =>
    run("Deleting…", async () => {
      await act({ action: "deleteProfile" });
      router.push("/");
      router.refresh();
    });

  return (
    <>
      <div className="panel">
        <h2>Lookalike search</h2>
        <p className={`status ${props.faceConsent ? "on" : ""}`}>
          {props.faceConsent ? "On: you appear in face search results" : "Off: you are not in face search"}
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          {props.faceConsent
            ? "Switching this off deletes the stored analysis of your face. Your profile stays in the directory."
            : "Switching this on analyses the facial features in your profile photo and stores the result, only so casting teams can find you by a similar-looking reference photo."}
        </p>
        <div className="actions">
          {props.faceConsent ? (
            <button className="btn ghost" onClick={switchOff} disabled={busy !== null}>
              Switch off and delete face data
            </button>
          ) : (
            <button className="btn" onClick={switchOn} disabled={busy !== null}>
              I agree, switch on
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Delete profile</h2>
        <p className="hint">
          Removes your profile, photo, face data and inquiries. This can&apos;t be undone.
        </p>
        <div className="actions">
          {confirmDelete ? (
            <>
              <button className="btn danger" onClick={remove} disabled={busy !== null}>
                Yes, delete everything
              </button>
              <button className="btn ghost" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>
                Keep my profile
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={() => setConfirmDelete(true)}>
              Delete my profile
            </button>
          )}
        </div>
      </div>

      {busy && (
        <p className="hint" role="status" style={{ marginTop: 14 }}>
          {busy}
        </p>
      )}
      {error && (
        <div className="notice error" role="alert" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}
    </>
  );
}
