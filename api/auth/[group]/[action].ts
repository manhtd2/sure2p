/**
 * Vercel entry for the /api/auth/otp and /api/auth/wallet routes
 * (otp/request, otp/verify, wallet/challenge, wallet/verify).
 * Thin wrapper — all logic lives in server/vercelHandler.ts (see that
 * file for why nested /api routes need their own files on a Vite
 * static deploy). NOTE: never write a star followed by a slash
 * inside a block comment in an api/ file — it closes the comment
 * early and the transpiled output fails to parse.
 */
import { handleVercelRequest } from '../../../server/vercelHandler.js'

export const config = { maxDuration: 60 }
export const GET = handleVercelRequest
export const POST = handleVercelRequest
