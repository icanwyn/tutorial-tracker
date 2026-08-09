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
  - **Local:** `data/db.json` on the machine running the server  
  - **Vercel multi-device:** [Upstash Redis](https://console.upstash.com) via `UPSTASH_REDIS_*` env vars  
- Client **identity only** (admin/teacher name, student ID) is in `localStorage` per browser  

### Will this work on multiple devices without a database?

| Setup | Shared live data across phones? |
|-------|----------------------------------|
| One laptop `npm run dev`, phones on same Wi‑Fi hit your laptop IP | **Yes** (file store) |
| Vercel **with** Upstash Redis env vars | **Yes** (recommended) |
| Vercel **without** Redis | **No** — serverless has no durable shared disk; data can reset or stay isolated per instance |

Browser localStorage only remembers *who you are* on that device. Rosters, rooms, and attendance live on the server store.

### Deploy (GitHub + Vercel)

1. Push this repo to GitHub  
2. Import the project in [vercel.com](https://vercel.com)  
3. Create a free Upstash Redis DB → copy REST URL + token into Vercel **Environment Variables**  
4. Redeploy  

```bash
# Health check after deploy
curl https://YOUR_APP.vercel.app/api/health
```

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
