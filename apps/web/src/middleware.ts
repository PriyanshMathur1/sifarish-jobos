import { NextResponse, type NextRequest } from "next/server";

/**
 * Attaches a request correlation id (SPEC: structured logging). Route
 * handlers pick it up via the `x-request-id` header and log through
 * `requestLogger(reqId)`. (Full request logging middleware is deliberately
 * not done at the edge — pino is a Node logger.)
 */
export function middleware(req: NextRequest) {
  const reqId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const headers = new Headers(req.headers);
  headers.set("x-request-id", reqId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", reqId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
