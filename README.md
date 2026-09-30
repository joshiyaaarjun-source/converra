# CONVERRA — PS26006

Full-stack starter for the supplied CONVERRA UI.

## Stack
- Frontend: supplied CONVERRA HTML/CSS/JS UI
- Backend: Node.js + Express
- API: REST + JSON
- Seed data: `data/seed.json`

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5000

## API
- GET `/api/health`
- GET `/api/meta`
- GET `/api/ports`
- GET `/api/vessels`
- GET `/api/forecast?country=IN`
- GET `/api/fuel?country=IN`
- POST `/api/plans`
- GET `/api/plans`
- POST `/api/simulate`
- POST `/api/counterfactual`
- POST `/api/copilot`

The API currently uses seeded/demo calculations. It is structured so PostgreSQL/PostGIS, ML forecasting, OR-Tools and a production Copilot can be plugged in later.
