// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableText, InlineText } from "../components/editable";
import { useKitWrites } from "../lib/kit-writes";
import { sampleKit } from "./kit";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("builder editing", () => {
  it("keeps a recoverable draft when a save fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    render(<EditableText label="Summary" value="Original" save={save} />);
    const input = screen.getByRole("textbox", { name: "Summary" });
    fireEvent.change(input, { target: { value: "My draft" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText("Save failed")).toBeTruthy());
    expect((input as HTMLInputElement).value).toBe("My draft");
  });

  it("serializes writes and lets regeneration await the queue", async () => {
    const client = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith("/role")) await gate;
        return new Response("{}", { status: 200 });
      }),
    );
    const { result } = renderHook(() => useKitWrites("k1"), { wrapper });
    const first = result.current.write("/role", "PATCH", { title: "New" });
    const second = result.current.write("/company-brief", "PATCH", { summary: "Edited" });
    await waitFor(() => expect(calls).toEqual(["/api/kits/k1/role"]));
    release();
    await Promise.all([first, second, result.current.flush()]);
    expect(calls).toEqual(["/api/kits/k1/role", "/api/kits/k1/company-brief"]);
  });

  it("rolls back an optimistic kit change when the API rejects it", async () => {
    const client = new QueryClient();
    const key = ["kit", "k1"];
    client.setQueryData(key, { id: "k1", status: "ready", version: 1, kit: sampleKit() });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "VERSION_CONFLICT", message: "Reload" } }), {
          status: 409,
        }),
      ),
    );
    const { result } = renderHook(() => useKitWrites("k1"), { wrapper });
    await expect(
      result.current.write("/company-brief", "PATCH", { summary: "Changed" }, (current) =>
        current.kit
          ? {
              ...current,
              kit: {
                ...current.kit,
                company_brief: { ...current.kit.company_brief, summary: "Changed" },
              },
            }
          : current,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(
      client.getQueryData<{ kit: ReturnType<typeof sampleKit> }>(key)?.kit.company_brief.summary,
    ).toBe("Example builds tools.");
  });
});

describe("inline text editing", () => {
  function open(label: string, text: string) {
    fireEvent.click(screen.getByText(text));
    return screen.getByRole("textbox", { name: label });
  }

  it("edits in place and saves trimmed text on blur", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<InlineText label="Question" value="Old prompt" save={save} />);
    const input = open("Question", "Old prompt");
    fireEvent.change(input, { target: { value: "  New prompt  " } });
    fireEvent.blur(input);
    await waitFor(() => expect(save).toHaveBeenCalledWith("New prompt"));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("saves with Ctrl+Enter and cancels with Escape", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<InlineText label="Question" value="Original" save={save} />);
    const first = open("Question", "Original");
    fireEvent.change(first, { target: { value: "Discarded" } });
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.getByText("Original")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    const second = open("Question", "Original");
    fireEvent.change(second, { target: { value: "Kept" } });
    fireEvent.keyDown(second, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledWith("Kept"));
  });

  it("does not save an empty required field", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<InlineText label="Question" value="Keep me" save={save} required />);
    const input = open("Question", "Keep me");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(await screen.findByText("Keep me")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the typed text after a failed save and retries it", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<InlineText label="Answer outline" value="Before" save={save} />);
    const input = open("Answer outline", "Before");
    fireEvent.change(input, { target: { value: "My careful edit" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Save failed")).toBeTruthy();
    expect(screen.getByText("My careful edit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("My careful edit"));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });
});
