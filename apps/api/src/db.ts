import pg from "pg";

const CODE = /^[0-9A-Z]{5}$|^E[A-Z]+$/;

/**
 * The runtime pool. An idle client that errors (database restart, network
 * drop) emits "error" on the pool; without a listener that crashes the
 * process. Only the error code is reported: messages can carry connection
 * details.
 */
export function createPool(
	connectionString: string,
	onError: (code: string | undefined) => void,
): pg.Pool {
	const pool = new pg.Pool({ connectionString });
	pool.on("error", (error) => {
		const code = (error as { code?: unknown }).code;
		onError(typeof code === "string" && CODE.test(code) ? code : undefined);
	});
	return pool;
}
