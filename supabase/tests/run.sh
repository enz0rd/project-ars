#!/usr/bin/env bash
# Runs the migrations and policy tests on a throwaway Postgres container.
# Usage: supabase/tests/run.sh   (needs docker or podman)
set -euo pipefail
cd "$(dirname "$0")/../.."
if docker info >/dev/null 2>&1; then RUNTIME=docker; else RUNTIME=podman; fi
NAME=ars-policy-test-$$
"$RUNTIME" run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=test docker.io/library/postgres:17-alpine >/dev/null
trap '"$RUNTIME" rm -f "$NAME" >/dev/null' EXIT
until "$RUNTIME" exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
psql() { "$RUNTIME" exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql < supabase/tests/stubs.sql >/dev/null
for f in supabase/migrations/*.sql; do psql < "$f" >/dev/null; done
out=$(psql < supabase/tests/policies.sql 2>&1 | sed -n 's/.*NOTICE:  //p')

# Parallel inserts must not get past the limit.
psql -c "insert into auth.users values ('00000000-0000-0000-0000-0000000000cc', 'c@test')" >/dev/null
for i in $(seq 1 8); do
  "$RUNTIME" exec "$NAME" psql -U postgres -q -c "set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000cc'; insert into public.projects (name) values ('p$i')" >/dev/null 2>&1 &
done
wait
n=$(psql -tA -c "select count(*) from public.projects where owner_id = '00000000-0000-0000-0000-0000000000cc'")
if [ "$n" = 5 ]; then out+=$'\n'"PASS limit holds under 8 parallel inserts"; else out+=$'\n'"FAIL limit holds under 8 parallel inserts (got $n)"; fi

echo "$out"
! echo "$out" | command grep -q '^FAIL'
