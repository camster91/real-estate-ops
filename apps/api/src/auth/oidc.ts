import * as client from "openid-client";

export type ProviderName = "google" | "microsoft";

export interface ProviderConfig {
	name: ProviderName;
	/** Issuer used for discovery. */
	issuer: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	/** ID tokens must carry one of these `iss` values. */
	allowedIssuers: readonly string[];
	/** When set, the ID token's `hd` claim must be one of these (Google Workspace). */
	allowedHostedDomains?: readonly string[];
}

export interface LoginStart {
	url: string;
	state: string;
	nonce: string;
	codeVerifier: string;
}

export interface LoginExpectation {
	state: string;
	nonce: string;
	codeVerifier: string;
}

/** The only identity a login yields: never email, name or other claims. */
export interface VerifiedIdentity {
	issuer: string;
	subject: string;
}

export type LoginRejection =
	| "invalid_response"
	| "issuer_not_allowed"
	| "hosted_domain_not_allowed"
	| "missing_subject";

/** A login that failed verification. `reason` is safe to log; the cause is not. */
export class LoginRejectedError extends Error {
	constructor(
		readonly reason: LoginRejection,
		options?: { cause?: unknown },
	) {
		super(`Login rejected: ${reason}`, options);
		this.name = "LoginRejectedError";
	}
}

export interface OidcLogin {
	start(): Promise<LoginStart>;
	finish(
		callbackUrl: URL,
		expected: LoginExpectation,
	): Promise<VerifiedIdentity>;
}

/**
 * Discovers the provider and returns an authorization-code + PKCE login.
 * `allowInsecure` permits plain-HTTP issuers and is for the test issuer only.
 */
export async function createOidcLogin(
	provider: ProviderConfig,
	options: { allowInsecure?: boolean } = {},
): Promise<OidcLogin> {
	const config = await client.discovery(
		new URL(provider.issuer),
		provider.clientId,
		undefined,
		client.ClientSecretPost(provider.clientSecret),
		{
			// The library skips ID token signature checks for tokens fetched over
			// TLS from the token endpoint (allowed by the spec). We verify the
			// signature against the provider's JWKS anyway.
			execute: options.allowInsecure
				? [client.allowInsecureRequests, client.enableNonRepudiationChecks]
				: [client.enableNonRepudiationChecks],
		},
	);

	return {
		async start() {
			const state = client.randomState();
			const nonce = client.randomNonce();
			const codeVerifier = client.randomPKCECodeVerifier();
			const url = client.buildAuthorizationUrl(config, {
				redirect_uri: provider.redirectUri,
				scope: "openid",
				response_type: "code",
				state,
				nonce,
				code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
				code_challenge_method: "S256",
			});
			return { url: url.toString(), state, nonce, codeVerifier };
		},

		async finish(callbackUrl, expected) {
			let claims: client.IDToken | undefined;
			try {
				const tokens = await client.authorizationCodeGrant(
					config,
					callbackUrl,
					{
						expectedState: expected.state,
						expectedNonce: expected.nonce,
						pkceCodeVerifier: expected.codeVerifier,
						idTokenExpected: true,
					},
				);
				claims = tokens.claims();
			} catch (cause) {
				throw new LoginRejectedError("invalid_response", { cause });
			}
			if (!claims) throw new LoginRejectedError("invalid_response");
			if (!provider.allowedIssuers.includes(claims.iss))
				throw new LoginRejectedError("issuer_not_allowed");
			if (provider.allowedHostedDomains) {
				const hd = claims.hd;
				if (
					typeof hd !== "string" ||
					!provider.allowedHostedDomains.includes(hd)
				)
					throw new LoginRejectedError("hosted_domain_not_allowed");
			}
			if (typeof claims.sub !== "string" || claims.sub.length === 0)
				throw new LoginRejectedError("missing_subject");
			return { issuer: claims.iss, subject: claims.sub };
		},
	};
}
