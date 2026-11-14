import { notFound } from "next/navigation";
import { getTalent } from "@/lib/db";
import { InquiryForm } from "@/components/InquiryForm";

export const dynamic = "force-dynamic";

export default async function TalentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const talent = getTalent(id);
  if (!talent) notFound();

  return (
    <div className="profile">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="portrait" src={`/api/photos/${talent.id}`} alt={`Portrait of ${talent.name}`} />
      <div>
        <p className="eyebrow">{talent.category}</p>
        <h1>{talent.name}</h1>
        <dl className="facts">
          <div>
            <dt>Based in</dt>
            <dd>{talent.city}</dd>
          </div>
          {talent.height_cm && (
            <div>
              <dt>Height</dt>
              <dd>{talent.height_cm} cm</dd>
            </div>
          )}
        </dl>
        {talent.bio && <p className="bio">{talent.bio}</p>}
        <h2>Send an inquiry</h2>
        <p className="hint">
          {talent.name}&apos;s contact details are private. Your message is delivered through the
          platform.
        </p>
        <InquiryForm talentId={talent.id} talentName={talent.name} />
      </div>
    </div>
  );
}
