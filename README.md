# Urban Access App

Web app for urban accessibility analysis: **transit level of service (GTFS)**, **schools**, and **parks**. It uses a FastAPI backend and a React (Vite) frontend.

## Prerequisites

- **Python 3.12+**
- **[uv](https://docs.astral.sh/uv/)** (recommended) or another way to install dependencies from `pyproject.toml`
- **Node.js 20+** and **npm** (for the frontend)

## Backend

From the repository root (`UrbanAccessApp/`):

```bash
uv sync
```

Set environment variables as needed:

| Variable | Required for | Description |
|----------|----------------|---------------|
| `MOBILITY_DB_TOKEN` | **Transit (GTFS)** | Refresh token from [Mobility Database](https://mobilitydatabase.org/) (Account Details). Include it in `backend/analysis_gtfs.py` or set as an environment variable. Without it, GTFS feed search and analysis will fail. |

Run the API on **port 7000** (the dev frontend proxies `/api` to this port):

```bash
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 7000
```

- API base: `http://127.0.0.1:7000`
- OpenAPI docs: `http://127.0.0.1:7000/docs`

### Tests

```bash
uv run pytest tests/ -q
```

## Frontend

From `UrbanAccessApp/frontend/`:

```bash
npm install
npm run dev
```

By default Vite serves the UI (often at `http://127.0.0.1:5173`). Requests to `/api` are **proxied** to `http://localhost:7000`, so keep the backend running on port 7000.

Production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Typical workflow

1. Start the backend (`uvicorn` on port 7000).
2. In another terminal, start the frontend (`npm run dev`).
3. Open the URL printed by Vite in the browser.
4. For **Transit** mode, set `MOBILITY_DB_TOKEN` before starting the backend.

## Troubleshooting

- **Transit: “MOBILITY_DB_TOKEN” / feed errors** — Create a token at Mobility Database and export it in the same shell that runs `uvicorn`.
- **CORS** — The backend allows all origins in development. For a custom deployment, adjust `CORSMiddleware` in `backend/main.py`.
- **Analysis jobs hang or fail** — Check the backend terminal for stack traces; transit analysis downloads data and can take several minutes.
