-- Key dates on a deal (ADR 0022; pilot slice 4).
--
-- Condition deadlines, deposit due, closing and other dates: each a moment
-- in time that can be marked done. They are visible with their deal, and
-- only the deal's assigned agent adds or changes them. A condition or other
-- date names itself ("Financing"); deposit and closing need no label.
--
-- A trigger, for every role that does not disable it (the owner included),
-- lets only label, due_at and done_at change, requires version to go up by
-- exactly one, stamps updated_at, and sets done_at from the server clock:
-- the time something was marked done is never supplied by a client. There
-- is no delete.

CREATE TABLE deal_key_date (
	organization_id uuid NOT NULL,
	id uuid NOT NULL,
	deal_id uuid NOT NULL,
	kind text NOT NULL CHECK (kind IN ('condition', 'deposit', 'closing', 'other')),
	label text CHECK (label IS NULL OR (
		char_length(label) BETWEEN 1 AND 100
		AND label !~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]'
		AND btrim(label) = label
	)),
	due_at timestamptz NOT NULL,
	done_at timestamptz,
	created_by_principal_id uuid NOT NULL,
	classification text NOT NULL DEFAULT 'operational'
		CHECK (classification IN ('operational', 'personal', 'financial', 'restricted_compliance')),
	version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id),
	CHECK (kind IN ('deposit', 'closing') OR label IS NOT NULL),
	FOREIGN KEY (organization_id, deal_id) REFERENCES deal (organization_id, id),
	FOREIGN KEY (organization_id, created_by_principal_id)
		REFERENCES membership (organization_id, principal_id)
);

-- A deal's dates in order.
CREATE INDEX deal_key_date_deal ON deal_key_date (organization_id, deal_id, due_at);

ALTER TABLE deal_key_date ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_key_date FORCE ROW LEVEL SECURITY;

-- Visible with the deal (the subquery applies deal's own RLS).
CREATE POLICY deal_key_date_read ON deal_key_date
	FOR SELECT TO reo_app USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND EXISTS (
			SELECT 1 FROM deal d
			WHERE d.organization_id = deal_key_date.organization_id
				AND d.id = deal_key_date.deal_id
		)
	);
-- Added by the deal's assigned agent, as themselves.
CREATE POLICY deal_key_date_create ON deal_key_date
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND created_by_principal_id = (SELECT app.current_principal_id())
		AND EXISTS (
			SELECT 1 FROM deal d
			WHERE d.organization_id = deal_key_date.organization_id
				AND d.id = deal_key_date.deal_id
				AND d.assigned_principal_id = (SELECT app.current_principal_id())
		)
	);
-- Changed by the deal's assigned agent.
CREATE POLICY deal_key_date_update ON deal_key_date
	FOR UPDATE TO reo_app
	USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND EXISTS (
			SELECT 1 FROM deal d
			WHERE d.organization_id = deal_key_date.organization_id
				AND d.id = deal_key_date.deal_id
				AND d.assigned_principal_id = (SELECT app.current_principal_id())
		)
	)
	WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
	);

CREATE FUNCTION app.deal_key_date_guard() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF NEW.version IS DISTINCT FROM OLD.version + 1
			OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
			OR NEW.id IS DISTINCT FROM OLD.id
			OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
			OR NEW.kind IS DISTINCT FROM OLD.kind
			OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
			OR NEW.classification IS DISTINCT FROM OLD.classification
			OR NEW.created_at IS DISTINCT FROM OLD.created_at
		THEN
			RAISE EXCEPTION 'key date change not allowed' USING ERRCODE = 'check_violation';
		END IF;
		-- Done time comes from the server: kept when it stays done, set now
		-- when it becomes done, cleared when it is reopened.
		NEW.done_at := CASE
			WHEN NEW.done_at IS NULL THEN NULL
			WHEN OLD.done_at IS NOT NULL THEN OLD.done_at
			ELSE now()
		END;
		NEW.updated_at := now();
		RETURN NEW;
	END
	$$;
REVOKE EXECUTE ON FUNCTION app.deal_key_date_guard() FROM PUBLIC;

CREATE TRIGGER deal_key_date_guard
	BEFORE UPDATE ON deal_key_date
	FOR EACH ROW EXECUTE FUNCTION app.deal_key_date_guard();

GRANT SELECT ON deal_key_date TO reo_app;
GRANT INSERT (organization_id, id, deal_id, kind, label, due_at,
	created_by_principal_id) ON deal_key_date TO reo_app;
GRANT UPDATE (label, due_at, done_at, version) ON deal_key_date TO reo_app;
