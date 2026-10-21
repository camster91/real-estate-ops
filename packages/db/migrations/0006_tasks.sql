-- Tasks, first slice (ADR 0015; states from docs/product/CORE_MODEL.md).
--
-- A task is visible only to its assignee and its creator, and only while they
-- have an active membership in the task's organisation. In this slice a member
-- may create tasks only for themselves; status changes, edits and assigning to
-- others come later. Status, classification, version and created_at always take
-- their defaults on insert (column-level grant). Title rules match
-- @reo/domain parseNewTask.

CREATE TABLE task (
	organization_id uuid NOT NULL REFERENCES organization,
	id uuid NOT NULL,
	title text NOT NULL CHECK (
		char_length(title) BETWEEN 1 AND 200
		AND title !~ '[[:cntrl:]]'
		AND btrim(title) = title
	),
	status text NOT NULL DEFAULT 'ready'
		CHECK (status IN ('ready', 'in_progress', 'waiting', 'blocked', 'completed', 'cancelled')),
	assignee_principal_id uuid NOT NULL,
	created_by_principal_id uuid NOT NULL,
	due_at timestamptz CHECK (due_at IS NULL OR isfinite(due_at)),
	classification text NOT NULL DEFAULT 'operational'
		CHECK (classification IN ('operational', 'personal', 'financial', 'restricted_compliance')),
	version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, id),
	-- Only members of this organisation can be assignee or creator.
	FOREIGN KEY (organization_id, assignee_principal_id)
		REFERENCES membership (organization_id, principal_id),
	FOREIGN KEY (organization_id, created_by_principal_id)
		REFERENCES membership (organization_id, principal_id)
);

-- "My tasks": the assignee's tasks by status and due date.
CREATE INDEX task_assignee ON task (organization_id, assignee_principal_id, status, due_at);
CREATE INDEX task_creator ON task (organization_id, created_by_principal_id);

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;

CREATE POLICY task_read ON task
	FOR SELECT TO reo_app USING (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND (SELECT app.current_principal_id()) IN (assignee_principal_id, created_by_principal_id)
	);
CREATE POLICY task_create_own ON task
	FOR INSERT TO reo_app WITH CHECK (
		organization_id = (SELECT app.current_organization_id())
		AND (SELECT app.has_active_membership())
		AND created_by_principal_id = (SELECT app.current_principal_id())
		AND assignee_principal_id = (SELECT app.current_principal_id())
	);

GRANT SELECT ON task TO reo_app;
GRANT INSERT (organization_id, id, title, assignee_principal_id,
	created_by_principal_id, due_at) ON task TO reo_app;
