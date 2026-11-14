-- TAB schema. Tables are locked down with row level security and no policies;
-- the app reaches them only through the tab_* functions below.

create extension if not exists vector with schema extensions;

create table public.tab_talents (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  name text not null check (char_length(name) between 1 and 80),
  headline text not null check (char_length(headline) between 1 and 100),
  category text not null check (char_length(category) between 1 and 40),
  city text not null check (char_length(city) between 1 and 60),
  years_exp int check (years_exp between 0 and 60),
  skills text[] not null check (cardinality(skills) between 1 and 12),
  open_to text[] not null default '{}' check (cardinality(open_to) <= 5),
  bio text not null default '' check (char_length(bio) <= 600),
  photo text not null check (char_length(photo) <= 1500000),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  face_consent boolean not null default false,
  face_consent_at timestamptz,
  embedding extensions.vector(128)
);

create table public.tab_inquiries (
  id uuid primary key default gen_random_uuid(),
  talent_id uuid not null references public.tab_talents(id) on delete cascade,
  from_name text not null check (char_length(from_name) between 1 and 80),
  from_email text not null check (char_length(from_email) between 3 and 120),
  message text not null check (char_length(message) between 1 and 1500),
  created_at timestamptz not null default now()
);
create index tab_inquiries_talent_idx on public.tab_inquiries(talent_id);

alter table public.tab_talents enable row level security;
alter table public.tab_inquiries enable row level security;

create or replace function public.tab_public(t public.tab_talents) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'headline', t.headline, 'category', t.category,
    'city', t.city, 'years_exp', t.years_exp, 'skills', t.skills, 'open_to', t.open_to,
    'bio', t.bio, 'is_sample', t.is_sample, 'created_at', t.created_at,
    'face_consent', t.face_consent, 'face_consent_at', t.face_consent_at);
$$;

create or replace function public.tab_create_talent(
  p_token_hash text, p_name text, p_headline text, p_category text, p_city text,
  p_years_exp int, p_skills text[], p_open_to text[], p_bio text, p_photo text,
  p_embedding float8[] default null
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if p_embedding is not null and cardinality(p_embedding) <> 128 then
    raise exception 'invalid face data';
  end if;
  insert into tab_talents (token_hash, name, headline, category, city, years_exp, skills, open_to, bio, photo,
                           face_consent, face_consent_at, embedding)
  values (p_token_hash, p_name, p_headline, p_category, p_city, p_years_exp, p_skills, p_open_to, p_bio, p_photo,
          p_embedding is not null, case when p_embedding is not null then now() end, p_embedding::vector(128))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.tab_list_talents(p_q text default '', p_industry text default '', p_city text default '')
returns setof jsonb language sql stable security definer set search_path = public as $$
  select tab_public(t) from tab_talents t
  where (p_q = '' or t.name ilike '%' || p_q || '%' or t.headline ilike '%' || p_q || '%'
         or t.bio ilike '%' || p_q || '%' or array_to_string(t.skills, ' ') ilike '%' || p_q || '%')
    and (p_industry = '' or t.category = p_industry)
    and (p_city = '' or t.city ilike '%' || p_city || '%')
  order by t.created_at desc
  limit 200;
$$;

create or replace function public.tab_get_talent(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select tab_public(t) from tab_talents t where t.id = p_id;
$$;

create or replace function public.tab_get_photo(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select photo from tab_talents where id = p_id;
$$;

create or replace function public.tab_get_by_token(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select tab_public(t) from tab_talents t where t.token_hash = p_token_hash;
$$;

-- Passing null withdraws consent and deletes the stored face data.
create or replace function public.tab_set_face_consent(p_token_hash text, p_embedding float8[] default null)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_embedding is not null and cardinality(p_embedding) <> 128 then
    raise exception 'invalid face data';
  end if;
  update tab_talents set face_consent = p_embedding is not null,
    face_consent_at = case when p_embedding is not null then now() end,
    embedding = p_embedding::vector(128)
  where token_hash = p_token_hash;
  return found;
end $$;

create or replace function public.tab_delete_talent(p_token_hash text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from tab_talents where token_hash = p_token_hash;
  return found;
end $$;

create or replace function public.tab_find_lookalikes(p_embedding float8[], p_limit int default 12)
returns setof jsonb language sql stable security definer set search_path = public, extensions as $$
  select tab_public(t) || jsonb_build_object('distance', t.embedding <-> p_embedding::vector(128))
  from tab_talents t
  where t.face_consent and t.embedding is not null and cardinality(p_embedding) = 128
  order by t.embedding <-> p_embedding::vector(128)
  limit least(greatest(p_limit, 1), 24);
$$;

create or replace function public.tab_add_inquiry(p_talent_id uuid, p_from_name text, p_from_email text, p_message text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into tab_inquiries (talent_id, from_name, from_email, message)
  values (p_talent_id, p_from_name, p_from_email, p_message);
  return true;
end $$;

create or replace function public.tab_list_inquiries(p_token_hash text) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', q.id, 'from_name', q.from_name, 'from_email', q.from_email,
                            'message', q.message, 'created_at', q.created_at)
  from tab_inquiries q join tab_talents t on t.id = q.talent_id
  where t.token_hash = p_token_hash
  order by q.created_at desc;
$$;

revoke all on function public.tab_public(public.tab_talents) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'tab_create_talent(text,text,text,text,text,int,text[],text[],text,text,float8[])',
    'tab_list_talents(text,text,text)', 'tab_get_talent(uuid)', 'tab_get_photo(uuid)',
    'tab_get_by_token(text)', 'tab_set_face_consent(text,float8[])', 'tab_delete_talent(text)',
    'tab_find_lookalikes(float8[],int)', 'tab_add_inquiry(uuid,text,text,text)', 'tab_list_inquiries(text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon', f);
  end loop;
end $$;
