# Sourced by run.sh. Everything points at a LOCAL throwaway Postgres; never a real DB.
export DATABASE_URL="${LT_DATABASE_URL:-postgres://pguser@localhost:5433/bt}"
export PORT="${PORT:-5055}" NODE_ENV=production LOG_LEVEL=error LOADTEST_AUTH_STUB=1
export CLERK_PUBLISHABLE_KEY=pk_test_bG9hZHRlc3QuY2xlcmsuYWNjb3VudHMuZGV2JA CLERK_SECRET_KEY=sk_test_loadtest SESSION_SECRET=loadtest
export STRIPE_SECRET_KEY=sk_test_loadtest STRIPE_WEBHOOK_SECRET=whsec_loadtest
# Dummy values so module-load checks pass; the load test never calls these services.
export AI_INTEGRATIONS_OPENAI_BASE_URL=http://127.0.0.1:9 AI_INTEGRATIONS_OPENAI_API_KEY=unused
if [ -n "${LT_REDIS_URL:-}" ]; then export REDIS_URL="$LT_REDIS_URL"; fi
