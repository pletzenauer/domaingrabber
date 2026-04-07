CREATE TABLE dissolutions (
  id               SERIAL PRIMARY KEY,
  company_name     TEXT NOT NULL,
  company_slug     TEXT,
  court            TEXT,
  proceeding_type  TEXT,
  gazette_date     DATE,
  source           TEXT,
  source_url       TEXT,
  source_ref       TEXT,
  existing_website TEXT,
  raw_data         JSONB,
  enriched_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE domains (
  id              SERIAL PRIMARY KEY,
  dissolution_id  INTEGER REFERENCES dissolutions(id),
  domain          TEXT NOT NULL UNIQUE,
  tld             TEXT,
  status          TEXT DEFAULT 'unknown',
  expiry_date     DATE,
  registrar       TEXT,
  whois_raw       TEXT,
  rdap_raw        JSONB,
  last_checked    TIMESTAMPTZ,
  alert_sent      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alert_log (
  id          SERIAL PRIMARY KEY,
  domain_id   INTEGER REFERENCES domains(id),
  alert_type  TEXT,
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  payload     JSONB
);

CREATE TABLE scraper_runs (
  id          SERIAL PRIMARY KEY,
  source      TEXT,
  status      TEXT,
  records_new INTEGER DEFAULT 0,
  error_msg   TEXT,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dissolutions_slug ON dissolutions(company_slug);
CREATE INDEX idx_dissolutions_source ON dissolutions(source);
CREATE INDEX idx_dissolutions_date ON dissolutions(gazette_date DESC);
CREATE INDEX idx_domains_status ON domains(status);
CREATE INDEX idx_domains_expiry ON domains(expiry_date);
