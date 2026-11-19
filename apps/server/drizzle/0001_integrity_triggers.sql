-- Integrity triggers that cannot be expressed declaratively in the Drizzle schema.

-- 1. The share issuance ledger is immutable: no UPDATE, DELETE or TRUNCATE, ever.
--    (Simulation resets start a new epoch instead of deleting issuance rows.)
CREATE OR REPLACE FUNCTION aez_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% forbidden)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER security_issuance_immutable_row
  BEFORE UPDATE OR DELETE ON security_issuance
  FOR EACH ROW EXECUTE FUNCTION aez_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER security_issuance_immutable_truncate
  BEFORE TRUNCATE ON security_issuance
  FOR EACH STATEMENT EXECUTE FUNCTION aez_forbid_mutation();
--> statement-breakpoint

-- 2. Executions, ledgers and price history are append-only. Rows may only be
--    deleted by the explicitly confirmed administrative simulation reset, which
--    sets the transaction-local flag aez.allow_reset = 'on'.
CREATE OR REPLACE FUNCTION aez_append_only_except_reset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('aez.allow_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'table % is append-only (% forbidden)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trades_append_only BEFORE UPDATE OR DELETE ON trades
  FOR EACH ROW EXECUTE FUNCTION aez_append_only_except_reset();
--> statement-breakpoint
CREATE TRIGGER cash_ledger_append_only BEFORE UPDATE OR DELETE ON cash_ledger
  FOR EACH ROW EXECUTE FUNCTION aez_append_only_except_reset();
--> statement-breakpoint
CREATE TRIGGER position_ledger_append_only BEFORE UPDATE OR DELETE ON position_ledger
  FOR EACH ROW EXECUTE FUNCTION aez_append_only_except_reset();
--> statement-breakpoint
CREATE TRIGGER price_history_append_only BEFORE UPDATE OR DELETE ON price_history
  FOR EACH ROW EXECUTE FUNCTION aez_append_only_except_reset();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION aez_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER trades_no_truncate BEFORE TRUNCATE ON trades
  FOR EACH STATEMENT EXECUTE FUNCTION aez_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER cash_ledger_no_truncate BEFORE TRUNCATE ON cash_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION aez_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER position_ledger_no_truncate BEFORE TRUNCATE ON position_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION aez_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION aez_forbid_mutation();
--> statement-breakpoint

-- 3. Singleton market state row.
INSERT INTO market_state (id, current_epoch) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;
