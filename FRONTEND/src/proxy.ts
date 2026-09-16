import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "teamos_session";

/**
 * Optimistic check only: send visitors without a session cookie to /login.
 * Real authentication and authorization happen in the backend on every API call.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    const url = new URL("/login", request.url);
    if (pathname !== "/" && pathname !== "/dashboard") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Skip the API proxy, Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
