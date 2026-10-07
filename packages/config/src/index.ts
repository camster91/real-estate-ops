export type RuntimeConfig = Readonly<{
	port: number;
	host: "127.0.0.1";
	mode: "development" | "test";
}>;
export function readConfig(
	env: Record<string, string | undefined>,
): RuntimeConfig {
	const mode = env.NODE_ENV ?? "development";
	if (mode !== "development" && mode !== "test")
		throw new Error(
			"Production is disabled until security and deployment gates are verified",
		);
	const raw = env.PORT ?? "4000";
	if (!/^\d+$/.test(raw)) throw new Error("PORT must be an integer");
	const port = Number(raw);
	if (port < 1 || port > 65535)
		throw new Error("PORT is outside the valid range");
	if (env.HOST && env.HOST !== "127.0.0.1")
		throw new Error("Only loopback binding is enabled");
	return Object.freeze({ port, host: "127.0.0.1", mode });
}
