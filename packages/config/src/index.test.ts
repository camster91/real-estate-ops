import { describe, expect, it } from "vitest";
import { readAuthConfig, readConfig } from "./index.js";

describe("safe runtime configuration", () => {
	it("defaults to loopback development", () =>
		expect(readConfig({})).toEqual({
			port: 4000,
			host: "127.0.0.1",
			mode: "development",
		}));
	it.each(["0", "65536", "4.2", "-1", "4000bad", ""])(
		"rejects invalid port %s",
		(port) => expect(() => readConfig({ PORT: port })).toThrow(),
	);
	it("refuses premature production", () =>
		expect(() => readConfig({ NODE_ENV: "production" })).toThrow());
	it("refuses external binding", () =>
		expect(() => readConfig({ HOST: "0.0.0.0" })).toThrow());
});

describe("login configuration", () => {
	const base = {
		NODE_ENV: "development",
		REO_PUBLIC_URL: "http://127.0.0.1:4000",
		REO_LOGIN_COOKIE_SECRET: "s".repeat(32),
	};
	const google = {
		REO_GOOGLE_CLIENT_ID: "synthetic-google-id",
		REO_GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
	};
	const tenant = "00000000-0000-4000-8000-000000000001";
	const microsoft = {
		REO_MICROSOFT_CLIENT_ID: "synthetic-ms-id",
		REO_MICROSOFT_CLIENT_SECRET: "synthetic-ms-secret",
		REO_MICROSOFT_TENANT_ID: tenant,
	};

	it("login is off when no provider is set", () => {
		expect(readAuthConfig({})).toBeUndefined();
		expect(readAuthConfig(base)).toBeUndefined();
	});

	it("google needs id and secret", () => {
		expect(() =>
			readAuthConfig({ ...base, REO_GOOGLE_CLIENT_ID: "synthetic" }),
		).toThrow(/Incomplete google/);
		expect(() =>
			readAuthConfig({ ...base, REO_GOOGLE_HOSTED_DOMAINS: "example.invalid" }),
		).toThrow(/Incomplete google/);
	});

	it("builds the google provider", () => {
		expect(
			readAuthConfig({
				...base,
				...google,
				REO_GOOGLE_HOSTED_DOMAINS: "example.invalid, Team.Example.invalid",
			}),
		).toEqual({
			publicUrl: "http://127.0.0.1:4000",
			cookieSecret: "s".repeat(32),
			providers: [
				{
					name: "google",
					issuer: "https://accounts.google.com",
					clientId: "synthetic-google-id",
					clientSecret: "synthetic-google-secret",
					allowedIssuers: ["https://accounts.google.com"],
					allowedHostedDomains: ["example.invalid", "team.example.invalid"],
				},
			],
		});
	});

	it("microsoft accepts exactly one configured tenant", () => {
		const config = readAuthConfig({ ...base, ...microsoft });
		expect(config?.providers).toEqual([
			{
				name: "microsoft",
				issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
				clientId: "synthetic-ms-id",
				clientSecret: "synthetic-ms-secret",
				allowedIssuers: [`https://login.microsoftonline.com/${tenant}/v2.0`],
			},
		]);
	});

	it.each([
		"common",
		"organizations",
		"consumers",
		"9188040d-6c67-4c5b-b112-36a304b66dad",
		"not-a-uuid",
		`${"00000000-0000-4000-8000-000000000001"},00000000-0000-4000-8000-000000000002`,
		"",
	])("microsoft refuses tenant %s", (value) =>
		expect(() =>
			readAuthConfig({ ...base, ...microsoft, REO_MICROSOFT_TENANT_ID: value }),
		).toThrow(),
	);

	it("microsoft without a tenant is incomplete", () => {
		const { REO_MICROSOFT_TENANT_ID: _, ...partial } = microsoft;
		expect(() => readAuthConfig({ ...base, ...partial })).toThrow(
			/Incomplete microsoft/,
		);
	});

	it("enables both providers", () => {
		expect(
			readAuthConfig({ ...base, ...google, ...microsoft })?.providers.map(
				(provider) => provider.name,
			),
		).toEqual(["google", "microsoft"]);
	});

	it.each([undefined, "short", "s".repeat(31)])(
		"refuses cookie secret %s",
		(secret) =>
			expect(() =>
				readAuthConfig({
					...base,
					...google,
					REO_LOGIN_COOKIE_SECRET: secret,
				}),
			).toThrow(/REO_LOGIN_COOKIE_SECRET/),
	);

	it.each([
		undefined,
		"https://app.example.invalid",
		"http://10.0.0.5:4000",
		"http://127.0.0.1:4000/path",
		"http://localhost.example.invalid:4000",
		"http://user@127.0.0.1:4000",
	])("refuses public URL %s while production is refused", (url) =>
		expect(() =>
			readAuthConfig({ ...base, ...google, REO_PUBLIC_URL: url }),
		).toThrow(/REO_PUBLIC_URL/),
	);

	it("accepts localhost public URL and drops a trailing slash", () =>
		expect(
			readAuthConfig({
				...base,
				...google,
				REO_PUBLIC_URL: "http://localhost:4000/",
			})?.publicUrl,
		).toBe("http://localhost:4000"));

	it("refuses an invalid hosted domain", () =>
		expect(() =>
			readAuthConfig({ ...base, ...google, REO_GOOGLE_HOSTED_DOMAINS: "a b" }),
		).toThrow(/REO_GOOGLE_HOSTED_DOMAINS/));

	it("test issuer override only works in test mode", () => {
		const env = {
			...base,
			...google,
			REO_TEST_OIDC_ISSUER: "http://127.0.0.1:5555",
		};
		expect(() => readAuthConfig(env)).toThrow(/REO_TEST_OIDC_ISSUER/);
		const config = readAuthConfig({ ...env, NODE_ENV: "test" });
		expect(config?.providers[0]).toMatchObject({
			issuer: "http://127.0.0.1:5555",
			allowedIssuers: ["http://127.0.0.1:5555"],
		});
	});
});
