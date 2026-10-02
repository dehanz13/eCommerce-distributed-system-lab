#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v ordering_user="$ORDERING_USER" -v ordering_password="$ORDERING_PASSWORD" -v ordering_db="$ORDERING_DB" \
  -v fulfillment_user="$FULFILLMENT_USER" -v fulfillment_password="$FULFILLMENT_PASSWORD" -v fulfillment_db="$FULFILLMENT_DB" <<'SQL'
CREATE USER :"ordering_user" PASSWORD :'ordering_password';
CREATE USER :"fulfillment_user" PASSWORD :'fulfillment_password';
CREATE DATABASE :"ordering_db" OWNER :"ordering_user";
CREATE DATABASE :"fulfillment_db" OWNER :"fulfillment_user";
SQL
