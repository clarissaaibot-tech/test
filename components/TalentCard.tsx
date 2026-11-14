import Link from "next/link";

export function TalentCard(props: {
  id: string;
  name: string;
  category: string;
  city: string;
  score?: number;
}) {
  return (
    <Link href={`/talent/${props.id}`} className="card">
      <div className="photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/photos/${props.id}`} alt={`Portrait of ${props.name}`} loading="lazy" />
        {props.score !== undefined && <span className="score">{props.score}% similar</span>}
      </div>
      <div className="name">{props.name}</div>
      <div className="meta">
        {props.category} · {props.city}
      </div>
    </Link>
  );
}
