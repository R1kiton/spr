import type { StoredRoom } from "./rooms";

export class RoomApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type RoomRecord = { state: StoredRoom; version: number };
type StoreResult = RoomRecord | { conflict: true } | null;

/** Only the Next.js server calls this gateway. No database credentials reach the browser. */
export async function roomStore(operation: "read" | "create" | "update", code: string, state?: StoredRoom, version?: number): Promise<StoreResult> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const serverKey = process.env.ROOM_SERVER_SECRET;
  if (!url || !key || !serverKey) throw new RoomApiError("Las salas todavía no están configuradas en el servidor.", 503);
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/gesto_room_store`, {
      method: "POST",
      headers: {
        apikey: key,
        ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_server_key: serverKey, p_operation: operation, p_code: code, p_state: state ?? null, p_expected_version: version ?? null }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch { throw new RoomApiError("No pudimos conectar con la sala. Inténtalo de nuevo.", 503); }
  if (!response.ok) {
    // Do not log request bodies: they include the private gateway credential.
    console.error("Room storage request failed", response.status);
    throw new RoomApiError("No pudimos guardar la partida. Inténtalo de nuevo.", 503);
  }
  return response.json() as Promise<StoreResult>;
}

export async function readRoom(code: string): Promise<RoomRecord> {
  const result = await roomStore("read", code);
  if (!result || "conflict" in result) throw new RoomApiError("Esa sala no existe o ya caducó. Revisa el código.", 404);
  return result;
}
