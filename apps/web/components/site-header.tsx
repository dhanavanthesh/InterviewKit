"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "./account-menu";

export function SiteHeader() {
  const pathname = usePathname();
  const onAuthPage = pathname === "/login" || pathname === "/register";

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href={onAuthPage ? "/login" : "/kits"}>
          <span className="brand-mark">
            <Image src="/interviewkit-mark.png" alt="" width={36} height={36} priority />
          </span>
          <span>InterviewKit</span>
        </Link>
        <nav aria-label="Primary">
          {onAuthPage ? (
            <>
              <Link href="/login" aria-current={pathname === "/login" ? "page" : undefined}>
                Sign in
              </Link>
              <Link href="/register" aria-current={pathname === "/register" ? "page" : undefined}>
                Create account
              </Link>
            </>
          ) : (
            <>
              <Link href="/kits" aria-current={pathname === "/kits" ? "page" : undefined}>
                My kits
              </Link>
              <Link
                href="/kits/new"
                className="nav-create"
                aria-current={pathname === "/kits/new" ? "page" : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 3v10M3 8h10" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                New kit
              </Link>
              <AccountMenu />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
