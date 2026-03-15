import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAuthCookie = request.cookies.has('firebase-auth-token');

  // Redirect authenticated users away from login
  if (pathname === '/login' && hasAuthCookie) {
    return NextResponse.redirect(new URL('/app', request.url));
  }

  // Redirect unauthenticated users to login
  if (pathname.startsWith('/app') && !hasAuthCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/login'],
};
