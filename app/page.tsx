import Link from "next/link";
import { listTalents } from "@/lib/db";
import { TalentCard } from "@/components/TalentCard";

export const dynamic = "force-dynamic";

export default function Home() {
  const talents = listTalents();
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Casting, with consent</p>
        <h1>Find the face the role needs.</h1>
        <p className="lede">
          Browse talents who registered themselves, or upload a reference photo to find the
          people here who look most like it.
        </p>
        <div className="hero-actions">
          <Link href="/search" className="btn">
            Find a lookalike
          </Link>
          <Link href="/join" className="btn ghost">
            Join as talent
          </Link>
        </div>
      </section>

      <div className="section-head">
        <h2>Talents</h2>
        <span className="count">
          {talents.length} {talents.length === 1 ? "profile" : "profiles"}
        </span>
      </div>
      {talents.length === 0 ? (
        <div className="empty">
          No talents yet. <Link href="/join">Create the first profile</Link>.
        </div>
      ) : (
        <div className="grid">
          {talents.map((t) => (
            <TalentCard key={t.id} id={t.id} name={t.name} category={t.category} city={t.city} />
          ))}
        </div>
      )}
    </>
  );
}
