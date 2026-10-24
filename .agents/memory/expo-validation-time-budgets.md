---
name: Expo validation time budgets
description: Resource-related export timeouts and cold route-import test failures.
---

An export exceeding the foreground shell timeout is not evidence of a compiler error.

**Why:** Cold Metro graph preparation can outlast the shell's five-minute limit without emitting a source error; a bounded background export can complete successfully.

**How to apply:** Use a bounded background run for long exports, retain its log, and verify both the exit code and generated index. Avoid restarting Metro or clearing its shared cache during an export. Preserve the last working static preview before replacing build output.

Cold API route imports can exceed Vitest's default per-test timeout. A timed-out asynchronous test can continue running and mutate shared fixtures after the next test resets them.

**Why:** This produced misleading later state assertions even though the unchanged route tests passed with sufficient execution time.

**How to apply:** Before changing app behavior or assertions, replay the unchanged file without competing heavy builds and with an explicitly larger CLI timeout. Report the execution condition rather than claiming a product fix.
