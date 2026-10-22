# Setting up Google and Microsoft sign-in

Owner steps for ADR 0012. Nothing here goes live until production is approved. Never put a client secret in git, a chat, a ticket or a screenshot: keep it in the organisation's secret manager.

`<public>` below is the website's public address, which is also `REO_PUBLIC_URL` (for local testing, `http://127.0.0.1:3000`). The website passes `/auth/*` and `/v1/*` through to the API (ADR 0016), so the redirect URIs point at the website, not the API.

## Google (Google Cloud and Google Workspace)

1. In Google Cloud console, create a project for the brokerage (or use an existing one).
2. Under **Google Auth Platform**, set the audience to **Internal** so only your Workspace accounts can sign in.
3. Create an **OAuth client ID** of type **Web application**.
4. Add the authorized redirect URI `<public>/auth/google/callback`. Add only the exact URIs you use.
5. Copy the client ID and client secret straight into the secret manager as `REO_GOOGLE_CLIENT_ID` and `REO_GOOGLE_CLIENT_SECRET`.
6. Optional: set `REO_GOOGLE_HOSTED_DOMAINS` to your Workspace domain(s), comma-separated.
7. In the Google Workspace admin console, require 2-Step Verification for all staff.

## Microsoft (Entra ID)

1. In the Microsoft Entra admin centre, open **App registrations** and choose **New registration**.
2. For supported account types, choose **Accounts in this organizational directory only** (single tenant).
3. Add a **Web** redirect URI: `<public>/auth/microsoft/callback`.
4. Under **Certificates & secrets**, create a client secret with an expiry date, and put a reminder to rotate it before it expires.
5. Store the **Application (client) ID**, the secret and the **Directory (tenant) ID** as `REO_MICROSOFT_CLIENT_ID`, `REO_MICROSOFT_CLIENT_SECRET` and `REO_MICROSOFT_TENANT_ID`.
6. Require multi-factor authentication for all staff with a Conditional Access policy (or security defaults).

## Both providers

- Signing in does not create accounts. Each person needs an approved, active membership first; it is matched by the provider's issuer and subject, never by email.
- Also set `REO_PUBLIC_URL`, a random `REO_LOGIN_COOKIE_SECRET` of at least 32 characters, and `REO_DATABASE_URL` (a login role that is a member of `reo_app`).
- A provider is enabled only when all of its values are set. A partly configured provider stops the API from starting, on purpose.
- When someone leaves, suspend their membership as well as their provider account: either one ends their session.
