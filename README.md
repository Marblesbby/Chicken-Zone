🐔 Chicken Zone
Auto Parts Inventory Manager — Built for tracking parts, vehicles, and maintenance history for a GMT800 family garage.
What it is
A single-page web app for managing a home mechanic's parts inventory. Tracks physical parts on shelves, links them to vehicles, manages wishlist items, and stores service history and maintenance reminders.
Current vehicles: Nathan's 2004 GMC Yukon Denali, Cammy's 2005 GMC Yukon Denali, Jessie's 2004 Cadillac Escalade (all GMT800 platform, LQ4/LQ9 6.0L V8, 4L65E).
---
Tech Stack
Layer	Service	Notes
Frontend	HTML/CSS/JS (single file)	No framework, no build step
Database	Supabase	PostgreSQL + Auth + Storage
Hosting	Netlify	Drop the HTML file in, done
Auth	Supabase Auth	Username-based login (internal email format: `username@chickzone.internal`)
---
Project Structure
```
chicken-zone/
├── index.html              ← The entire app (HTML + CSS + JS in one file)
├── supabase/
│   ├── schema.sql          ← All table definitions + RLS policies
│   ├── catalog_seed.sql    ← 160 GMT800 parts catalog (INSERT statements)
│   └── part_details_seed.sql ← Tools/hardware/time/tips per part
└── README.md
```
> **Note for future refactor:** The `index.html` file contains the parts catalog as a JavaScript array (~160 parts). The SQL seed files are the source of truth for what *should* be in the database. A future version should query `catalog_parts` and `part_details` tables instead of reading from JS constants.
---
Database Tables
Table	Purpose
`profiles`	Extends Supabase auth users with username and real email
`catalog_parts`	Master parts reference (replaces the JS GMT800 array)
`part_details`	Tools, hardware, time estimates, tips per catalog part
`vehicles`	The three family cars
`mileage_logs`	Odometer readings over time per vehicle
`parts`	Physical inventory — each row is a part on a shelf
`part_installations`	Links a physical part to a vehicle at a point in time
`service_history`	Service records per vehicle
`maintenance_reminders`	Scheduled reminders per vehicle
`wishlist`	Parts to find or buy
`vehicle_photos`	Phase 2 — condition photos with tags and history
---
Supabase Setup (from scratch)
1. Create a Supabase project
Go to supabase.com, create a new project called "Chicken Zone".
2. Run the schema
In Supabase → SQL Editor → New Query, paste and run `supabase/schema.sql`.
3. Seed the catalog
Still in SQL Editor, paste and run `supabase/catalog_seed.sql`, then `supabase/part_details_seed.sql`.
4. Storage buckets
In Supabase → Storage, create three public buckets:
`parts-images`
`receipts`
`vehicle-photos` (Phase 2)
5. Get your keys
In Supabase → Project Settings → API:
Copy the Project URL (starts with `https://`)
Copy the anon/public key (labeled "publishable")
> ⚠️ Never use the `service_role` key in the frontend. That key bypasses RLS and has full database access.
6. Update the app
In `index.html`, find these two lines near the top of the `<script>` tag:
```js
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'your-anon-key-here';
```
Replace with your values.
7. Deploy to Netlify
Drag and drop `index.html` into app.netlify.com → Sites → drag to deploy.
---
Authentication
New accounts are created via the Register tab. The app stores a "username" and uses `username@chickzone.internal` as the internal Supabase email format so users only need a username and password to sign in.
To disable public registration (recommended once your family accounts are set up):
Supabase → Authentication → Providers → Email → Disable "Allow new users to sign up".
You can still create accounts manually in Supabase → Authentication → Users → Invite user.
---
Security Notes
RLS is enabled on all tables. Current policy: any authenticated user can read/write everything. This is fine for a private family tool.
To tighten: change RLS policies to `using (auth.uid() = created_by)` for per-user isolation.
The Supabase anon/publishable key in the HTML is safe to expose publicly — it's designed to be client-side.
Never commit the Supabase `service_role` key anywhere.
---
Phases Roadmap
Phase	Status	Description
1	✅ Complete	Core inventory, parts catalog, vehicle profiles, wishlist
2	🔄 In progress	Vehicle photo albums with condition tags, damage ratings, update reminders
3	📋 Planned	Parts car profiles (pre-populated, Scrap Car workflow), Guest car support
4	📋 Planned	Full shelf location system — QR labels, Brother label maker integration, location hub map
5	📋 Planned	Performance caching, URL routing, offline support
---
GMT800 Platform Notes
All three vehicles share:
Engine family: LS-based V8 (LQ4 or LQ9, 6.0L)
Transmission: 4L65E 4-speed automatic
Transfer case: NP246 or NP261
Front differential: IFS with CV axles
Rear axle: 8.5" ring gear, C-clip axle retention
Parts tagged `fits: 'all'` work on all three vehicles. Parts tagged `fits: 'esc'` are Escalade-specific. Parts tagged `fits: 'yk'` are Yukon Denali-specific. Non-interchangeable parts are almost exclusively body panels, trim, lighting, and interior pieces.[README.md](https://github.com/user-attachments/files/26923730/README.md)
