-- Audit events and the transactional outbox (ADR 0014, ADR 0004, ADR 0005).
--
-- A state change, its minimised audit event and its outbox event are written in
-- one transaction (app code: recordChange in packages/db/src/audit.ts). The
-- runtime role may only INSERT, and only for its own tenant and principal while
-- it has an active membership. audit_event is append-only for every role: a
-- trigger refuses UPDATE, DELETE and TRUNCATE, including for the owner, so a
-- change to history needs a reviewed migration. Reading audit events and
-- publishing outbox events are later work (BOR/admin view, #84 publisher).

CREATE TABLE audit_event (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	occurred_at timestamptz NOT NULL DEFAULT now(),
	actor_principal_id uuid NOT NULL REFERENCES principal,
	action text NOT NULL CHECK (action ~ '^[a-z][a-z_]{0,40}\.[a-z][a-z_]{0,40}$'),
	resource_type text NOT NULL CHECK (resource_type ~ '^[a-z][a-z_]{0,62}$'),
	resource_id uuid NOT NULL,
	purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{0,63}$'),
	correlation_id uuid NOT NULL,
	details jsonb NOT NULL DEFAULT '{}'
		CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4096),
	PRIMARY KEY (organization_id, id)
);

CREATE TABLE outbox_event (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	created_at timestamptz NOT NULL DEFAULT now(),
	event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z_]{0,40}\.[a-z][a-z_]{0,40}$'),
	schema_version integer NOT NULL CHECK (schema_version >= 1),
	aggregate_type text NOT NULL CHECK (aggregate_type ~ '^[a-z][a-z_]{0,62}$'),
	aggregate_id uuid NOT NULL,
	aggregate_version integer NOT NULL CHECK (aggregate_version >= 1),
	actor_principal_id uuid NOT NULL REFERENCES principal,
	correlation_id uuid NOT NULL,
	causation_id uuid,
	payload jsonb NOT NULL DEFAULT '{}'
		CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 4096),
	published_at timestamptz,
	PRIMARY KEY (organization_id, id),
	UNIQUE (organization_id, aggregate_type, aggregate_id, aggregate_version, event_type)
);

-- The future publisher scans unpublished events in creation order.
CREATE INDEX outbox_event_unpublished ON outbox_event (created_at)
	WHERE published_at IS NULL;

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_event FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_event_insert ON audit_event
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND actor_principal_id = (SELECT app.current_principal_id())
		AND (SELECT app.has_active_membership())
	);
CREATE POLICY outbox_event_insert ON outbox_event
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND actor_principal_id = (SELECT app.current_principal_id())
		AND (SELECT app.has_active_membership())
	);

CREATE FUNCTION app.audit_event_immutable() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog, public
	AS $$
	BEGIN
		RAISE EXCEPTION 'audit_event is append-only' USING ERRCODE = 'insufficient_privilege';
	END
	$$;

CREATE TRIGGER audit_event_no_update_delete
	BEFORE UPDATE OR DELETE ON audit_event
	FOR EACH ROW EXECUTE FUNCTION app.audit_event_immutable();
CREATE TRIGGER audit_event_no_truncate
	BEFORE TRUNCATE ON audit_event
	FOR EACH STATEMENT EXECUTE FUNCTION app.audit_event_immutable();

REVOKE EXECUTE ON FUNCTION app.audit_event_immutable() FROM PUBLIC;
GRANT INSERT ON audit_event, outbox_event TO reo_app;
