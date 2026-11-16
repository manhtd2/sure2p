/** Zod schemas shared by the API and the browser forms. */
import { z } from 'zod'
import {
  FUNDING_WINDOW_SECONDS,
  HANDOVER_MARGIN_SECONDS,
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
} from './protocol.js'

const uintString = z.string().regex(/^\d{1,30}$/, 'Expected a non-negative integer string')

export const dealTermsSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  quantity: z.string().trim().min(1).max(40),
  acceptanceCriteria: z.string().trim().min(5).max(1000),
  deliveryChannel: z.string().trim().min(2).max(200),
  priceUnits: uintString.refine((v) => BigInt(v) > 0n, 'Price must be greater than zero'),
  handoverDeadline: z.number().int().positive(),
  buyerResponseSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS),
  inspectionSeconds: z.number().int().min(MIN_DURATION_SECONDS).max(MAX_DURATION_SECONDS),
})

/** Terms must leave room for the 24h funding window after the escrow is created. */
export function handoverDeadlineError(handoverDeadline: number, nowSec: number): string | null {
  if (handoverDeadline <= nowSec + FUNDING_WINDOW_SECONDS + HANDOVER_MARGIN_SECONDS) {
    return 'handover_deadline_too_soon'
  }
  return null
}

export const roleSchema = z.enum(['buyer', 'seller'])
export type Role = z.infer<typeof roleSchema>

export const createDraftSchema = z.object({
  role: roleSchema,
  terms: dealTermsSchema,
})

export const counterofferSchema = z.object({
  terms: dealTermsSchema,
})

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, for example +84901234567')

export const otpRequestSchema = z.object({ phone: phoneSchema })
export const otpVerifySchema = z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) })

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
export const hexSignatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130,}$/)

export const walletChallengeSchema = z.object({ address: addressSchema })
export const walletVerifySchema = z.object({
  message: z.string().min(20).max(2000),
  signature: hexSignatureSchema,
})

export const signAgreementSchema = z.object({
  versionId: z.string().min(1).max(64),
  signature: hexSignatureSchema,
  acknowledgedDisclosure: z.literal(true),
})

export const inviteLookupSchema = z.object({
  token: z.string().min(20).max(200).optional(),
  code: z.string().min(8).max(40).optional(),
})

export const txHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
export const submittedTxSchema = z.object({ txHash: txHashSchema })
export const pendingTxSchema = z.object({
  txHash: txHashSchema,
  action: z.string().min(2).max(40),
})

export const createSettlementSchema = z.object({
  buyerPriceRefund: uintString,
})

export const signSettlementSchema = z.object({ signature: hexSignatureSchema })
