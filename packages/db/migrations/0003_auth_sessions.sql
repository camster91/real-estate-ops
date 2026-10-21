-- Sign-in identity lookup and server-side sessions (ADR 0012).
--
-- Before a tenant context exists, the API must map a verified OIDC (issuer,
-- subject) to a principal and check a session cookie. The runtime role reo_app
-- cannot read principal or membership without a context, so these lookups are
-- narrow SECURITY DEFINER functions owned by reo_auth, a NOLOGIN role that is
-- the only one with policies on these tables outside a tenant context. reo_app
-- can only EXECUTE the five functions below; it has no table access to
-- auth_session at all. Only a SHA-256 hash of the session token is stored.

DO $$
BEGIN
	CREATE ROLE reo_auth NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
EXCEPTION
	WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

CREATE TABLE auth_session (
	token_hash bytea PRIMARY KEY CHECK (length(token_hash) = 32),
	principal_id uuid NOT NULL REFERENCES principal,
	created_at timestamptz NOT NULL DEFAULT now(),
	last_seen_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	revoked_at timestamptz,
	-- Absolute lifetime is fixed; idle expiry is enforced on read.
	CHECK (expires_at = created_at + interval '12 hours')
);

CREATE INDEX auth_session_principal ON auth_session (principal_id);

ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session FORCE ROW LEVEL SECURITY;

CREATE POLICY auth_session_auth ON auth_session
	FOR ALL TO reo_auth USING (true) WITH CHECK (true);
CREATE POLICY principal_auth_read ON principal
	FOR SELECT TO reo_auth USING (true);
CREATE POLICY membership_auth_read ON membership
	FOR SELECT TO reo_auth USING (true);

GRANT USAGE ON SCHEMA public, app TO reo_auth;
GRANT SELECT ON principal, membership TO reo_auth;
GRANT SELECT, INSERT, UPDATE ON auth_session TO reo_auth;

-- Same rule as app.has_active_membership(), for an explicit principal and any
-- tenant. Internal: only reo_auth may call it.
CREATE FUNCTION app.principal_is_active(p_principal uuid) RETURNS boolean
	LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (
			SELECT 1 FROM public.membership m
			WHERE m.principal_id = p_principal
				AND m.status = 'active'
				AND m.effective_from <= now()
				AND (m.effective_to IS NULL OR now() < m.effective_to)
		)
	$$;

-- The principal for a verified identity, or NULL when unknown or without an
-- active membership. Never creates a principal.
CREATE FUNCTION app.resolve_principal(p_issuer text, p_subject text) RETURNS uuid
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
	AS $$
		SELECT p.id FROM public.principal p
		WHERE p.oidc_issuer = p_issuer AND p.oidc_subject = p_subject
			AND app.principal_is_active(p.id)
	$$;

-- Stores a new session for an active principal and returns its absolute
-- expiry; returns NULL (and stores nothing) for anyone else.
CREATE FUNCTION app.open_session(p_principal uuid, p_token_hash bytea) RETURNS timestamptz
	LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
	AS $$
		INSERT INTO public.auth_session (token_hash, principal_id, created_at, last_seen_at, expires_at)
		SELECT p_token_hash, p_principal, now(), now(), now() + interval '12 hours'
		WHERE app.principal_is_active(p_principal)
		RETURNING expires_at
	$$;

-- The principal for a live session, refreshing its idle timer. A session is
-- live when it is not revoked, is inside its 12-hour lifetime, was used in the
-- last 30 minutes, and its principal still has an active membership.
CREATE FUNCTION app.session_principal(p_token_hash bytea) RETURNS uuid
	LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
	AS $$
		UPDATE public.auth_session s SET last_seen_at = now()
		WHERE s.token_hash = p_token_hash
			AND s.revoked_at IS NULL
			AND now() < s.expires_at
			AND now() < s.last_seen_at + interval '30 minutes'
			AND app.principal_is_active(s.principal_id)
		RETURNING s.principal_id
	$$;

-- Organisations where a live session's principal is an active member. Does not
-- refresh the idle timer.
CREATE FUNCTION app.session_memberships(p_token_hash bytea) RETURNS SETOF uuid
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
	AS $$
		SELECT m.organization_id
		FROM public.auth_session s
		JOIN public.membership m ON m.principal_id = s.principal_id
		WHERE s.token_hash = p_token_hash
			AND s.revoked_at IS NULL
			AND now() < s.expires_at
			AND now() < s.last_seen_at + interval '30 minutes'
			AND m.status = 'active'
			AND m.effective_from <= now()
			AND (m.effective_to IS NULL OR now() < m.effective_to)
	$$;

CREATE FUNCTION app.close_session(p_token_hash bytea) RETURNS void
	LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
	AS $$
		UPDATE public.auth_session SET revoked_at = now()
		WHERE token_hash = p_token_hash AND revoked_at IS NULL
	$$;

ALTER FUNCTION app.principal_is_active(uuid) OWNER TO reo_auth;
ALTER FUNCTION app.resolve_principal(text, text) OWNER TO reo_auth;
ALTER FUNCTION app.open_session(uuid, bytea) OWNER TO reo_auth;
ALTER FUNCTION app.session_principal(bytea) OWNER TO reo_auth;
ALTER FUNCTION app.session_memberships(bytea) OWNER TO reo_auth;
ALTER FUNCTION app.close_session(bytea) OWNER TO reo_auth;

-- New functions are executable by PUBLIC by default; narrow that.
REVOKE EXECUTE ON FUNCTION
	app.principal_is_active(uuid),
	app.resolve_principal(text, text),
	app.open_session(uuid, bytea),
	app.session_principal(bytea),
	app.session_memberships(bytea),
	app.close_session(bytea)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
	app.resolve_principal(text, text),
	app.open_session(uuid, bytea),
	app.session_principal(bytea),
	app.session_memberships(bytea),
	app.close_session(bytea)
TO reo_app;
