import "next-auth";

declare module "next-auth" {
  interface Session {
    /** Google OAuth access token, used to call the Gmail API. */
    accessToken?: string;
    /** Set to "RefreshAccessTokenError" if a token refresh failed. */
    error?: string;
  }
}
