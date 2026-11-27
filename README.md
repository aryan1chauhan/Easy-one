# Expense Splitter (`Easy-one`)

A zero-dependency client-side web application for tracking shared group expenses (2–10 members) in Indian Rupees (`₹`), calculating accurate net balances, and solving debt settlements using the mathematically minimum number of transactions.

## Tech Stack

- **Runtime / UI:** Pure HTML5, CSS3, and native ES6+ modules (no frameworks or build tools required)
- **Persistence:** Browser `localStorage` (`expense_splitter_state_v1`)
- **Tests:** Zero-dependency Node.js test suite (`node:assert/strict`, tested on Node.js v23)

## Current Implementation Status

Currently at **Phase 1 Complete** (scaffolding, integer-paise financial math, input validators, and Phase 1 unit tests):

```text
├── docs/                   # Specification, architecture, edge cases, implementation plan
├── src/
│   ├── core/
│   │   ├── money.js        # Integer paise & bps parsing, formatting, Equal & Hamilton splits
│   │   └── validators.js   # Member & expense input validation + referential integrity
│   ├── state/              # Planned (Phase 3): reactive store & resilient localStorage adapter
│   └── ui/                 # Planned (Phase 4): accessible DOM views & custom modal
├── styles/                 # Planned (Phase 4): responsive stylesheet
└── tests/
    └── core.test.js        # Automated unit test suite
```

## Setup & How to Run

1. **Prerequisites:** [Node.js](https://nodejs.org/) (v18+ with native ES module support; verified on v23.10.0).
2. **Clone the repository:**
   ```bash
   git clone https://github.com/aryan1chauhan/Easy-one.git
   cd Easy-one
   ```
3. **Environment variables:** None required (100% client-side application).
4. **Run the unit test suite:**
   ```bash
   node tests/core.test.js
   ```
