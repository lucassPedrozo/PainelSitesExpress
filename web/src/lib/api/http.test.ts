import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, onUnauthorized } from "@/lib/access-token";
import { request, send } from "./http";

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cliente HTTP", () => {
  it("devolve o corpo em JSON e `null` quando a resposta é vazia", async () => {
    vi.stubGlobal("fetch", respond(200, { ok: true }));
    expect(await request("/api/x")).toEqual({ ok: true });

    vi.stubGlobal("fetch", respond(204));
    expect(await send("DELETE", "/api/x")).toBeNull();
  });

  it("recusa vira ApiError com a mensagem da API", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "Já existe" }));
    await expect(request("/api/x")).rejects.toMatchObject({
      status: 409,
      message: "Já existe",
    });
  });

  it("401 avisa quem cuida da sessão, além de rejeitar", async () => {
    const listener = vi.fn();
    const stop = onUnauthorized(listener);
    vi.stubGlobal("fetch", respond(401, { error: "Sessão encerrada" }));

    await expect(request("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledWith("Sessão encerrada");
    stop();
  });

  it("API fora do ar vira mensagem legível, não 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/api/x")).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/API local/),
    });
  });

  it("só impõe tempo limite quando pedido", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);

    await request("/api/x");
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();

    await request("/api/x", { timeoutMs: 1000 });
    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });
});
