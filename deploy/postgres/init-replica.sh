#!/bin/bash
# Initial setup for streaming replication. Runs once when the primary
# Postgres container is first created (postgres image runs every script
# under /docker-entrypoint-initdb.d on the empty data directory).
#
# Creates the replication role + grants. The replica container runs
# pg_basebackup against this role on its first boot.

set -e

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '$POSTGRES_REPLICATION_PASSWORD';
EOSQL

# Allow streaming connections from the docker network (any host inside the
# same compose network resolves to the same private subnet).
echo "host replication replicator 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
