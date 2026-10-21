import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FakeIssuer, startFakeIssuer } from "./fake-issuer.js";
import {
	createOidcLogin,
	LoginRejectedError,
	type LoginStart,
	type ProviderConfig,
} from "./oidc.js";

let fake: FakeIssuer;

const REDIRECT = "http://127.0.0.1:4000/auth/google/callback";

const provider = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
	name: "google",
	issuer: fake.issuer,
	clientId: fake.clientId,
	clientSecret: fake.clientSecret,
	redirectUri: REDIRECT,
	allowedIssuers: [fake.issuer],
	...overrides,
});

/** Follows the fake authorization endpoint and returns the callback URL. */
async function authorize(start: LoginStart): Promise<URL> {
	const response = await fetch(start.url, { redirect: "manual" });
	expect(response.status).toBe(302);
	return new URL(response.headers.get("location") as string);
}

async function login(
	config: ProviderConfig,
	change: {
		state?: string;
		codeVerifier?: string;
	} = {},
) {
	const client = await createOidcLogin(config, { allowInsecure: true });
	const start = await client.start();
	const callback = await authorize(start);
	return client.finish(callback, {
		state: change.state ?? start.state,
		nonce: start.nonce,
		codeVerifier: change.codeVerifier ?? start.codeVerifier,
	});
}

beforeAll(async () => {
	fake = await startFakeIssuer();
});

afterAll(async () => {
	await fake.close();
});

describe("OIDC login", () => {
	it("completes a valid login", async () => {
		fake.mint({ sub: "synthetic-a" });
		expect(await login(provider())).toEqual({
			issuer: fake.issuer,
			subject: "synthetic-a",
		});
	});

	it("start() uses PKCE S256 and fresh state and nonce", async () => {
		const client = await createOidcLogin(provider(), { allowInsecure: true });
		const a = await client.start();
		const b = await client.start();
		const url = new URL(a.url);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("scope")).toBe("openid");
		expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
		expect(a.state).not.toBe(b.state);
		expect(a.nonce).not.toBe(b.nonce);
		expect(a.codeVerifier).not.toBe(b.codeVerifier);
	});

	it.each<[string, () => Promise<unknown>]>([
		[
			"wrong state",
			() => {
				fake.mint({});
				return login(provider(), { state: "not-the-state" });
			},
		],
		[
			"wrong nonce",
			() => {
				fake.mint({ nonce: "another-nonce" });
				return login(provider());
			},
		],
		[
			"another audience",
			() => {
				fake.mint({ aud: "another-client" });
				return login(provider());
			},
		],
		[
			"expired token",
			() => {
				const now = Math.floor(Date.now() / 1000);
				fake.mint({ iat: now - 7200, exp: now - 3600 });
				return login(provider());
			},
		],
		[
			"wrong signing key",
			() => {
				fake.mint({}, { key: "other" });
				return login(provider());
			},
		],
		[
			"issuer not allowed (another Entra tenant)",
			() => {
				fake.mint({});
				return login(
					provider({
						name: "microsoft",
						allowedIssuers: [
							"https://login.microsoftonline.com/00000000-0000-4000-8000-000000000001/v2.0",
						],
					}),
				);
			},
		],
		[
			"missing hosted domain",
			() => {
				fake.mint({});
				return login(provider({ allowedHostedDomains: ["example.invalid"] }));
			},
		],
		[
			"hosted domain not allowed",
			() => {
				fake.mint({ hd: "other.invalid" });
				return login(provider({ allowedHostedDomains: ["example.invalid"] }));
			},
		],
		[
			"PKCE verifier mismatch",
			() => {
				fake.mint({});
				return login(provider(), {
					codeVerifier: "a".repeat(43),
				});
			},
		],
	])("rejects %s", async (_label, attempt) => {
		await expect(attempt()).rejects.toBeInstanceOf(LoginRejectedError);
	});

	it("accepts an allowed hosted domain", async () => {
		fake.mint({ hd: "example.invalid" });
		const result = await login(
			provider({ allowedHostedDomains: ["example.invalid"] }),
		);
		expect(result.subject).toBe("synthetic-a");
	});

	it("never exposes email or name", async () => {
		fake.mint({ email: "someone@example.invalid", name: "Synthetic Person" });
		const result = await login(provider());
		expect(Object.keys(result).sort()).toEqual(["issuer", "subject"]);
	});
});

describe("rejection details", () => {
	const rejection = async (attempt: Promise<unknown>) => {
		try {
			await attempt;
		} catch (error) {
			if (error instanceof LoginRejectedError) return error;
			throw error;
		}
		throw new Error("expected a rejection");
	};

	it("a failed check carries the library's safe error code", async () => {
		fake.mint({ nonce: "another-nonce" });
		const error = await rejection(login(provider()));
		expect(error.reason).toBe("invalid_response");
		expect(error.detail).toMatch(/^[A-Z][A-Z0-9_]{2,63}$/);
	});

	it("a provider error such as a cancelled sign-in is its own reason", async () => {
		const client = await createOidcLogin(provider(), { allowInsecure: true });
		const start = await client.start();
		const callback = new URL(REDIRECT);
		callback.searchParams.set("error", "access_denied");
		callback.searchParams.set("error_description", "someone@example.invalid");
		callback.searchParams.set("state", start.state);
		const error = await rejection(client.finish(callback, start));
		expect(error.reason).toBe("provider_error");
		expect(error.detail).toBe("access_denied");
	});

	it("an unreachable provider is provider_unavailable", async () => {
		const gone = await startFakeIssuer();
		const client = await createOidcLogin(
			provider({
				issuer: gone.issuer,
				clientId: gone.clientId,
				clientSecret: gone.clientSecret,
				allowedIssuers: [gone.issuer],
			}),
			{ allowInsecure: true },
		);
		const start = await client.start();
		const callback = await authorize(start);
		await gone.close();
		const error = await rejection(client.finish(callback, start));
		expect(error.reason).toBe("provider_unavailable");
	});

	it("details never echo provider text", async () => {
		const client = await createOidcLogin(provider(), { allowInsecure: true });
		const start = await client.start();
		const callback = new URL(REDIRECT);
		callback.searchParams.set("error", "Bad Thing <script>");
		callback.searchParams.set("state", start.state);
		const error = await rejection(client.finish(callback, start));
		expect(error.detail).toBe("other");
	});
});
