# TAB

Talent Amplifies Business. An MVP of the talent platform: self-created professional profiles, skill search, and opt-in lookalike (similar face) search.

## What it does

- **Join as talent** (`/join`): a talent creates their own profile: role, industry, city, skills, experience, what they are open to, and one photo. Face search is a separate, optional consent checkbox.
- **Search** (`/`): find talents by skill, role or name, filtered by industry and city.
- **Lookalike search** (`/search`): upload a reference photo and get the closest-looking talents, ranked. Only talents who opted in are searched.
- **Profile** (`/talent/[id]`): public details plus an inquiry form. Contact details are never shown.
- **Manage** (`/manage/[token]`): private link given once at sign-up. Switch face search on or off, read inquiries, delete the profile.

## Privacy rules built in

- Nothing is scraped. Every photo is uploaded by the talent.
- Face data (a 128-number descriptor) is stored only with explicit consent, and deleted when consent is withdrawn or the profile is deleted.
- Face analysis runs in the browser. A search reference photo never leaves the device and nothing from a search is stored.
- Photos must contain exactly one face.
- Profiles marked "Sample" are fictional demo people with AI-generated photos.

## Run it

Requires Node 20 or newer and a Supabase project.

1. Run the SQL in `supabase/schema.sql` on the Supabase project.
2. Create `.env.local` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the publishable key).
3. `npm install`, then `npm run dev`, and open http://localhost:3000.

The tables have row level security with no policies; the app reads and writes only through the `tab_*` database functions.

## Not in this version

- Employer accounts, job posts and employer verification.
- Accounts and login (the private manage link stands in for them).
- Proof that the photo is really the person signing up (for example a live selfie check).
- Rate limiting and login for people who search.
