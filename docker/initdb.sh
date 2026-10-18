#!/bin/sh
# Runs once, when the Postgres volume is first created.
# Creates a NON-superuser owner for the app (superusers bypass row-level security) and the app role it switches to.
set -eu
: "${DARA_DB_PASSWORD:?DARA_DB_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v pw="$DARA_DB_PASSWORD" <<'SQL'
CREATE ROLE dara_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB CREATEROLE PASSWORD :'pw';
CREATE ROLE dara_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT dara_app TO dara_owner WITH ADMIN OPTION;
CREATE DATABASE dara OWNER dara_owner;
REVOKE ALL ON DATABASE dara FROM PUBLIC;
GRANT CONNECT ON DATABASE dara TO dara_owner;
SQL
