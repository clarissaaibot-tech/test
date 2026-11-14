import Link from "next/link";
import { listTalents } from "@/lib/db";
import { TalentCard } from "@/components/TalentCard";
import { INDUSTRIES, SITE_TAGLINE } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; industry?: string; city?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const city = (sp.city ?? "").trim().slice(0, 60);
  const industry = INDUSTRIES.includes(sp.industry ?? "") ? (sp.industry as string) : "";
  const filtered = Boolean(q || city || industry);
  const talents = await listTalents({ q, city, industry });

  return (
    <>
      <section className="hero">
        <p className="eyebrow">{SITE_TAGLINE}</p>
        <h1>Find the right talent, faster.</h1>
        <p className="lede">
          Search professionals by skill, role and city. Every profile is created by the talent
          themselves.
        </p>
        <form className="searchbar" action="/" role="search">
          <label className="field grow">
            <span>Skill, role or name</span>
            <input type="text" name="q" defaultValue={q} placeholder="e.g. Figma, product designer" />
          </label>
          <label className="field">
            <span>Industry</span>
            <select name="industry" defaultValue={industry}>
              <option value="">Any</option>
              {INDUSTRIES.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>City</span>
            <input type="text" name="city" defaultValue={city} placeholder="Kuala Lumpur" />
          </label>
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </section>

      <div className="section-head">
        <h2>{filtered ? "Results" : "Talents"}</h2>
        <span className="count">
          {talents.length} {talents.length === 1 ? "profile" : "profiles"}
          {filtered && (
            <>
              {" · "}
              <Link href="/">Clear search</Link>
            </>
          )}
        </span>
      </div>
      {talents.length === 0 ? (
        <div className="empty">
          {filtered ? (
            <>
              No talents match that search. <Link href="/">See everyone</Link>.
            </>
          ) : (
            <>
              No talents yet. <Link href="/join">Create the first profile</Link>.
            </>
          )}
        </div>
      ) : (
        <div className="grid">
          {talents.map((t) => (
            <TalentCard key={t.id} id={t.id} name={t.name} headline={t.headline} city={t.city} skills={t.skills} isSample={t.is_sample} />
          ))}
        </div>
      )}
    </>
  );
}
