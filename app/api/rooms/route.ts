import { NextRequest } from "next/server";
import { enterRoom, getRoom, roomError } from "../../../lib/room-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return await getRoom(request); } catch (error) { return roomError(error); }
}

export async function POST(request: NextRequest) {
  try { return await enterRoom(request); } catch (error) { return roomError(error); }
}
