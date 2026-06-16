import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearSlackInstall } from "@/lib/slack-store";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user) await clearSlackInstall();
  return NextResponse.redirect(new URL("/slack", req.nextUrl.origin), {
    status: 303,
  });
}
