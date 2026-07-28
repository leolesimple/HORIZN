CREATE TABLE IF NOT EXISTS stops (
  stop_id         TEXT PRIMARY KEY,
  stop_name       TEXT,
  stop_lat        REAL,
  stop_lon        REAL,
  zone_id         TEXT,
  location_type   INTEGER,
  parent_station  TEXT
);

CREATE TABLE IF NOT EXISTS routes (
  route_id         TEXT PRIMARY KEY,
  route_short_name TEXT,
  route_type       INTEGER,
  route_color      TEXT
);

CREATE TABLE IF NOT EXISTS trips (
  trip_id      TEXT PRIMARY KEY,
  route_id     TEXT,
  service_id   TEXT,
  shape_id     TEXT,
  trip_headsign TEXT
);

CREATE TABLE IF NOT EXISTS stop_times (
  trip_id        TEXT,
  stop_id        TEXT,
  arrival_time   TEXT,
  departure_time TEXT,
  stop_sequence  INTEGER
);

-- Pas d'index sur stop_times ici : ils sont créés APRÈS le chargement en masse
-- par setupGTFS.js (createIndexes). Les créer avant coûtait 2 insertions B-tree
-- aléatoires par ligne sur 10,4M lignes = 66 % du temps d'import.

CREATE TABLE IF NOT EXISTS calendar (
  service_id  TEXT PRIMARY KEY,
  monday      INTEGER NOT NULL DEFAULT 0,
  tuesday     INTEGER NOT NULL DEFAULT 0,
  wednesday   INTEGER NOT NULL DEFAULT 0,
  thursday    INTEGER NOT NULL DEFAULT 0,
  friday      INTEGER NOT NULL DEFAULT 0,
  saturday    INTEGER NOT NULL DEFAULT 0,
  sunday      INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT,
  end_date    TEXT
);

CREATE TABLE IF NOT EXISTS shapes (
  shape_id         TEXT,
  shape_pt_lat     REAL,
  shape_pt_lon     REAL,
  shape_pt_sequence INTEGER
);

-- idem : voir createIndexes() dans setupGTFS.js
