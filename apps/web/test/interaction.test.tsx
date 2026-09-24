// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuestionSection } from "../components/builder/question-section";
import PracticePage from "../app/kits/[id]/practice/page";
import type { Writer } from "../components/builder/kit-builder";
import { sampleKit } from "./kit";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "k1" }),
  useRouter: () => ({ push: vi.fn() }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("question builder", () => {
  it("Undo cancels the delayed destructive request", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue({}) as Writer;
    render(
      <QuestionSection
        kit={sampleKit()}
        write={write}
        onRegenerate={() => undefined}
        busySection={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Question removed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(() => vi.advanceTimersByTime(6000));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByText("How do you build a TypeScript service?")).toBeTruthy();
  });

  it("offers keyboard-accessible reorder controls", () => {
    const kit = sampleKit();
    kit.questions.push({ ...kit.questions[0]!, id: "q2", prompt: "How do you test it?" });
    const write = vi.fn().mockResolvedValue({}) as Writer;
    render(
      <QuestionSection kit={kit} write={write} onRegenerate={() => undefined} busySection={null} />,
    );
    const down = screen.getAllByRole("button", { name: "Move question down" });
    fireEvent.click(down[0]!);
    expect(write).toHaveBeenCalledWith(
      "/questions/order",
      "PUT",
      { category: "technical", ordered_ids: ["q2", "q1"] },
      expect.any(Function),
    );
  });
});

describe("practice", () => {
  it("reveals by keyboard and records confidence only after reveal", async () => {
    const fetcher = vi.fn((url: string) => {
      if (url.endsWith("/practice/session"))
        return Promise.resolve(
          new Response(JSON.stringify({ card_ids: ["f1"], cards: sampleKit().flashcards })),
        );
      if (url.endsWith("/practice/progress"))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              coveredCardIds: [],
              uncoveredCardIds: ["f1"],
              coveredCount: 0,
              totalCount: 1,
              coverageRatio: 0,
              requirement_readiness: { r1: false },
            }),
          ),
        );
      return Promise.resolve(
        new Response(JSON.stringify({ card_id: "f1", confidence: 3 }), { status: 201 }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PracticePage />
      </QueryClientProvider>,
    );
    await screen.findByText("Service design");
    fireEvent.keyDown(window, { key: "3" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByText("Design, tests, operation")).toBeTruthy();
    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        "/api/kits/k1/practice/reviews",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await screen.findByText("Session complete");
  });
});
