# CashFlow AI

https://cashflow-ai-og.onrender.com/


> AI-powered MSME credit intelligence platform — Holt-Winters cash flow forecasting, 4-pillar explainable credit scoring, real-time early warnings, scenario simulation, and a Razorpay Shield-style lender risk console.

## What it does

CashFlow AI turns raw UPI transaction history into two connected views:

- **MSME View** — a real-time financial cockpit: forecasted balance, burn rate, runway, spending spikes, early-warning alerts with quantified mitigations, and a live "what-if" scenario simulator.
- **Lender Portal** — an explainable 4-pillar credit score, a Razorpay Shield-style risk breakdown, and an automatic loan pre-approval with real EMI sizing.

The entire decision engine — forecasting, scoring, loan sizing — runs client-side in JavaScript: deterministic and auditable, with no server round-trip required to produce a score.

## Project Structure

```
cashflow-ai/
├── 📄 index.html            # Frontend dashboard — MSME View + Lender Portal
├── 🎨 styles.css             # Dark glassmorphic UI
├── ⚙️  app.js                # Dashboard controller — orchestrates the full pipeline
│
├── 🧮 forecasting.js         # Holt-Winters (additive, weekly seasonality) + outlier detection
├── 🧪 model-validation.js    # Damped-trend Holt-Winters + auto backtest & model selection
├── 💳 credit-engine.js       # 4-pillar credit scoring, risk breakdown, loan pre-approval
├── 🚨 warning-engine.js      # Early warnings, obligation clustering, scenario simulation
├── 🎲 synth-data.js          # Synthetic MSME profile generator (3 business archetypes)
│
├── 🔧 main.py                # FastAPI backend — persistence/API layer for productionizing
├── 🗃️  models.py              # SQLAlchemy ORM models
├── 💾 database.py            # DB engine & session factory
├── 📦 requirements.txt       # Python dependencies
│
├── 🐍 prep_data.py           # Data prep script for the raw CSV pipeline
└── upi_transactions_2024.csv # Raw UPI transaction dataset (250K rows) — not currently wired into the live demo
```

## Frontend (No build needed)

Serve the folder with any static server and open `index.html`:

```bash
# Python (quick)
python -m http.server 8080

# Node.js
npx serve .
```

Then open **http://localhost:8080**

### Data

The live demo generates its own data on load, via `synth-data.js` — three fully-modeled synthetic MSME profiles (a stable kirana store, a high-growth D2C brand, and a volatile seasonal trader), each with a full year of daily transactions built from real business logic: seasonality, festival spikes, weekend boosts, late-payment probability, and channel-specific inflow splits. This is deliberate — a small, deliberately different set of profiles to stress-test the engine across different cash-flow shapes before plugging in live UPI data. The `upi_transactions_2024.csv` → `prep_data.py` → `daily_cashflow_data.json` pipeline exists in this repo but is not currently used by the live dashboard.

### Features

**Forecasting**
- Additive Holt-Winters Triple Exponential Smoothing with weekly seasonality — α/β/γ sliders, live
- Inflows and outflows forecasted **separately**, then combined into net forecast with optimistic/pessimistic bands
- 30 / 60 / 90-day forecast horizons with ±15% confidence bands
- Zero-balance date projection — exact day balance is forecast to cross zero (this is where "runway" comes from)
- 14-day moving σ outlier detection (default k=2.0)

**Model Validation**
- Backtests 4 candidate models — Naive Last-Value, Seasonal-Naive, 7-Day Moving Average, and Holt-Winters with Damped Trend — against each business's own last 30 real days
- Selects on **cumulative Day-30 balance error**, the metric that matches the product's actual forecast claim — not a generic loss function
- Damping parameter (φ) is grid-searched per business; α/β/γ are deliberately held fixed during tuning to avoid overfitting a model to 30 data points
- Falls back safely to a 7-day moving average when there isn't enough history to backtest meaningfully

**Credit Scoring (4 pillars, 25 pts each, out of 100)**
- **DSCR** — Debt Service Coverage Ratio (net inflow ÷ fixed obligations, 90-day window)
- **CVI** — Cash Volatility Index (σ/μ of daily balance, 90-day window)
- **Revenue Trend Velocity** — average month-over-month growth, last 6 months
- **Liquidity Buffer Ratio** — days of runway at current burn rate
- Every deduction is explainable in plain language with exact points lost
- Risk tiers: Low (≥75) / Moderate (≥50) / High (<50)

**Lender Risk Console (Razorpay Shield–style)**
- 4 risk categories: Liquidity, Operational Stability, Revenue Diversification (UPI/NEFT/card channel-concentration risk), Repayment Reliability
- Automatic **loan pre-approval** — product, amount, interest rate, tenure, and a real amortized EMI calculation, with attached conditions

**Early Warning Engine**
- Zero-balance projection with severity tiers (critical / warning / info)
- Detects upcoming obligation clustering — e.g. rent + salaries + GST landing within a 5-day window
- Declining revenue trend detection (3+ consecutive months)
- Quantified mitigations — specific invoice-discounting amounts, vendor credit extension terms, runway-days gained from spend cuts

**Scenario Simulator**
- Receivables delay (% delayed × days) — genuinely shifts that revenue forward in the forecast window
- Revenue change (%)
- One-time emergency expense
- Recalculates live against the same forecasting engine

## Backend (FastAPI)

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

API docs at **http://localhost:8000/docs**

This is the persistence/API layer for productionizing the platform (business, transaction, and credit-score records via SQLAlchemy). The credit scoring and forecasting logic currently deployed in the live dashboard runs entirely client-side — this backend is not where that logic executes today.

## Data Preparation (optional, unused by the live demo)

To regenerate `daily_cashflow_data.json` from the raw CSV:

```bash
pip install pandas
python prep_data.py
```
