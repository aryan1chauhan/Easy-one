# Expense Splitter (`Easy-one`)

A zero-dependency, client-side web application for tracking shared group expenses (2–10 members) in Indian Rupees (`₹`), calculating accurate per-member balances, and simplifying settlements to the mathematically minimum number of transactions.

## Tech Stack

- **Frontend:** Pure HTML5, CSS3, and native ES6+ modules (`<script type="module">`) — zero frameworks, bundlers, or external CDN dependencies
- **Persistence:** Browser `localStorage` under versioned key `expense_splitter_state_v1`
- **Automated Tests:** Zero-dependency Node.js test suites (`node:assert/strict`, verified on Node.js v23.10.0)

## How to Run Locally

Because native ES modules (`type="module"`) are blocked by browser CORS policy on `file://` URLs, serve the repository root over any local static HTTP server:

```bash
# Option A: Python 3 built-in HTTP server
python -m http.server 4173

# Option B: Node.js static server
npx serve .
```

Then open `http://localhost:4173` (or the port printed by `serve`) in your browser.

For static hosting (GitHub Pages, Vercel, or Netlify), deploy the repository root directly as a static site — no build step or environment variables are required.

## How to Run Automated Tests

```bash
# Pure domain unit tests (money precision, validators, balances, Bitmask DP) — 32 assertions
node tests/core.test.js

# Reactive store & fault-tolerant localStorage persistence tests — 5 test suites
node tests/state.test.js
```

## Features Implemented

### Core Requirements (1–6)
- [x] **Group Members (2–10):** Add members with whitespace normalization (`M-02`), case-insensitive duplicate blocking (`M-03`), 40-character limit (`M-14`), and deletion protection while referenced in expenses or settlements (`M-07`–`M-10`).
- [x] **Add Expenses:** Title, positive `₹` amount (up to 2 decimal places, capped at `₹1,00,00,000`), payer selection, and equal split by default (`Split Among` checkboxes), with inline `role="alert"` error messages (zero `alert()`/`confirm()`/`prompt()` calls).
- [x] **Expense History (Newest First):** Reverse-chronological cards (`createdAt` desc + insertion tie-breaker) with one-click Delete that immediately updates balances and settle-up transfers.
- [x] **Member Balances:** Per-member Paid, Share, color-coded Net Balance (`+₹X gets back`, `-₹X owes`, `₹0 settled`), total group spend, and strict `₹0` zero-sum footer check.
- [x] **Minimum-Transaction Settle Up:** Simplifies all debts into `"A pays B ₹X"` statements or `"All settled! No payments needed."`.
- [x] **Persistence & Group Reset:** Automatic `localStorage` persistence across reloads, corruption/quota warning banner (`P-02`–`P-04`), and accessible custom `<dialog>` Reset Group modal (`P-05`, `P-06`, `U-07`).

### Minimum-Transaction Twist & Financial Precision
- **Integer Paise Arithmetic (`src/core/money.js`):** All amounts are parsed via decimal string-splitting into integer paise ($1\text{ rupee} = 100\text{ paise}$) to avoid IEEE 754 drift (`"19.99" -> 1999`), and equal-split remainders assign `+1` paisa deterministically to the first `amountPaise % k` participants.
- **Exact Bitmask DP (`src/core/settleUp.js`):** Rather than greedy-only matching (which fails on subset-sum traps such as `[+700, +600, -600, -400, -300]`, producing 4 payments instead of 3), the solver partitions the $k$ non-zero balances ($k \le 10$) in $O(3^k)$ time into the maximum number $p$ of disjoint zero-sum subsets (`Float64Array` subset sums prevent 32-bit overflow), yielding strictly $k - p$ optimal transfers.

### Bonus Features
- [x] **Unequal Splits (`Exact (₹)` & `Percentage (%)`):** Live remaining/excess status bars, integer basis-point ($100\% = 10{,}000\text{ bps}$) validation, and Hamilton's Largest Remainder Method distribution (`E-08`–`E-14`).
- [x] **Mark as Settled & Undo:** Records completed transfers into `settlements`, recomputes net balances and remaining payments immediately, and lets you undo recorded settlements (`T-01`–`T-03`).
- [x] **Filter Expenses by Member:** Filters only the Expense History view while keeping Balances and Settle Up global (`U-03`, `U-04`), automatically resetting to `All Members` if the filtered member is removed (`M-12`).
- [x] **Responsive Desktop & Mobile Layout:** Two-column layout above `960px`, single-column stacked layout on mobile viewports down to `320px` with zero horizontal overflow.

## Architecture Overview

```text
├── index.html                  # Semantic HTML shell, warning banner, custom <dialog> modal
├── styles/
│   └── main.css                # CSS variables, warm monochrome theme, responsive breakpoints
├── src/
│   ├── main.js                 # App bootstrap wiring store <-> UI controllers
│   ├── core/                   # 100% pure domain logic (zero DOM or localStorage access)
│   │   ├── money.js            # Integer paise/bps parsing, formatting, Equal & Hamilton splits
│   │   ├── validators.js       # Member, expense, split, and removal validation rules
│   │   ├── balances.js         # Total paid, share, net balance & zero-sum invariant check
│   │   └── settleUp.js         # Exact Bitmask DP solver & transfer verification helper
│   ├── state/                  # Observable state & persistence layer
│   │   ├── storage.js          # Versioned localStorage schema guard & fault recovery
│   │   └── store.js            # Reactive pub-sub store with canonical state snapshots
│   └── ui/                     # XSS-safe DOM controllers (textContent only)
│       ├── domHelpers.js       # Element creation and inline role="alert" helpers
│       ├── modalView.js        # Accessible Reset Group <dialog> modal controller
│       ├── memberView.js       # Group members chips, count badge, and inline validation
│       ├── expenseFormView.js  # Add Expense form (Equal / Exact / Percentage modes)
│       ├── balanceView.js      # Balances table and ₹0 zero-sum footer
│       ├── settleUpView.js     # Optimal payment rows, Mark as settled, and Undo list
│       └── expenseListView.js  # Newest-first expense cards, member filter, and Delete
└── tests/
    ├── core.test.js            # Unit tests for Phase 1 & Phase 2 core modules
    └── state.test.js           # Store & mocked localStorage resilience tests
```

## Sample Test Case (Verified)

With members **Rahul**, **Priya**, **Aman** and expenses:
1. `Dinner` — `₹900`, paid by `Rahul`, split equally among `Rahul, Priya, Aman`
2. `Cab` — `₹300`, paid by `Priya`, split equally among `Priya, Aman`
3. `Snacks` — `₹150`, paid by `Aman`, split equally among `Rahul, Priya, Aman`

**Balances:** `Rahul` Paid `₹900`, Share `₹350`, Net `+₹550` · `Priya` Paid `₹300`, Share `₹500`, Net `-₹200` · `Aman` Paid `₹150`, Share `₹500`, Net `-₹350` (Sum: `₹0`, Group Total: `₹1,350`).
**Settle Up (2 payments):** `Aman pays Rahul ₹350`, `Priya pays Rahul ₹200`.

## Known Limitations

- **Client-side persistence only:** Data lives in the active browser's `localStorage` and does not sync across devices or browsers; saving very large histories is subject to browser storage quota (`QuotaExceededError` surfaces a non-blocking warning).
- **Single currency (`₹`):** Multi-currency conversion is out of scope; max single expense is capped at `₹1,00,00,000` ($10^9$ paise).
- **Static HTTP server required locally:** Direct `file://` opening is blocked by browser ES module CORS restrictions.
- **Group size bound:** Member cap is enforced at 2–10 members per specification, aligning with the $O(3^k)$ Bitmask DP limit.
