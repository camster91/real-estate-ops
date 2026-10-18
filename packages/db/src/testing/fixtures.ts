import type pg from "pg";

export interface SeedIds {
	orgA: string;
	orgB: string;
	pa: string;
	pb: string;
	approver: string;
	pc: string;
	branchA: string;
	branchB: string;
}

const insert = async (admin: pg.Pool, sql: string, params: unknown[] = []) =>
	(await admin.query(sql, params)).rows[0].id as string;

/**
 * Two synthetic tenants: pa is an active member of A, pb of B, both approved by
 * `approver`; pc has no membership. One branch per tenant. Inserted as admin.
 */
export async function seedTwoTenants(admin: pg.Pool): Promise<SeedIds> {
	const orgA = await insert(
		admin,
		"INSERT INTO organization (name) VALUES ('Synthetic Org A') RETURNING id",
	);
	const orgB = await insert(
		admin,
		"INSERT INTO organization (name) VALUES ('Synthetic Org B') RETURNING id",
	);
	const principal = (subject: string) =>
		insert(
			admin,
			"INSERT INTO principal (oidc_issuer, oidc_subject) VALUES ('https://issuer.invalid', $1) RETURNING id",
			[subject],
		);
	const pa = await principal("synthetic-a");
	const pb = await principal("synthetic-b");
	const approver = await principal("synthetic-approver");
	const pc = await principal("synthetic-c");
	for (const [org, member] of [
		[orgA, pa],
		[orgB, pb],
	])
		await admin.query(
			"INSERT INTO membership (organization_id, principal_id, status, approved_by_principal_id, approved_at, effective_from) VALUES ($1, $2, 'active', $3, now(), now() - interval '7 days')",
			[org, member, approver],
		);
	const branch = (org: string, name: string) =>
		insert(
			admin,
			"INSERT INTO branch (organization_id, name) VALUES ($1, $2) RETURNING id",
			[org, name],
		);
	return {
		orgA,
		orgB,
		pa,
		pb,
		approver,
		pc,
		branchA: await branch(orgA, "Synthetic Branch A"),
		branchB: await branch(orgB, "Synthetic Branch B"),
	};
}

export interface GrantRow {
	org: string;
	principal: string;
	action: string;
	resourceType: string;
	resourceId: string;
	classification?: string;
	purpose?: string;
	expiresIn?: string;
	grantor: string;
}

/** Inserts one access grant as admin and returns its id. */
export async function grant(admin: pg.Pool, row: GrantRow): Promise<string> {
	return insert(
		admin,
		`INSERT INTO access_grant (organization_id, principal_id, action, resource_type, resource_id, classification, purpose, valid_from, expires_at, granted_by_principal_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, now() - interval '1 hour', now() + $8::interval, $9) RETURNING id`,
		[
			row.org,
			row.principal,
			row.action,
			row.resourceType,
			row.resourceId,
			row.classification ?? "operational",
			row.purpose ?? "client_service",
			row.expiresIn ?? "1 day",
			row.grantor,
		],
	);
}
