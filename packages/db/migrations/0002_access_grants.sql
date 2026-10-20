-- Record-level access grants (ADR 0011). One row is one complete grant: a
-- principal, one action, one exact resource, one classification, one purpose,
-- and a finite validity window. Rows never combine into wider access.

CREATE FUNCTION app.current_purpose() RETURNS text
	LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
	AS $$ SELECT nullif(current_setting('app.purpose', true), '') $$;

CREATE TABLE access_grant (
	organization_id uuid NOT NULL,
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	principal_id uuid NOT NULL,
	-- The @reo/auth action names; keep in step with packages/auth actionLevels.
	action text NOT NULL CHECK (action IN (
		'record.read', 'task.create', 'communication.draft', 'communication.send',
		'calendar.modify', 'signature.send', 'regulatory.submit', 'permission.modify',
		'record.delete', 'money.move', 'security.bypass', 'compliance.bypass',
		'agent.expand_permissions'
	)),
	resource_type text NOT NULL CHECK (resource_type ~ '^[a-z][a-z_]{0,62}$'),
	resource_id uuid NOT NULL,
	classification text NOT NULL
		CHECK (classification IN ('operational', 'personal', 'financial', 'restricted_compliance')),
	purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{0,63}$'),
	valid_from timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	revoked_at timestamptz,
	granted_by_principal_id uuid NOT NULL REFERENCES principal,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id),
	-- Only a member of this tenant can hold a grant in it.
	FOREIGN KEY (organization_id, principal_id) REFERENCES membership (organization_id, principal_id),
	CHECK (expires_at > valid_from),
	-- "Always expires": reject infinity / -infinity, which pass NOT NULL.
	CHECK (isfinite(valid_from) AND isfinite(expires_at)),
	CHECK (granted_by_principal_id <> principal_id)
);

CREATE INDEX access_grant_lookup
	ON access_grant (organization_id, principal_id, action, resource_type, resource_id);

ALTER TABLE access_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_grant FORCE ROW LEVEL SECURITY;

CREATE POLICY access_grant_self_read ON access_grant
	FOR SELECT USING (
		organization_id = (SELECT app.current_organization_id())
		AND principal_id = (SELECT app.current_principal_id())
		AND (SELECT app.has_active_membership())
	);

-- The read filter: what the current principal may read in the current tenant,
-- for the current purpose, right now. A view (not a function) so the planner
-- merges it into the caller's query and turns EXISTS (...) into a semi-join;
-- PostgreSQL never inlines a SQL function whose body contains a subquery, so a
-- function here would run once per row. security_invoker applies the caller's
-- privileges and access_grant RLS (own grants, active membership only).
CREATE VIEW app.readable_record WITH (security_invoker = true) AS
	SELECT g.resource_type, g.resource_id, g.classification
	FROM public.access_grant g
	WHERE g.organization_id = (SELECT app.current_organization_id())
		AND g.principal_id = (SELECT app.current_principal_id())
		AND g.action = 'record.read'
		AND g.purpose = (SELECT app.current_purpose())
		AND g.revoked_at IS NULL
		AND g.valid_from <= now()
		AND now() < g.expires_at;

REVOKE EXECUTE ON FUNCTION app.current_purpose() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_purpose() TO reo_app;
GRANT SELECT ON access_grant, app.readable_record TO reo_app;
