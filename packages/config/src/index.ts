export type RuntimeConfig = Readonly<{
	port: number;
	host: "127.0.0.1";
	mode: "development" | "test";
}>;
type Env = Record<string, string | undefined>;

function readMode(env: Env): RuntimeConfig["mode"] {
	const mode = env.NODE_ENV ?? "development";
	if (mode !== "development" && mode !== "test")
		throw new Error(
			"Production is disabled until security and deployment gates are verified",
		);
	return mode;
}

export function readConfig(env: Env): RuntimeConfig {
	const mode = readMode(env);
	const raw = env.PORT ?? "4000";
	if (!/^\d+$/.test(raw)) throw new Error("PORT must be an integer");
	const port = Number(raw);
	if (port < 1 || port > 65535)
		throw new Error("PORT is outside the valid range");
	if (env.HOST && env.HOST !== "127.0.0.1")
		throw new Error("Only loopback binding is enabled");
	return Object.freeze({ port, host: "127.0.0.1", mode });
}

export type ProviderEnv = Readonly<{
	name: "google" | "microsoft";
	issuer: string;
	clientId: string;
	clientSecret: string;
	allowedIssuers: readonly string[];
	allowedHostedDomains?: readonly string[];
}>;

export type AuthConfig = Readonly<{
	publicUrl: string;
	cookieSecret: string;
	providers: readonly ProviderEnv[];
}>;

const GOOGLE_ISSUER = "https://accounts.google.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Microsoft's tenant for personal accounts; staff sign in with work accounts.
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const DOMAIN =
	/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Returns the values only when every one is set; throws when some are. */
function group(env: Env, label: string, names: readonly string[]) {
	const values = names.map((name) => env[name] || undefined);
	if (values.every((value) => value === undefined)) return undefined;
	if (values.some((value) => value === undefined))
		throw new Error(`Incomplete ${label} login configuration`);
	return values as string[];
}

function readPublicUrl(raw: string | undefined): string {
	const invalid = new Error(
		"REO_PUBLIC_URL must be http://127.0.0.1:<port> or http://localhost:<port> while production is disabled",
	);
	if (!raw) throw invalid;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw invalid;
	}
	if (
		url.protocol !== "http:" ||
		(url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw invalid;
	return url.origin;
}

/**
 * Login settings. Returns undefined when no provider is configured (login is
 * off). A provider is enabled only when all of its variables are set.
 */
export function readAuthConfig(env: Env): AuthConfig | undefined {
	const mode = readMode(env);
	const testIssuer = env.REO_TEST_OIDC_ISSUER || undefined;
	if (testIssuer && mode !== "test")
		throw new Error("REO_TEST_OIDC_ISSUER is only allowed when NODE_ENV=test");
	const providers: ProviderEnv[] = [];

	const googleDomains = env.REO_GOOGLE_HOSTED_DOMAINS || undefined;
	const google = group(env, "google", [
		"REO_GOOGLE_CLIENT_ID",
		"REO_GOOGLE_CLIENT_SECRET",
	]);
	if (googleDomains && !google)
		throw new Error("Incomplete google login configuration");
	if (google) {
		const [clientId, clientSecret] = google as [string, string];
		const issuer = testIssuer ?? GOOGLE_ISSUER;
		const domains = googleDomains
			?.split(",")
			.map((domain) => domain.trim().toLowerCase());
		if (domains?.some((domain) => !DOMAIN.test(domain)))
			throw new Error("REO_GOOGLE_HOSTED_DOMAINS has an invalid domain");
		providers.push(
			Object.freeze({
				name: "google",
				issuer,
				clientId,
				clientSecret,
				allowedIssuers: Object.freeze([issuer]),
				...(domains ? { allowedHostedDomains: Object.freeze(domains) } : {}),
			}),
		);
	}

	const microsoft = group(env, "microsoft", [
		"REO_MICROSOFT_CLIENT_ID",
		"REO_MICROSOFT_CLIENT_SECRET",
		"REO_MICROSOFT_TENANT_ID",
	]);
	if (microsoft) {
		const [clientId, clientSecret, rawTenant] = microsoft as [
			string,
			string,
			string,
		];
		const tenant = rawTenant.trim().toLowerCase();
		if (!UUID.test(tenant) || tenant === MICROSOFT_CONSUMER_TENANT)
			throw new Error(
				"REO_MICROSOFT_TENANT_ID must be one Entra tenant ID (not common, organizations or consumers)",
			);
		const issuer =
			testIssuer ?? `https://login.microsoftonline.com/${tenant}/v2.0`;
		providers.push(
			Object.freeze({
				name: "microsoft",
				issuer,
				clientId,
				clientSecret,
				allowedIssuers: Object.freeze([issuer]),
			}),
		);
	}

	if (providers.length === 0) return undefined;
	const publicUrl = readPublicUrl(env.REO_PUBLIC_URL);
	const cookieSecret = env.REO_LOGIN_COOKIE_SECRET ?? "";
	if (cookieSecret.length < 32)
		throw new Error("REO_LOGIN_COOKIE_SECRET must be at least 32 characters");
	return Object.freeze({
		publicUrl,
		cookieSecret,
		providers: Object.freeze(providers),
	});
}
