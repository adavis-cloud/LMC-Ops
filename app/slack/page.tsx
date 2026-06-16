import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import Slack from "@/app/slack";
import { kvConfigured } from "@/lib/kv";
import { getSlackInstall } from "@/lib/slack-store";
import { isAsanaAutomationLinked } from "@/lib/asana-store";

export default async function SlackPage({
  searchParams,
}: {
  searchParams: Promise<{ slack?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const configured = kvConfigured();
  const install = configured ? await getSlackInstall().catch(() => null) : null;
  const asanaLinked = configured ? await isAsanaAutomationLinked().catch(() => false) : false;
  const notice = (await searchParams).slack;

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-base font-semibold leading-tight tracking-tight text-ink">
              Slack
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
        <Slack
          kvReady={configured}
          connected={Boolean(install)}
          teamName={install?.team_name}
          asanaLinked={asanaLinked}
          notice={notice}
        />
      </div>
    </main>
  );
}
