-- Task status changes (ADR 0017). Only the assignee, while an active member,
-- may change a task's status, and only status and version. A trigger enforces
-- the transition rules of @reo/domain canTransition for every role, including
-- the table owner: open statuses move to any other status; completed and
-- cancelled only back to ready. Each change bumps version by exactly one and
-- stamps status_changed_at.

ALTER TABLE task ADD COLUMN status_changed_at timestamptz;
UPDATE task SET status_changed_at = created_at;
ALTER TABLE task
	ALTER COLUMN status_changed_at SET DEFAULT now(),
	ALTER COLUMN status_changed_at SET NOT NULL;

-- The "Show done tasks" list: newest change first.
CREATE INDEX task_assignee_changed
	ON task (organization_id, assignee_principal_id, status, status_changed_at DESC);

CREATE FUNCTION app.task_status_guard() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog, public
	AS $$
	BEGIN
		IF NEW.version IS DISTINCT FROM OLD.version + 1
			OR NEW.status = OLD.status
			OR NOT (
				OLD.status IN ('ready', 'in_progress', 'waiting', 'blocked')
				OR NEW.status = 'ready'
			)
			OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
			OR NEW.id IS DISTINCT FROM OLD.id
			OR NEW.title IS DISTINCT FROM OLD.title
			OR NEW.assignee_principal_id IS DISTINCT FROM OLD.assignee_principal_id
			OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
			OR NEW.due_at IS DISTINCT FROM OLD.due_at
			OR NEW.classification IS DISTINCT FROM OLD.classification
			OR NEW.created_at IS DISTINCT FROM OLD.created_at
		THEN
			RAISE EXCEPTION 'task status change not allowed' USING ERRCODE = 'check_violation';
		END IF;
		NEW.status_changed_at := now();
		RETURN NEW;
	END
	$$;
REVOKE EXECUTE ON FUNCTION app.task_status_guard() FROM PUBLIC;

CREATE TRIGGER task_status_guard
	BEFORE UPDATE ON task
	FOR EACH ROW EXECUTE FUNCTION app.task_status_guard();

CREATE POLICY task_update_assignee ON task
	FOR UPDATE TO reo_app
	USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND assignee_principal_id = (SELECT app.current_principal_id())
	)
	WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND assignee_principal_id = (SELECT app.current_principal_id())
	);

GRANT UPDATE (status, version) ON task TO reo_app;
