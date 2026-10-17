#!/usr/bin/env bash
# Runs scripts/verify-friends-sql.sql against a throwaway database on a local PostgreSQL (apt-get
# install -y postgresql; service postgresql start). Run as root: it uses `su postgres`. The stub
# Supabase roles (anon, authenticated, service_role) are cluster-wide, so they are dropped around the run.
set -uo pipefail
cd "$(dirname "$0")/.."
DB=em_friends_verify
cleanup() {
  su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1
  su postgres -c "psql -X -q -c 'drop role if exists anon' -c 'drop role if exists authenticated' -c 'drop role if exists service_role'" >/dev/null 2>&1
}
cleanup
su postgres -c "createdb $DB"
chmod -R a+rX . 2>/dev/null || true
su postgres -c "psql -X -v ON_ERROR_STOP=1 -d $DB -f scripts/verify-friends-sql.sql" 2>&1
status=$?
cleanup
exit $status
