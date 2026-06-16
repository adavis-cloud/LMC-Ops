import { auth, signIn, signOut } from "@/auth";
import Inbox from "@/app/inbox";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Last Mile Connector
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Operations dashboard — sign in to continue.
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <button
            type="submit"
            className="rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Sign in with Google
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-6 sm:p-10">
      <header className="flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Last Mile Connector
          </h1>
          <p className="text-sm text-gray-500">
            Signed in as {session.user.email}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut();
          }}
        >
          <button
            type="submit"
            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium transition hover:bg-gray-100"
          >
            Sign out
          </button>
        </form>
      </header>

      <Inbox />
    </main>
  );
}
