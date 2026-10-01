---
name: Non-interactive database bootstrap
description: Drizzle CLI success does not prove schema preparation succeeded in unattended runs.
---

Do not trust `drizzle-kit push --force` exit zero as proof of schema preparation in unattended execution.

**Why:** A rename decision still requires a TTY even with force enabled. The installed Drizzle CLI catches the resulting prompt exception, prints it, and exits zero while leaving the required column absent. This was reproduced against a disposable PostgreSQL cluster with a minimal rename fixture.

**How to apply:** Automated bootstraps need deterministic schema generation and independent schema verification, not merely subprocess exit checks. Preserve database isolation and refuse ambiguous existing schemas rather than silently resetting data.

For Drizzle generation, use either a config file or the complete CLI option set; do not mix `--config` and `--out`.

**Why:** The installed CLI rejects that combination before generating SQL. A fresh temporary migration history avoids rename decisions without requiring an interactive terminal.

**How to apply:** When changing unattended setup, test both empty and provisioned databases with piped/ignored standard input, including zero-exit/no-artifact and SQL-application failures.