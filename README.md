# Tutorial Tracker

Schoolwide tutorial session tracker for admins, teachers, and students.

## What it does

| Role | Capabilities |
|------|----------------|
| **Admin** | Bootstrap + grant other admins; define **tutorial sections** (subject priority + default cap); master roster / search; optional priority list |
| **Teacher** | Rejoin (roster saved); pick section; open (FCFS cap) or closed room; request students by day; attendance shows who marked present |
| **Student** | Required rooms by priority; choose if multi-request with no priority; open rooms FCFS with seat caps |

### Flow

1. **Admin** starts a session → shares the join code with staff  
2. **Teachers** join with the code + room name  
3. Teachers upload class rosters; each student receives a unique ID (e.g. `STU-A3F9C2`)  
4. Teachers select students and days for **required** tutorial  
5. Rooms marked **Open Study** accept student self-signup for free days  
6. Teachers take **Present / Absent / Excused** attendance  
7. Admin monitors live room maps and missing students  

## Quick start

```bash
cd tutorial-tracker
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo walkthrough

1. **Admin** → enter name → Start session → copy join code  
2. **Teacher** (new browser/incognito) → name → join with code → room e.g. `Room 214`  
   - Check **Open study** if free students may join  
   - **Class list**: drop an `.xlsx` / `.csv` **or** paste from Excel:
     ```
     Ava, Chen, 2, Algebra
     Jordan, Smith, 3, English
     Maya, Patel, 1, Biology
     ```
     Headers like `First Name`, `Last Name`, `Period`, `Subject` (or a single `Name` column) are auto-detected.  
   - **Who must attend**: check students, pick Mon–Fri, confirm  
   - Take attendance for the day  
3. **Student** → Get a new ID or look up ID from the roster table  
   - On free days, sign up for an open study room  

## Tech

- **Next.js** (App Router) + TypeScript + Tailwind  
- **Shared data store** (not browser localStorage for school data):
  - **Local:** `data/db.json`  
  - **Online multi-device (recommended):** [Supabase](https://supabase.com) Postgres  
  - **Optional fallback:** Upstash Redis  
- Client **identity only** (admin/teacher name, student ID) is in `localStorage` per browser  

### Set up Supabase (what to do and where)

You already have a Supabase account. Do this once:

#### 1. Create or open a project
- Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)  
- **New project** (or open an existing one)  
- Note the region; wait until the project is ready  

#### 2. Create the table
- Left sidebar → **SQL Editor** → **New query**  
- Open this repo file: [`supabase/schema.sql`](./supabase/schema.sql)  
- Paste the whole file → **Run**  
- You should see success; Table Editor should show **`app_state`** with one row `id = main`  

#### 3. Copy API keys
- Left sidebar → **Project Settings** (gear) → **API**  
- Copy:
  - **Project URL** → `SUPABASE_URL`  
  - **`service_role`** key (secret) → `SUPABASE_SERVICE_ROLE_KEY`  
- **Do not** put `service_role` in the browser or `NEXT_PUBLIC_*` — server only  

#### 4. Local testing
Create `tutorial-tracker/.env.local`:

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...your-service-role...
ADMIN_PASSWORD=pick-a-strong-password
BOOTSTRAP_ADMIN_NAMES=Your Name
```

```bash
npm run dev
curl http://localhost:3000/api/health
# expect: "storage":"supabase"
```

#### 5. Vercel (production)
- [vercel.com](https://vercel.com) → project **tutorial-tracker** → **Settings** → **Environment Variables**  
- Add for **Production** (and Preview if you want):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ADMIN_PASSWORD` (recommended)
  - `BOOTSTRAP_ADMIN_NAMES` (optional)  
- **Redeploy** (Deployments → … → Redeploy)  
- Check: `https://tutorial-tracker.vercel.app/api/health`  
  - Should say `"storage":"supabase"` and multi-device **yes**

| Setup | Shared live data across phones? |
|-------|----------------------------------|
| Laptop `npm run dev` only | Yes (file) on same Wi‑Fi |
| Vercel + **Supabase** | **Yes** (recommended) |
| Vercel with no Supabase/Redis | **No** |

### Admin password

```bash
ADMIN_PASSWORD=your-strong-secret
```

When set, admin sign-in needs **name + password**. Teachers/students unchanged.

## API sketch

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth` | Create admin/teacher identity |
| POST | `/api/sessions` | Admin starts session |
| POST | `/api/teachers/join` | Teacher joins with code |
| POST | `/api/roster` | Upload roster rows |
| POST | `/api/assignments` | Assign days or student self-signup |
| POST | `/api/attendance` | Mark attendance |
| GET | `/api/admin/overview` | Live rooms + missing list |
| GET/POST | `/api/students` | Lookup / register student |

## Notes

- A student can only be in **one room per day**. New required assignments or open-study signups replace prior placements for that day.  
- Students with a **required** tutorial cannot self-sign open study that same day.  
- Data resets if you delete `data/db.json`.  
