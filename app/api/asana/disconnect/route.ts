import { NextRequest, NextResponse } from "next/server";
import { clearAsanaToken } from "@/lib/asana-session";

/** Forget the stored Asana token. */
export async function POST(req: NextRequest) {
  await clearAsanaToken();
  return NextResponse.redirect(new URL("/asana", req.nextUrl.origin), {
    status: 303,
  });
}
