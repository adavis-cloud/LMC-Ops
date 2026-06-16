import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Scopes we request from Google.
 * - openid / email / profile: basic sign-in identity
 * - gmail.modify: read inbox + modify labels (mark read, star) and send mail.
 *   (We only ever send to the signed-in user — see lib/gmail.ts sendSelfEmail.)
 *
 * Keep this list minimal. Adding scopes later requires re-consent.
 */
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

/** Comma-separated exact-email allow-list, e.g. "you@gmail.com,sarah@..." */
function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Comma-separated domain allow-list, e.g. "lastmile.cafe" (any @lastmile.cafe). */
function allowedDomains(): string[] {
  return (process.env.ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** True if the email is explicitly allow-listed or its domain is allow-listed. */
function isAllowed(email: string | undefined | null): boolean {
  const e = email?.toLowerCase();
  if (!e) return false;
  if (allowedEmails().includes(e)) return true;
  const domain = e.split("@")[1];
  return !!domain && allowedDomains().includes(domain);
}

/**
 * Exchange the long-lived refresh token for a fresh access token.
 * Called automatically when the current access token is near expiry.
 */
async function refreshAccessToken(token: Record<string, unknown>) {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_GOOGLE_ID!,
        client_secret: process.env.AUTH_GOOGLE_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    });

    const refreshed = await res.json();
    if (!res.ok) throw refreshed;

    return {
      ...token,
      accessToken: refreshed.access_token,
      // expires_in is seconds-from-now; store an absolute ms timestamp
      expiresAt: Date.now() + refreshed.expires_in * 1000,
      // Google may or may not return a new refresh token; keep the old one if not
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      error: undefined,
    };
  } catch (err) {
    console.error("Failed to refresh Google access token", err);
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline", // needed to receive a refresh token
          prompt: "consent", // force consent so we reliably get the refresh token
        },
      },
    }),
  ],
  callbacks: {
    // Gate sign-in to the allow-list. If neither emails nor domains are
    // configured, deny everyone (fail closed) so the app is never world-open.
    async signIn({ profile }) {
      if (allowedEmails().length === 0 && allowedDomains().length === 0) {
        console.warn(
          "ALLOWED_EMAILS and ALLOWED_DOMAINS are both empty — denying all sign-ins.",
        );
        return false;
      }
      return isAllowed(profile?.email);
    },

    async jwt({ token, account }) {
      // First sign-in: persist tokens from Google onto the JWT
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + 3600 * 1000,
        };
      }

      // Subsequent requests: refresh if the access token is within 60s of expiry
      const expiresAt = (token.expiresAt as number | undefined) ?? 0;
      if (Date.now() < expiresAt - 60_000) return token;
      return refreshAccessToken(token);
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.error = token.error as string | undefined;
      return session;
    },
  },
});
