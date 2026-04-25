🐔 Chicken Zone:
Auto Parts Inventory Manager — Built for tracking parts, vehicles, and maintenance history for a GMT800 family garage.
What it is:
A web app for managing a home mechanic's parts inventory. Tracks physical parts on shelves, links them to vehicles, manages wishlist items, and stores service history and maintenance reminders.
Current vehicles: Nathan's 2004 GMC Yukon Denali, Cammy's 2005 GMC Yukon Denali, Jessie's 2004 Cadillac Escalade (all GMT800 platform, LQ4/LQ9 6.0L V8, 4L65E).
---

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

Security Notes
RLS is enabled on all tables. 
To tighten: change RLS policies to `using (auth.uid() = created_by)` for per-user isolation.
The Supabase anon/publishable key in the HTML is safe to expose publicly — it's designed to be client-side.
Never commit the Supabase `service_role` key anywhere.
---
Phases Roadmap
Phase	Status	Description
1	🔄 In progress	Vehicle photo albums with condition tags, damage ratings, update reminders
2	📋 Planned	Parts car profiles (pre-populated, Scrap Car workflow), Guest car support
3	📋 Planned	Full shelf location system — QR labels, Brother label maker integration, location hub map
4	📋 Planned	Performance caching, URL routing, offline support
---
GMT800 Platform Notes
All three vehicles share:
Engine family: LS-based V8 (LQ4 or LQ9, 6.0L)
Transmission: 4L65E 4-speed automatic
Transfer case: NP246 or NP261
Front differential: IFS with CV axles
Rear axle: 8.5" ring gear, C-clip axle retention
Parts tagged `fits: 'all'` work on all three vehicles. Parts tagged `fits: 'esc'` are Escalade-specific. Parts tagged `fits: 'yk'` are Yukon Denali-specific. Non-interchangeable parts are almost exclusively body panels, trim, lighting, and interior pieces.[README.md](https://github.com/user-attachments/files/26923730/README.md)
