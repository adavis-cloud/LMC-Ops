import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Learned from "@/app/learned";

export default async function LearnedPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-base font-semibold leading-tight tracking-tight text-ink">
              What I’ve learned
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
        <p className="mb-4 text-sm text-muted">
          Corrections from the <span className="font-medium">✓ Correct</span> /{" "}
          <span className="font-medium">✗ Not the right task</span> buttons. These
          shape which Asana task an email matches. Forget any that are no longer right.
        </p>
        <Learned />
      </div>
    </main>
  );
}
