import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Asana from "@/app/asana";
import { isAsanaConnected } from "@/lib/asana-session";

export default async function AsanaPage({
  searchParams,
}: {
  searchParams: Promise<{ asana?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const connected = await isAsanaConnected();
  const notice = (await searchParams).asana;

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-base font-semibold leading-tight tracking-tight text-ink">
              Asana
            </h1>
            <Link href="/" className="text-xs text-brand hover:underline">
              ← Back to inbox
            </Link>
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
        <Asana connected={connected} notice={notice} />
      </div>
    </main>
  );
}
