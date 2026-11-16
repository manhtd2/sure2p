/**
 * Vercel entry for single-segment /api/* routes (/api/health, /api/me, ...).
 * All logic lives in server/vercelHandler.ts. Nested /api routes have their
 * own thin files under api/ — a catch-all api/[...path].ts is a Next.js-only
 * feature and does not match nested paths on a Vite static deploy.
 */
import { handleVercelRequest } from '../server/vercelHandler.js'

export const config = { maxDuration: 60 }
export const GET = handleVercelRequest
export const POST = handleVercelRequest
