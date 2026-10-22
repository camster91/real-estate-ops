-- Organisation names for a session's own active memberships (ADR 0016), so the
-- website can show a brokerage picker. Same validity rules as
-- app.session_memberships; does not refresh the idle timer. The runtime role
-- still cannot read organisation rows outside a tenant context.

CREATE POLICY organization_auth_read ON organization
	FOR SELECT TO reo_auth USING (true);
GRANT SELECT ON organization TO reo_auth;

CREATE FUNCTION app.session_organizations(p_token_hash bytea)
	RETURNS TABLE (organization_id uuid, name text)
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
	AS $$
		SELECT o.id, o.name
		FROM public.auth_session s
		JOIN public.membership m ON m.principal_id = s.principal_id
		JOIN public.organization o ON o.id = m.organization_id
		WHERE s.token_hash = p_token_hash
			AND s.revoked_at IS NULL
			AND now() < s.expires_at
			AND now() < s.last_seen_at + interval '30 minutes'
			AND m.status = 'active'
			AND m.effective_from <= now()
			AND (m.effective_to IS NULL OR now() < m.effective_to)
		ORDER BY o.name, o.id
	$$;

ALTER FUNCTION app.session_organizations(bytea) OWNER TO reo_auth;
REVOKE EXECUTE ON FUNCTION app.session_organizations(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.session_organizations(bytea) TO reo_app;
