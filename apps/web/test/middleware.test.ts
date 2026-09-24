import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "../middleware";

function request(headers: Record<string, string>, cookie?: string) {
  return new NextRequest("http://localhost:3000/kits", {
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  });
}

describe("route protection", () => {
  it("redirects to the public origin behind a reverse proxy", () => {
    const response = middleware(
      request({
        host: "localhost:3000",
        "x-forwarded-host": "kits.example.com",
        "x-forwarded-proto": "https",
      }),
    );
    expect(response.headers.get("location")).toBe("https://kits.example.com/login?next=%2Fkits");
  });

  it("keeps the local origin when no proxy headers are present", () => {
    const response = middleware(request({ host: "localhost:3000" }));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fkits");
  });

  it("lets a signed-in visitor through", () => {
    const response = middleware(request({ host: "localhost:3000" }, "sid=token"));
    expect(response.headers.get("location")).toBeNull();
  });
});
