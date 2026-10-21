-- Single-use login state (ADR 0012). The login callback claims a hash of its
-- OIDC state before redeeming the code, so a replayed callback fails here even
-- if a provider would redeem the same code twice. Rows only need to outlive
-- the 600-second login cookie; claiming also deletes rows older than an hour.

CREATE TABLE login_state_use (
	state_hash bytea PRIMARY KEY CHECK (length(state_hash) = 32),
	used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_state_use_used_at ON login_state_use (used_at);

ALTER TABLE login_state_use ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_state_use FORCE ROW LEVEL SECURITY;

CREATE POLICY login_state_use_auth ON login_state_use
	FOR ALL TO reo_auth USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, DELETE ON login_state_use TO reo_auth;

-- True the first time a state hash is claimed, false every time after.
CREATE FUNCTION app.claim_login_state(p_state_hash bytea) RETURNS boolean
	LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
	AS $$
		DELETE FROM public.login_state_use WHERE used_at < now() - interval '1 hour';
		INSERT INTO public.login_state_use (state_hash) VALUES (p_state_hash)
		ON CONFLICT (state_hash) DO NOTHING
		RETURNING true;
	$$;

ALTER FUNCTION app.claim_login_state(bytea) OWNER TO reo_auth;
REVOKE EXECUTE ON FUNCTION app.claim_login_state(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_login_state(bytea) TO reo_app;
