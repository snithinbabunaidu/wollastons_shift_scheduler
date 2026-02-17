# Wollaston's Shift Scheduler - Handoff Document

## Project Overview
A web-based shift scheduling application for managing employee schedules at a store. Built with React + Material UI frontend and Node.js/Express + SQLite backend.

## Current State
The app is functional with basic features working. It needs UI redesign and a few feature additions before it's production-ready.

## Tech Stack
- **Frontend**: React 18 (Vite) + Material UI 6 + React Router 6
- **Backend**: Node.js + Express 4
- **Database**: SQLite via Knex.js (query builder - supports easy swap to PostgreSQL for AWS)
- **Auth**: JWT (jsonwebtoken + bcrypt)
- **PDF**: pdfmake (server-side generation)
- **Monorepo**: Root `package.json` with `concurrently` to run both

## How to Run
```bash
cd wollastons_shift_scheduler

# Install everything (first time only)
npm run install:all

# Run migrations + seed (first time or after schema changes)
cd server && npx knex migrate:latest && npx knex seed:run && cd ..

# Start both frontend and backend
npm run dev
# Backend: http://localhost:3001
# Frontend: http://localhost:5173
```

## Default Login
- **Username:** `admin`
- **Password:** `admin123`

---

## File Structure
```
wollastons_shift_scheduler/
├── package.json                          # Root - runs both client/server via concurrently
├── .gitignore
├── HANDOFF.md                            # This file
│
├── client/                               # React frontend (Vite)
│   ├── package.json
│   ├── vite.config.js                    # Dev proxy /api -> localhost:3001
│   ├── index.html
│   └── src/
│       ├── main.jsx                      # Entry point, MUI theme, router
│       ├── App.jsx                       # Routes + auth protection
│       ├── context/
│       │   └── AuthContext.jsx           # JWT auth state (login/logout/token)
│       ├── services/
│       │   └── api.js                    # All API calls (axios with JWT interceptor)
│       ├── components/
│       │   └── Layout.jsx                # App shell - sidebar nav + AppBar
│       └── pages/
│           ├── LoginPage.jsx             # Login form
│           ├── SchedulePage.jsx          # *** NEEDS REDESIGN (see below) ***
│           ├── EmployeesPage.jsx         # Employee CRUD + availability grid + locked shifts
│           └── SettingsPage.jsx          # Shift time configuration (start/end per slot)
│
├── server/                               # Express backend
│   ├── package.json
│   ├── knexfile.js                       # DB config (SQLite dev, PostgreSQL prod)
│   ├── data/                             # SQLite DB file lives here (gitignored)
│   └── src/
│       ├── index.js                      # Express server entry, CORS, static serving
│       ├── middleware/
│       │   └── auth.js                   # JWT verify middleware + JWT_SECRET
│       ├── db/
│       │   ├── knex.js                   # DB connection singleton
│       │   ├── migrations/
│       │   │   ├── 001_initial.js        # All tables: users, employees, availability,
│       │   │   │                         #   shift_configs, schedules, schedule_settings,
│       │   │   │                         #   locked_shifts
│       │   │   └── 002_add_end_time.js   # Added end_time to shift_configs + schedules
│       │   └── seeds/
│       │       └── 001_defaults.js       # Admin user + default shift timings
│       ├── routes/
│       │   ├── auth.js                   # POST /api/auth/login
│       │   ├── employees.js              # CRUD + availability + locked shifts
│       │   ├── shiftConfig.js            # GET/PUT /api/shift-config + POST reset
│       │   └── schedules.js              # Schedule CRUD + auto-generate + PDF + available employees
│       └── services/
│           ├── scheduler.js              # Auto-scheduling algorithm
│           └── pdf.js                    # 3-page PDF generation (pdfmake)
```

## Database Schema

### users
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| username | TEXT UNIQUE | |
| password_hash | TEXT | bcrypt |
| created_at | TIMESTAMP | |

### employees
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| name | TEXT | |
| employment_type | ENUM | 'part_time', 'coop', 'external_coop' |
| is_trainee | BOOLEAN | |
| role | TEXT NULLABLE | 'morning_manager', 'afternoon_manager', 'night_manager', 'ag_food_order', 'us_food_order' |
| max_hours | INTEGER | 20 for PT, 40 for coop, 14 for external |
| active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMP | |

### availability
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| employee_id | FK -> employees | CASCADE delete |
| day_of_week | INTEGER | 0=Sunday, 6=Saturday |
| shift_period | ENUM | 'morning', 'afternoon', 'night' |
| is_available | BOOLEAN | |
| UNIQUE | (employee_id, day_of_week, shift_period) | |

### shift_configs
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| shift_period | ENUM | 'morning', 'afternoon', 'night' |
| slot_index | INTEGER | 0-based position within period |
| start_time | TEXT | "06:00" format |
| end_time | TEXT | "13:00" format |
| is_default | BOOLEAN | |

### schedules
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| week_start_date | DATE | Sunday of the week |
| day_of_week | INTEGER | 0-6 |
| shift_period | ENUM | 'morning', 'afternoon', 'night' |
| slot_index | INTEGER | Position within the period |
| employee_id | FK -> employees NULLABLE | SET NULL on delete |
| is_locked | BOOLEAN | |
| start_time | TEXT NULLABLE | Override from config |
| end_time | TEXT NULLABLE | Override from config |
| UNIQUE | (week_start_date, day_of_week, shift_period, slot_index) | |

### schedule_settings
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| week_start_date | DATE | |
| day_of_week | INTEGER | |
| shift_period | ENUM | |
| employee_count | INTEGER | Override default slot count |
| UNIQUE | (week_start_date, day_of_week, shift_period) | |

### locked_shifts
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| employee_id | FK -> employees | CASCADE delete |
| day_of_week | INTEGER | |
| shift_period | ENUM | |
| UNIQUE | (employee_id, day_of_week, shift_period) | |

## API Endpoints

### Auth
- `POST /api/auth/login` - { username, password } -> { token, username }

### Employees
- `GET /api/employees` - List all active employees
- `GET /api/employees/:id` - Get employee with availability + locked shifts
- `POST /api/employees` - Create employee (auto-creates availability rows)
- `PUT /api/employees/:id` - Update employee fields
- `DELETE /api/employees/:id` - Soft delete (sets active=false)
- `GET /api/employees/:id/availability` - Get availability grid
- `PUT /api/employees/:id/availability` - Update availability { availability: [...] }
- `GET /api/employees/:id/locked-shifts` - Get locked shifts
- `PUT /api/employees/:id/locked-shifts` - Set locked shifts { locked_shifts: [...] }

### Shift Config
- `GET /api/shift-config` - Get all slot configs
- `PUT /api/shift-config` - Replace all configs { configs: [...] }
- `POST /api/shift-config/reset` - Reset to defaults

### Schedules
- `GET /api/schedules/:weekStart` - Get week schedule + settings + shift_configs
- `PUT /api/schedules/:weekStart` - Save assignments { assignments: [...] }
- `PUT /api/schedules/:weekStart/settings` - Update slot counts { settings: [...] }
- `POST /api/schedules/:weekStart/auto-generate` - Run auto-scheduler
- `GET /api/schedules/:weekStart/available/:dayOfWeek/:shiftPeriod` - Available employees for slot
- `GET /api/schedules/:weekStart/pdf` - Download PDF

## Default Shift Timings
```
Morning (5 slots):  6AM-1PM, 6AM-1PM, 7AM-2PM, 9AM-3PM, 10AM-5PM
Afternoon (4 slots): 11AM-6PM, 1PM-7PM, 2PM-8PM, 3PM-8PM
Night (5 slots):    6PM-1AM, 6PM-1AM, 7PM-1AM, 8PM-1AM, 8PM-1AM
```

## Business Rules (implemented in scheduler.js)
1. Locked shifts are immovable
2. Every shift must have >= 1 non-trainee
3. Food order roles get mandatory morning shifts on their designated days
4. Part-time: max 20h/week, Co-op/OPT: max 40h/week
5. External co-op: weekends only, max 2 shifts/week
6. No single shift exceeds 7 hours
7. Shift managers assigned to their designated periods first
8. Hours balanced across employees when possible

## What's Working
- Login/logout with JWT
- Employee CRUD with roles, employment types, trainee flag
- Availability grid (day x shift period checkboxes)
- Locked shifts per employee
- Shift time configuration (Settings page) with add/remove slots, start+end times
- Schedule grid with employee dropdowns and lock toggles
- Clickable time chips to edit individual slot times (popover with start/end inputs)
- Auto-scheduling algorithm respecting all business rules
- PDF export (3-page: Sun-Wed, Thu-Sat, summary)
- Hour calculations using actual start/end times (not hardcoded 7h)
- Visual warnings for trainee-only shifts and hour limit violations

---

## PENDING CHANGES NEEDED

### 1. Schedule Page UI Redesign (MAJOR)
**Current**: Days are columns (left to right), shifts are rows (top to bottom). This makes the grid very wide and hard to read.

**Needed**: Flip the layout to match the handwritten schedule format:
- **Days go top-to-bottom** (each day is a row/section)
- **Shifts go left-to-right** (Morning | Afternoon | Night as column groups)
- Within each shift column, show the employee slots vertically
- Each slot shows: employee name + time range (e.g., "6AM-1PM")
- Add a small clock icon next to the time that opens the time edit popover
- Reference the handwritten schedule images for layout inspiration:
  - Each day has its own section/card
  - 3 column groups: Morning times+names | Afternoon times+names | Night times+names
  - Time shown on the left of each name (e.g., "6" for 6AM, "1/11" for 1PM/11AM)
  - "(T)" shown next to trainee names
  - Hours count on the far right

**File to modify**: `client/src/pages/SchedulePage.jsx`

### 2. Order Days Configuration (NEW FEATURE)
**Current**: Food order roles (ag_food_order, us_food_order) exist as employee roles, but there's no way to mark WHICH days are order days.

**Needed**:
- Add a way to configure which days of the week are "AG Order Day" and "US Order Day"
- This could be a simple setting in the Settings page or in the schedule view
- On order days, the employee with the corresponding food order role MUST be assigned to the morning opener shift (first slot, 6AM)
- On non-order days, food order employees can still be assigned to morning opening shifts if they have availability, but it's not mandatory
- The auto-scheduler should enforce this: on an AG order day, the ag_food_order person gets the first morning slot

**Files to modify**:
- Database: Add a new table or setting for order day configuration
- `server/src/routes/` - New endpoint or extend existing
- `server/src/services/scheduler.js` - Update auto-generate logic
- `client/src/pages/SchedulePage.jsx` or `SettingsPage.jsx` - UI to set order days

### 3. PDF Format Update
Once the schedule UI is redesigned (change #1), the PDF export should match the new layout format with days as rows and shifts as columns.

**File to modify**: `server/src/services/pdf.js`

---

## Key Patterns to Follow
- All API calls go through `client/src/services/api.js` (axios with JWT interceptor)
- Auth state managed in `client/src/context/AuthContext.jsx`
- Database accessed via Knex query builder (`server/src/db/knex.js`)
- Schema changes go in new migration files in `server/src/db/migrations/`
- Business logic lives in `server/src/services/`
- Route files in `server/src/routes/` handle HTTP + call services
