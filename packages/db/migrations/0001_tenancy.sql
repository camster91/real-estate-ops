-- Tenant boundary (ADR 0001, ADR 0010). Synthetic-only until OIDC and admin paths exist.

-- Runtime group role. Roles are cluster-wide while migration locks are per
-- database, so two databases migrating at once can race on CREATE ROLE.
DO $$
BEGIN
	CREATE ROLE reo_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END
$$;

CREATE SCHEMA app;

-- Context is set by withTenant() with set_config(..., true); a malformed value
-- fails the cast, and a missing one yields NULL, which matches no rows.
CREATE FUNCTION app.current_organization_id() RETURNS uuid
	LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
	AS $$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

CREATE FUNCTION app.current_principal_id() RETURNS uuid
	LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
	AS $$ SELECT nullif(current_setting('app.principal_id', true), '')::uuid $$;

CREATE TABLE organization (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	name text NOT NULL CHECK (length(trim(name)) > 0),
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principal (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	oidc_issuer text NOT NULL,
	oidc_subject text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE membership (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	organization_id uuid NOT NULL REFERENCES organization,
	principal_id uuid NOT NULL REFERENCES principal,
	status text NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
	approved_by_principal_id uuid REFERENCES principal,
	approved_at timestamptz,
	effective_from timestamptz NOT NULL DEFAULT now(),
	effective_to timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id),
	UNIQUE (organization_id, principal_id),
	CHECK (status <> 'active' OR (approved_by_principal_id IS NOT NULL AND approved_at IS NOT NULL)),
	CHECK (approved_by_principal_id IS DISTINCT FROM principal_id),
	CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Reads membership as the invoker, so it relies on membership's own policy
-- (which never calls this function, avoiding recursion).
CREATE FUNCTION app.has_active_membership() RETURNS boolean
	LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
	AS $$
		SELECT EXISTS (
			SELECT 1 FROM public.membership m
			WHERE m.organization_id = app.current_organization_id()
				AND m.principal_id = app.current_principal_id()
				AND m.status = 'active'
				AND m.effective_from <= now()
				AND (m.effective_to IS NULL OR now() < m.effective_to)
		)
	$$;

CREATE FUNCTION app.tenant_visible(org uuid) RETURNS boolean
	LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
	AS $$ SELECT org = app.current_organization_id() AND app.has_active_membership() $$;

CREATE TABLE branch (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	name text NOT NULL CHECK (length(trim(name)) > 0),
	version integer NOT NULL DEFAULT 1,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id)
);

-- The composite key makes a cross-tenant branch reference fail at the database.
CREATE TABLE team (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	branch_id uuid NOT NULL,
	name text NOT NULL CHECK (length(trim(name)) > 0),
	version integer NOT NULL DEFAULT 1,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id),
	FOREIGN KEY (organization_id, branch_id) REFERENCES branch (organization_id, id)
);

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
ALTER TABLE principal ENABLE ROW LEVEL SECURITY;
ALTER TABLE principal FORCE ROW LEVEL SECURITY;
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
ALTER TABLE branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch FORCE ROW LEVEL SECURITY;
ALTER TABLE team ENABLE ROW LEVEL SECURITY;
ALTER TABLE team FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_member_read ON organization
	FOR SELECT USING (app.tenant_visible(id));
CREATE POLICY principal_self_read ON principal
	FOR SELECT USING (id = app.current_principal_id());
CREATE POLICY membership_self_read ON membership
	FOR SELECT USING (
		organization_id = app.current_organization_id()
		AND principal_id = app.current_principal_id()
	);
CREATE POLICY branch_tenant ON branch
	FOR ALL USING (app.tenant_visible(organization_id))
	WITH CHECK (app.tenant_visible(organization_id));
CREATE POLICY team_tenant ON team
	FOR ALL USING (app.tenant_visible(organization_id))
	WITH CHECK (app.tenant_visible(organization_id));

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA public, app TO reo_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO reo_app;
GRANT SELECT ON organization, principal, membership TO reo_app;
GRANT SELECT, INSERT, UPDATE ON branch, team TO reo_app;
