BEGIN;

CREATE TABLE IF NOT EXISTS clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT,
  age INTEGER,
  gender TEXT,
  nationality TEXT,
  country_of_residence TEXT,
  tax_domicile TEXT,
  booking_centre TEXT,
  rm_id TEXT,
  rm_name TEXT,
  rm_desk TEXT,
  base_currency TEXT,
  wealth_band TEXT,
  total_aum_usd DOUBLE PRECISION,
  life_stage TEXT,
  source_of_wealth TEXT,
  risk_profile TEXT,
  risk_tolerance_score INTEGER,
  investment_horizon_years INTEGER,
  liquidity_needs TEXT,
  objectives TEXT,
  client_since TEXT,
  kyc_review_due TEXT,
  pep_status TEXT,
  reporting_language TEXT
);

CREATE TABLE IF NOT EXISTS portfolios (
  portfolio_id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(client_id),
  portfolio_name TEXT,
  mandate_code TEXT,
  mandate_name TEXT,
  service_model TEXT,
  base_currency TEXT,
  inception_date TEXT,
  benchmark TEXT,
  aum_usd_current DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS holdings (
  snapshot_date TEXT,
  portfolio_id TEXT,
  client_id TEXT,
  instrument_id TEXT,
  instrument_name TEXT,
  asset_class TEXT,
  sub_asset_class TEXT,
  sector TEXT,
  region TEXT,
  instrument_ccy TEXT,
  quantity DOUBLE PRECISION,
  price_local DOUBLE PRECISION,
  market_value_local DOUBLE PRECISION,
  portfolio_ccy TEXT,
  market_value_base DOUBLE PRECISION,
  market_value_usd DOUBLE PRECISION,
  weight_pct DOUBLE PRECISION,
  avg_cost_local DOUBLE PRECISION,
  cost_basis_base DOUBLE PRECISION,
  unrealised_pnl_base DOUBLE PRECISION,
  unrealised_pnl_pct DOUBLE PRECISION,
  lending_value_base DOUBLE PRECISION,
  advance_rate_pct DOUBLE PRECISION,
  liquidity_tier TEXT,
  valuation_date TEXT,
  acquired_date TEXT,
  PRIMARY KEY (snapshot_date, portfolio_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS instruments (
  instrument_id TEXT PRIMARY KEY,
  instrument_name TEXT,
  asset_class TEXT,
  sub_asset_class TEXT,
  sector TEXT,
  region TEXT,
  currency TEXT,
  liquidity_tier TEXT,
  underlying_reference TEXT,
  sustainability_excluded TEXT,
  concentration_limit_applies TEXT
);

CREATE TABLE IF NOT EXISTS mandates (
  mandate_code TEXT,
  mandate_name TEXT,
  asset_class TEXT,
  min_pct DOUBLE PRECISION,
  target_pct DOUBLE PRECISION,
  max_pct DOUBLE PRECISION,
  max_single_position_pct DOUBLE PRECISION,
  mandate_notes TEXT,
  PRIMARY KEY (mandate_code, asset_class)
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  trade_date TEXT,
  settlement_date TEXT,
  portfolio_id TEXT,
  client_id TEXT,
  transaction_type TEXT,
  instrument_id TEXT,
  instrument_name TEXT,
  quantity DOUBLE PRECISION,
  price_local DOUBLE PRECISION,
  currency TEXT,
  amount DOUBLE PRECISION,
  narrative TEXT
);

CREATE TABLE IF NOT EXISTS credit_facilities (
  facility_id TEXT PRIMARY KEY,
  client_id TEXT,
  collateral_portfolio_id TEXT,
  facility_type TEXT,
  facility_ccy TEXT,
  credit_limit DOUBLE PRECISION,
  interest_rate_pct DOUBLE PRECISION,
  margin_call_ltv_pct DOUBLE PRECISION,
  utilisation_pct_current DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS commitments (
  commitment_id TEXT PRIMARY KEY,
  client_id TEXT,
  portfolio_id TEXT,
  fund_name TEXT,
  currency TEXT,
  committed DOUBLE PRECISION,
  called_to_date DOUBLE PRECISION,
  uncalled DOUBLE PRECISION,
  expected_call_window TEXT
);

CREATE TABLE IF NOT EXISTS planned_cash_needs (
  need_id TEXT PRIMARY KEY,
  client_id TEXT,
  description TEXT,
  currency TEXT,
  amount DOUBLE PRECISION,
  due_from TEXT,
  due_to TEXT,
  recurrence TEXT,
  certainty TEXT
);

CREATE TABLE IF NOT EXISTS market_context (
  snapshot_date TEXT,
  series_id TEXT,
  series_name TEXT,
  category TEXT,
  unit TEXT,
  value DOUBLE PRECISION,
  snapshot_label TEXT,
  PRIMARY KEY (snapshot_date, series_id)
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  event_date TEXT,
  event_type TEXT,
  region TEXT,
  description TEXT,
  primary_transmission TEXT,
  severity TEXT,
  transmission_tokens TEXT
);

CREATE TABLE IF NOT EXISTS rm_notes (
  note_id TEXT PRIMARY KEY,
  client_id TEXT,
  note_date TEXT,
  rm_id TEXT,
  rm_name TEXT,
  channel TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS instrument_prices (
  instrument_id TEXT,
  snapshot_date TEXT,
  price DOUBLE PRECISION,
  PRIMARY KEY (instrument_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS portfolio_aum (
  portfolio_id TEXT,
  snapshot_date TEXT,
  aum_base DOUBLE PRECISION,
  PRIMARY KEY (portfolio_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS facility_snapshots (
  facility_id TEXT,
  snapshot_date TEXT,
  drawn DOUBLE PRECISION,
  collateral_market_value DOUBLE PRECISION,
  lending_value DOUBLE PRECISION,
  ltv_pct DOUBLE PRECISION,
  headroom DOUBLE PRECISION,
  PRIMARY KEY (facility_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS fx_rates (
  snapshot_date TEXT,
  ccy TEXT,
  usd_per_unit DOUBLE PRECISION,
  PRIMARY KEY (snapshot_date, ccy)
);

CREATE TABLE IF NOT EXISTS data_quality_flags (
  flag_id TEXT PRIMARY KEY,
  severity TEXT,
  scope_type TEXT,
  scope_id TEXT,
  code TEXT,
  description TEXT,
  source_ref TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  signal_id TEXT PRIMARY KEY,
  client_id TEXT,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS groundings (
  signal_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  input_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS narratives (
  client_id TEXT PRIMARY KEY,
  payload TEXT,
  input_hash TEXT
);

CREATE TABLE IF NOT EXISTS diversification_plans (
  plan_id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS priorities (
  run_id TEXT,
  rank INTEGER,
  client_id TEXT,
  payload TEXT,
  PRIMARY KEY (run_id, client_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  chain_seq BIGSERIAL UNIQUE NOT NULL,
  entry_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  rm_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  before TEXT NOT NULL,
  after TEXT,
  reason_code TEXT,
  reason_text TEXT,
  confidence_at_decision INTEGER NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  context_pack_hash TEXT,
  source_refs TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  rm_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS request_rate_limits (
  bucket TEXT NOT NULL,
  principal_hash TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (bucket, principal_hash)
);

CREATE TABLE IF NOT EXISTS ai_budget_usage (
  usage_date TEXT NOT NULL,
  rm_id TEXT NOT NULL,
  reserved_tokens INTEGER NOT NULL,
  PRIMARY KEY (usage_date, rm_id)
);

CREATE TABLE IF NOT EXISTS ai_concurrency_leases (
  lease_id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_audit_log (
  chain_seq BIGSERIAL UNIQUE NOT NULL,
  event_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  rm_id TEXT,
  event_type TEXT NOT NULL,
  target TEXT NOT NULL,
  client_id TEXT,
  metadata TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  conversation_id TEXT PRIMARY KEY,
  rm_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(conversation_id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_rm_name
  ON clients(rm_id, client_name);
CREATE INDEX IF NOT EXISTS idx_portfolios_client
  ON portfolios(client_id);
CREATE INDEX IF NOT EXISTS idx_holdings_client_snapshot_value
  ON holdings(client_id, snapshot_date, market_value_usd DESC);
CREATE INDEX IF NOT EXISTS idx_holdings_portfolio_instrument_snapshot
  ON holdings(portfolio_id, instrument_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_transactions_portfolio_trade_date
  ON transactions(portfolio_id, trade_date);
CREATE INDEX IF NOT EXISTS idx_transactions_client_trade_date
  ON transactions(client_id, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_credit_facilities_client
  ON credit_facilities(client_id);
CREATE INDEX IF NOT EXISTS idx_commitments_client_window
  ON commitments(client_id, expected_call_window);
CREATE INDEX IF NOT EXISTS idx_cash_needs_client_due
  ON planned_cash_needs(client_id, due_from);
CREATE INDEX IF NOT EXISTS idx_rm_notes_client_date
  ON rm_notes(client_id, note_date DESC);
CREATE INDEX IF NOT EXISTS idx_data_quality_scope
  ON data_quality_flags(scope_id);
CREATE INDEX IF NOT EXISTS idx_signals_client
  ON signals(client_id);
CREATE INDEX IF NOT EXISTS idx_diversification_signal
  ON diversification_plans(signal_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_diversification_client
  ON diversification_plans(client_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_priorities_latest
  ON priorities(run_id DESC, rank);
CREATE INDEX IF NOT EXISTS idx_priorities_client_run
  ON priorities(client_id, run_id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target_latest
  ON audit_log(target_type, target_id, client_id, chain_seq DESC);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_concurrency_principal_expiry
  ON ai_concurrency_leases(principal, expires_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_latest
  ON security_audit_log(chain_seq DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_owner
  ON chat_conversations(rm_id, client_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages(conversation_id, created_at);

COMMIT;
