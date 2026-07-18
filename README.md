# Cashwise — Gemma SME Cashflow Copilot

Next.js (Netlify) + FastAPI (Render) + Supabase Postgres/Auth, with a Gemma
chat panel that reads/writes your entries via tool-calling.

## Local dev

```bash
# 1. Supabase — create a project, run backend/schema.sql in the SQL editor.

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill in Supabase + Gemini keys
uvicorn app.main:app --reload

# 3. Frontend
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000, sign up, add entries on **Cash**, view chart +
worksheet on **Dashboard**, toggle **Ask Gemma** for the AI panel.

## Deploy

- **DB / Auth** — Supabase (schema in `backend/schema.sql`, RLS enabled)
- **Backend** — Render web service, blueprint at `backend/render.yaml`
- **Frontend** — Netlify, config in `frontend/netlify.toml`

See `spec/02-start_implemented.md` for the implementation writeup.
