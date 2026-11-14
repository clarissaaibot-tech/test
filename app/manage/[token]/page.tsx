import Link from "next/link";
import { notFound } from "next/navigation";
import { getTalentByToken, listInquiries } from "@/lib/db";
import { ManagePanel } from "@/components/ManagePanel";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const talent = getTalentByToken(token);
  if (!talent) notFound();
  const inquiries = listInquiries(talent.id);

  return (
    <div className="narrow">
      <p className="eyebrow">Private page</p>
      <h1>Hi, {talent.name}.</h1>
      <p className="lede">
        Anyone with this link can manage your profile, so don&apos;t share it.{" "}
        <Link href={`/talent/${talent.id}`}>View your public profile</Link>.
      </p>

      <div style={{ marginTop: 28 }}>
        <ManagePanel token={token} talentId={talent.id} faceConsent={talent.face_consent === 1} />
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2>Inquiries</h2>
        {inquiries.length === 0 ? (
          <p className="hint">No inquiries yet. They&apos;ll show up here.</p>
        ) : (
          inquiries.map((q) => (
            <div className="inquiry" key={q.id}>
              <div className="who">
                {q.from_name} · <a href={`mailto:${q.from_email}`}>{q.from_email}</a>
              </div>
              <div className="when">{new Date(q.created_at).toLocaleString("en-MY")}</div>
              <p>{q.message}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
