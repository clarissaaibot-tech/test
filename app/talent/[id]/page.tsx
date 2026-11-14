import { notFound } from "next/navigation";
import { getTalent } from "@/lib/db";
import { InquiryForm } from "@/components/InquiryForm";

export const dynamic = "force-dynamic";

export default async function TalentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const talent = await getTalent(id);
  if (!talent) notFound();

  return (
    <div className="profile">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="portrait" src={`/api/photos/${talent.id}`} alt={`Photo of ${talent.name}`} />
      <div>
        <p className="eyebrow">
          {talent.category}
          {talent.is_sample && <span className="tag">Sample profile</span>}
        </p>
        <h1>{talent.name}</h1>
        <p className="lede">{talent.headline}</p>
        <dl className="facts">
          <div>
            <dt>Based in</dt>
            <dd>{talent.city}</dd>
          </div>
          {talent.years_exp !== null && (
            <div>
              <dt>Experience</dt>
              <dd>
                {talent.years_exp} {talent.years_exp === 1 ? "year" : "years"}
              </dd>
            </div>
          )}
          {talent.open_to.length > 0 && (
            <div>
              <dt>Open to</dt>
              <dd>{talent.open_to.join(", ")}</dd>
            </div>
          )}
        </dl>
        <div className="chips" style={{ marginBottom: 20 }}>
          {talent.skills.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
        {talent.bio && <p className="bio">{talent.bio}</p>}
        {talent.is_sample ? (
          <div className="notice info">
            This is a sample profile for demonstration. The person and photo are fictional.
          </div>
        ) : (
          <>
            <h2>Send an inquiry</h2>
            <p className="hint">
              {talent.name}&apos;s contact details are private. Your message is delivered through
              the platform.
            </p>
            <InquiryForm talentId={talent.id} talentName={talent.name} />
          </>
        )}
      </div>
    </div>
  );
}
