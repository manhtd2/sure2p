/**
 * Vercel entry for /api/invitations/* (claim, peek). Thin wrapper — all
 * logic lives in server/vercelHandler.ts. Named [id] (not [action])
 * because this directory also holds [id]/revoke.ts: Vercel requires
 * dynamic segments in the same directory to share a name.
 */
import { handleVercelRequest } from '../../server/vercelHandler.js'

export const config = { maxDuration: 60 }
export const GET = handleVercelRequest
export const POST = handleVercelRequest
