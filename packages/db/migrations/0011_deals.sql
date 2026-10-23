-- Deals, first slice (ADR 0021; pilot slice 3).
--
-- A deal is one side of a transaction the brokerage represents (buyer,
-- seller, tenant or landlord) for an Ontario property, linked to 1 to 4 of
-- the agent's clients. Like clients, a deal is visible only to its assigned
-- agent and its creator while they are active members, and a member adds
-- deals only for themselves, for their own clients.
--
-- Stages are PLACEHOLDERS until the broker of record approves them. A
-- trigger repeats @reo/domain canMoveDeal for every role that does not
-- disable it, the owner included: an open deal (draft, active, conditional,
-- firm) moves to any other stage except draft; fell_through only reopens as
-- active; closed never moves. Each change adds one to version and stamps
-- stage_changed_at. Address and clients are fixed in this slice.

CREATE TABLE deal (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL,
	side text NOT NULL CHECK (side IN ('buyer', 'seller', 'tenant', 'landlord')),
	stage text NOT NULL DEFAULT 'draft'
		CHECK (stage IN ('draft', 'active', 'conditional', 'firm', 'closed', 'fell_through')),
	street text NOT NULL CHECK (
		char_length(street) BETWEEN 1 AND 200
		AND street !~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]'
		AND btrim(street) = street
	),
	unit text CHECK (unit IS NULL OR (
		char_length(unit) BETWEEN 1 AND 20
		AND unit !~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]'
		AND btrim(unit) = unit
	)),
	city text NOT NULL CHECK (
		char_length(city) BETWEEN 1 AND 100
		AND city !~ '[\x01-\x1f\x7f-\x9f\u2028\u2029]'
		AND btrim(city) = city
	),
	province text NOT NULL DEFAULT 'ON' CHECK (province = 'ON'),
	-- Ontario postal codes, as @reo/domain stores them: "K1A 0B1".
	postal_code text NOT NULL
		CHECK (postal_code ~ '^[KLMNP][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$'),
	assigned_principal_id uuid NOT NULL,
	created_by_principal_id uuid NOT NULL,
	classification text NOT NULL DEFAULT 'personal'
		CHECK (classification IN ('operational', 'personal', 'financial', 'restricted_compliance')),
	version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
	created_at timestamptz NOT NULL DEFAULT now(),
	stage_changed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id),
	FOREIGN KEY (organization_id, assigned_principal_id)
		REFERENCES membership (organization_id, principal_id),
	FOREIGN KEY (organization_id, created_by_principal_id)
		REFERENCES membership (organization_id, principal_id)
);

-- "My deals": newest first.
CREATE INDEX deal_assigned ON deal (organization_id, assigned_principal_id, created_at DESC);
CREATE INDEX deal_creator ON deal (organization_id, created_by_principal_id);

CREATE TABLE deal_party (
	organization_id uuid NOT NULL,
	deal_id uuid NOT NULL,
	party_id uuid NOT NULL,
	PRIMARY KEY (organization_id, deal_id, party_id),
	FOREIGN KEY (organization_id, deal_id) REFERENCES deal (organization_id, id),
	FOREIGN KEY (organization_id, party_id) REFERENCES party (organization_id, id)
);
-- A client's deals.
CREATE INDEX deal_party_party ON deal_party (organization_id, party_id);

ALTER TABLE deal ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_party FORCE ROW LEVEL SECURITY;

CREATE POLICY deal_read ON deal
	FOR SELECT TO reo_app USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND (SELECT app.current_principal_id()) IN (assigned_principal_id, created_by_principal_id)
	);
CREATE POLICY deal_create_own ON deal
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND created_by_principal_id = (SELECT app.current_principal_id())
		AND assigned_principal_id = (SELECT app.current_principal_id())
	);
CREATE POLICY deal_update_assignee ON deal
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

-- Links are visible with their deal (the subquery applies deal's own RLS).
CREATE POLICY deal_party_read ON deal_party
	FOR SELECT TO reo_app USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND EXISTS (
			SELECT 1 FROM deal d
			WHERE d.organization_id = deal_party.organization_id
				AND d.id = deal_party.deal_id
		)
	);
-- Only the deal's assigned agent links clients, and only their own clients.
CREATE POLICY deal_party_create ON deal_party
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND EXISTS (
			SELECT 1 FROM deal d
			WHERE d.organization_id = deal_party.organization_id
				AND d.id = deal_party.deal_id
				AND d.assigned_principal_id = (SELECT app.current_principal_id())
		)
		AND EXISTS (
			SELECT 1 FROM party p
			WHERE p.organization_id = deal_party.organization_id
				AND p.id = deal_party.party_id
				AND p.assigned_principal_id = (SELECT app.current_principal_id())
		)
	);

CREATE FUNCTION app.deal_stage_guard() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF NEW.version IS DISTINCT FROM OLD.version + 1
			OR NEW.stage = OLD.stage
			OR NEW.stage = 'draft'
			OR OLD.stage = 'closed'
			OR (OLD.stage = 'fell_through' AND NEW.stage <> 'active')
			OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
			OR NEW.id IS DISTINCT FROM OLD.id
			OR NEW.side IS DISTINCT FROM OLD.side
			OR NEW.street IS DISTINCT FROM OLD.street
			OR NEW.unit IS DISTINCT FROM OLD.unit
			OR NEW.city IS DISTINCT FROM OLD.city
			OR NEW.province IS DISTINCT FROM OLD.province
			OR NEW.postal_code IS DISTINCT FROM OLD.postal_code
			OR NEW.assigned_principal_id IS DISTINCT FROM OLD.assigned_principal_id
			OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
			OR NEW.classification IS DISTINCT FROM OLD.classification
			OR NEW.created_at IS DISTINCT FROM OLD.created_at
		THEN
			RAISE EXCEPTION 'deal stage change not allowed' USING ERRCODE = 'check_violation';
		END IF;
		NEW.stage_changed_at := now();
		RETURN NEW;
	END
	$$;
REVOKE EXECUTE ON FUNCTION app.deal_stage_guard() FROM PUBLIC;

CREATE TRIGGER deal_stage_guard
	BEFORE UPDATE ON deal
	FOR EACH ROW EXECUTE FUNCTION app.deal_stage_guard();

GRANT SELECT ON deal, deal_party TO reo_app;
GRANT INSERT (organization_id, id, side, street, unit, city, postal_code,
	assigned_principal_id, created_by_principal_id) ON deal TO reo_app;
GRANT UPDATE (stage, version) ON deal TO reo_app;
GRANT INSERT (organization_id, deal_id, party_id) ON deal_party TO reo_app;
