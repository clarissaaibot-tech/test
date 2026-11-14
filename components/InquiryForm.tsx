"use client";

import { useState } from "react";

export function InquiryForm({ talentId, talentName }: { talentId: string; talentName: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("sending");
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/talents/${talentId}/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't send. Try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="notice ok" role="status">
        Inquiry sent. {talentName} will reply to your email if they&apos;re interested.
      </div>
    );
  }

  return (
    <form className="form" style={{ marginTop: 14 }} onSubmit={submit}>
      <div className="row">
        <label className="field">
          <span>Your name</span>
          <input type="text" name="fromName" required maxLength={80} />
        </label>
        <label className="field">
          <span>Your email</span>
          <input type="email" name="fromEmail" required maxLength={120} />
        </label>
      </div>
      <label className="field">
        <span>Message</span>
        <textarea name="message" required maxLength={1500} placeholder="Role, company, what you have in mind…" />
      </label>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div>
        <button className="btn" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send inquiry"}
        </button>
      </div>
    </form>
  );
}
