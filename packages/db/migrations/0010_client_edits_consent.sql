-- Client edits and consent records (ADR 0020; pilot slice 2).
--
-- Edits: only the assigned agent, while an active member, may change a
-- client's name, email and phone, and each change must add exactly one to
-- version (optimistic concurrency). A trigger enforces this for every role,
-- including the table owner, and stamps updated_at.
--
-- Consent: one append-only row per grant or withdrawal, for a purpose from
-- @reo/domain CONSENT_PURPOSES, with how it was given and who recorded it.
-- The current consent for a purpose is its latest row. Rows are never
-- updated or deleted, even by the owner, so the history is evidence.

ALTER TABLE party ADD COLUMN updated_at timestamptz;
UPDATE party SET updated_at = created_at;
ALTER TABLE party
	ALTER COLUMN updated_at SET DEFAULT now(),
	ALTER COLUMN updated_at SET NOT NULL;

CREATE FUNCTION app.party_update_guard() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF NEW.version IS DISTINCT FROM OLD.version + 1
			OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
			OR NEW.id IS DISTINCT FROM OLD.id
			OR NEW.kind IS DISTINCT FROM OLD.kind
			OR NEW.assigned_principal_id IS DISTINCT FROM OLD.assigned_principal_id
			OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
			OR NEW.classification IS DISTINCT FROM OLD.classification
			OR NEW.created_at IS DISTINCT FROM OLD.created_at
		THEN
			RAISE EXCEPTION 'client edit not allowed' USING ERRCODE = 'check_violation';
		END IF;
		NEW.updated_at := now();
		RETURN NEW;
	END
	$$;
REVOKE EXECUTE ON FUNCTION app.party_update_guard() FROM PUBLIC;

CREATE TRIGGER party_update_guard
	BEFORE UPDATE ON party
	FOR EACH ROW EXECUTE FUNCTION app.party_update_guard();

CREATE POLICY party_update_assignee ON party
	FOR UPDATE TO reo_app
	USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND assigned_principal_id = (SELECT app.current_principal_id())
	)
	WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND assigned_principal_id = (SELECT app.current_principal_id())
	);

GRANT UPDATE (display_name, email, phone, version) ON party TO reo_app;

CREATE TABLE consent_record (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL,
	party_id uuid NOT NULL,
	purpose text NOT NULL CHECK (purpose IN ('transaction_service', 'market_updates')),
	status text NOT NULL CHECK (status IN ('granted', 'withdrawn')),
	method text NOT NULL CHECK (method IN ('written', 'electronic', 'verbal')),
	recorded_by_principal_id uuid NOT NULL,
	recorded_at timestamptz NOT NULL DEFAULT now(),
	classification text NOT NULL DEFAULT 'personal'
		CHECK (classification IN ('operational', 'personal', 'financial', 'restricted_compliance')),
	PRIMARY KEY (organization_id, id),
	FOREIGN KEY (organization_id, party_id) REFERENCES party (organization_id, id),
	FOREIGN KEY (organization_id, recorded_by_principal_id)
		REFERENCES membership (organization_id, principal_id)
);

-- Latest record per purpose for a client.
CREATE INDEX consent_record_party
	ON consent_record (organization_id, party_id, purpose, recorded_at DESC);

ALTER TABLE consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_record FORCE ROW LEVEL SECURITY;

-- Visible when the client is: the party subquery applies party's own RLS.
CREATE POLICY consent_record_read ON consent_record
	FOR SELECT TO reo_app USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND EXISTS (
			SELECT 1 FROM party p
			WHERE p.organization_id = consent_record.organization_id
				AND p.id = consent_record.party_id
		)
	);
-- Recorded by the client's assigned agent, as themselves.
CREATE POLICY consent_record_create ON consent_record
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND recorded_by_principal_id = (SELECT app.current_principal_id())
		AND EXISTS (
			SELECT 1 FROM party p
			WHERE p.organization_id = consent_record.organization_id
				AND p.id = consent_record.party_id
				AND p.assigned_principal_id = (SELECT app.current_principal_id())
		)
	);

CREATE FUNCTION app.consent_record_immutable() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog, public
	AS $$
	BEGIN
		RAISE EXCEPTION 'consent_record is append-only' USING ERRCODE = 'insufficient_privilege';
	END
	$$;
REVOKE EXECUTE ON FUNCTION app.consent_record_immutable() FROM PUBLIC;
CREATE TRIGGER consent_record_no_update_delete
	BEFORE UPDATE OR DELETE ON consent_record
	FOR EACH ROW EXECUTE FUNCTION app.consent_record_immutable();
CREATE TRIGGER consent_record_no_truncate
	BEFORE TRUNCATE ON consent_record
	FOR EACH STATEMENT EXECUTE FUNCTION app.consent_record_immutable();

GRANT SELECT ON consent_record TO reo_app;
GRANT INSERT (organization_id, id, party_id, purpose, status, method,
	recorded_by_principal_id) ON consent_record TO reo_app;
