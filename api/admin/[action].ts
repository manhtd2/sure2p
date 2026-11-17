/**
 * Vercel entry for /api/admin/me, /api/admin/roles and /api/admin/cases. Thin wrapper: all logic lives in server/vercelHandler.ts
 * (nested /api routes need their own files on a Vite static deploy).
 */
import { handleVercelRequest } from '../../server/vercelHandler.js'

export const config = { maxDuration: 60 }
export const GET = handleVercelRequest
export const POST = handleVercelRequest
