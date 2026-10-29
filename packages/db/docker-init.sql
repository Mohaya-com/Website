-- Executed once by the postgres Docker image on first start (see docker-compose.yml).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE DATABASE vms_test OWNER vms;
\connect vms_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
