import { NextRequest } from "next/server";
import { actInRoom, roomError } from "../../../../lib/room-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await context.params;
    return await actInRoom(request, code);
  } catch (error) { return roomError(error); }
}
