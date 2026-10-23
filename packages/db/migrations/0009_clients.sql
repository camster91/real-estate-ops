-- Clients, first slice (ADR 0019; Party from docs/product/CORE_MODEL.md).
--
-- A party is a person the brokerage works with. This slice stores people only,
-- with one optional email and phone; contact points with consent and proof
-- come in slice 2 (docs/roadmap/PILOT.md). A client is visible only to its
-- assigned agent and its creator, while they have an active membership; a
-- member may add clients only for themselves. Kind, classification, version
-- and created_at always take their defaults (column-level grant). Rules match
-- @reo/domain parseNewClient.

CREATE TABLE party (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL,
	kind text NOT NULL DEFAULT 'person' CHECK (kind IN ('person')),
	display_name text NOT NULL CHECK (
		char_length(display_name) BETWEEN 1 AND 200
		-- Explicit ranges so the rule does not depend on the database locale.
		AND display_name !~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]'
		AND btrim(display_name) = display_name
	),
	email text CHECK (
		email IS NULL OR (
			char_length(email) <= 254
			AND email = lower(email)
			-- Controls (including tabs and newlines) are refused by the next line.
			AND email ~ '^[^ @]+@[^ @]+\.[^ @]+$'
			AND email !~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]'
		)
	),
	phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
	assigned_principal_id uuid NOT NULL,
	created_by_principal_id uuid NOT NULL,
	classification text NOT NULL DEFAULT 'personal'
		CHECK (classification IN ('operational', 'personal', 'financial', 'restricted_compliance')),
	version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id),
	FOREIGN KEY (organization_id, assigned_principal_id)
		REFERENCES membership (organization_id, principal_id),
	FOREIGN KEY (organization_id, created_by_principal_id)
		REFERENCES membership (organization_id, principal_id)
);

-- "My clients": the assigned agent's clients by name.
CREATE INDEX party_assigned ON party (organization_id, assigned_principal_id, display_name);
CREATE INDEX party_creator ON party (organization_id, created_by_principal_id);

ALTER TABLE party ENABLE ROW LEVEL SECURITY;
ALTER TABLE party FORCE ROW LEVEL SECURITY;

CREATE POLICY party_read ON party
	FOR SELECT TO reo_app USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND (SELECT app.current_principal_id()) IN (assigned_principal_id, created_by_principal_id)
	);
CREATE POLICY party_create_own ON party
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND created_by_principal_id = (SELECT app.current_principal_id())
		AND assigned_principal_id = (SELECT app.current_principal_id())
	);

GRANT SELECT ON party TO reo_app;
GRANT INSERT (organization_id, id, display_name, email, phone,
	assigned_principal_id, created_by_principal_id) ON party TO reo_app;
