import { auth, signIn, signOut } from "@/auth";
import Inbox from "@/app/inbox";
import Asana from "@/app/asana";
import { isAsanaConnected } from "@/lib/asana-session";

function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-brand text-cream ${className}`}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-1/2 w-1/2"
      >
        <path d="M18 8h1a3 3 0 0 1 0 6h-1" />
        <path d="M3 8h15v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8z" />
        <path d="M7 2v2M11 2v2M15 2v2" />
      </svg>
    </span>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ asana?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <Logo className="mx-auto h-14 w-14" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">
            Last Mile Connector
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Operations dashboard for Last Mile Cafe.
          </p>
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
            className="mt-7"
          >
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-medium text-cream transition hover:bg-brand-hover"
            >
              Sign in with Google
            </button>
          </form>
        </div>
        <p className="mt-6 text-xs text-muted">
          Restricted to lastmile.cafe accounts.
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <Logo className="h-9 w-9" />
            <div>
              <h1 className="text-base font-semibold leading-tight tracking-tight text-ink">
                Last Mile Connector
              </h1>
              <p className="text-xs text-muted">{session.user.email}</p>
            </div>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button
              type="submit"
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-cream"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <Inbox />
        <Asana connected={await isAsanaConnected()} notice={(await searchParams).asana} />
      </div>
    </main>
  );
}
