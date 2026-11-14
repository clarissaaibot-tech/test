# Talent Directory

A talent platform MVP with opt-in lookalike (similar face) search.

## What it does

- **Join as talent** (`/join`): a talent creates their own profile with one photo. Face search is a separate, optional consent checkbox.
- **Browse** (`/`): directory of all profiles.
- **Find a lookalike** (`/search`): upload a reference photo and get the closest-looking talents, ranked. Only talents who opted in are searched.
- **Profile** (`/talent/[id]`): public details plus an inquiry form. Contact details are never shown.
- **Manage** (`/manage/[token]`): private link given once at sign-up. Switch face search on or off, read inquiries, delete the profile.

## Privacy rules built in

- Nothing is scraped. Every photo is uploaded by the talent.
- Face data (a 128-number descriptor) is stored only with explicit consent, and deleted when consent is withdrawn or the profile is deleted.
- Face analysis runs in the browser. A search reference photo never leaves the device and nothing from a search is stored.
- Photos must contain exactly one face.

## Run it

Requires Node 22.13 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Data is stored locally in `data/` (SQLite database and uploaded photos).

## Not in this version

- Accounts and login (the private manage link stands in for them).
- Proof that the photo is really the person signing up (for example a live selfie check).
- Rate limiting and login for people who search.
- Hosted storage. `data/` is a local folder, so deploying needs a hosted database and file storage first.

The platform name is a placeholder; change it in `lib/site.ts`.
