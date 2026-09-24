import { SignJWT } from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { testContext } from "./support";

describe("API foundation", () => {
  it("serves a minimal public health response", async () => {
    const { app } = testContext();
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, version: "0.1.0" });
    expect(JSON.stringify(response.body)).not.toContain("MONGODB");
  });

  it("uses structured errors for unknown routes and invalid JSON", async () => {
    const { app } = testContext();
    const missing = await request(app).get("/api/unknown");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    const invalid = await request(app)
      .post("/api/auth/login")
      .set("content-type", "application/json")
      .send("{");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("enforces the JSON payload limit", async () => {
    const { app } = testContext();
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@example.com", password: "x".repeat(270_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("does not expose stack traces from production errors", async () => {
    const { app } = testContext({ production: true });
    const response = await request(app)
      .post("/api/auth/register")
      .set("origin", "https://web.example.com")
      .send({ email: "bad", password: "short" });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });
});

describe("authentication", () => {
  it("registers, reads the safe session user, logs out and revokes the token", async () => {
    const { app } = testContext();
    const agent = request.agent(app);
    const registered = await agent
      .post("/api/auth/register")
      .send({ email: " USER@Example.com ", password: "secure-password" });
    expect(registered.status).toBe(201);
    expect(registered.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(registered.body).toEqual({ id: expect.any(String), email: "user@example.com" });
    const me = await agent.get("/api/auth/me");
    expect(me.body).toEqual({ id: registered.body.id, email: "user@example.com" });
    expect(me.body).not.toHaveProperty("passwordHash");
    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).body.error.code).toBe("UNAUTHENTICATED");
  });

  it("throttles credential attempts but never the session check on page loads", async () => {
    const { app } = testContext();
    const agent = request.agent(app);
    await agent
      .post("/api/auth/register")
      .send({ email: "busy@example.com", password: "secure-password" });
    for (let visit = 0; visit < 30; visit += 1) {
      expect((await agent.get("/api/auth/me")).status).toBe(200);
    }
    const attempts = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      attempts.push(
        (
          await request(app)
            .post("/api/auth/login")
            .send({ email: "busy@example.com", password: "wrong-password" })
        ).status,
      );
    }
    expect(attempts).toContain(429);
  }, 30_000);

  it("rejects duplicate registration, invalid email and short passwords", async () => {
    const { app } = testContext();
    const first = await request(app)
      .post("/api/auth/register")
      .send({ email: "user@example.com", password: "secure-password" });
    expect(first.status).toBe(201);
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ email: "USER@example.com", password: "secure-password" })
      ).body.error.code,
    ).toBe("VALIDATION_FAILED");
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ email: "bad", password: "secure-password" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/auth/register")
          .send({ email: "next@example.com", password: "short" })
      ).status,
    ).toBe(400);
  });

  it("logs in and gives the same generic error for unknown email and wrong password", async () => {
    const { app } = testContext();
    await request(app)
      .post("/api/auth/register")
      .send({ email: "user@example.com", password: "secure-password" });
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "user@example.com", password: "secure-password" })
      ).status,
    ).toBe(200);
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com", password: "wrong-password" });
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "none@example.com", password: "wrong-password" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("distinguishes missing and invalid sessions", async () => {
    const { app } = testContext();
    expect((await request(app).get("/api/kits")).body.error.code).toBe("UNAUTHENTICATED");
    const tampered = await request(app).get("/api/kits").set("cookie", "sid=not-a-token");
    expect(tampered.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("rejects an expired signed session", async () => {
    const { app, repositories } = testContext();
    const user = await repositories.users.create("expired@example.com", "unused");
    const token = await new SignJWT({ token_version: 0 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(new TextEncoder().encode("a-secure-test-session-secret-over-thirty-two-bytes"));
    const response = await request(app).get("/api/kits").set("cookie", `sid=${token}`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("enforces the production origin on state-changing requests", async () => {
    const { app } = testContext({ production: true });
    const response = await request(app)
      .post("/api/auth/register")
      .set("origin", "https://evil.example")
      .send({ email: "user@example.com", password: "secure-password" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });
});
