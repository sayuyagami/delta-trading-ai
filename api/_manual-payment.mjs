import { randomUUID } from 'node:crypto'

const subscriptionTable = 'user_subscriptions'
const monthlyPriceRupees = 99

export class BillingError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function billingIsConfigured() {
  return Boolean(process.env.MANUAL_PAYMENT_UPI_ID
    && process.env.SUPABASE_URL
    && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function handleBillingAction(action, user, body = {}) {
  if (!billingIsConfigured()) {
    throw new BillingError(503, 'Manual payment details are not configured on the server.')
  }

  switch (action) {
    case 'status':
      return getAccessStatus(user)
    case 'create':
      return createPaymentRequest(user)
    case 'submit':
      return submitPaymentReference(user, body)
    default:
      throw new BillingError(404, 'Payment action not found.')
  }
}

async function getAccessStatus(user) {
  const saved = await findUserSubscription(user.sub)
  if (!saved) return inactiveStatus()

  const expiresAt = saved.access_expires_at ? new Date(saved.access_expires_at) : null
  const hasValidExpiry = Boolean(expiresAt && Number.isFinite(expiresAt.getTime()))
  const isActive = saved.manual_payment_status === 'approved'
    && hasValidExpiry
    && expiresAt.getTime() > Date.now()

  if (isActive) return { active: true, status: 'active', currentEnd: expiresAt.toISOString() }
  if (saved.status === 'pending_review') {
    return {
      active: false,
      status: 'pending_review',
      currentEnd: expiresAt?.toISOString() || null,
      paymentRequest: paymentRequestDetails(saved),
    }
  }
  if (saved.status === 'pending') {
    return {
      active: false,
      status: 'pending',
      currentEnd: expiresAt?.toISOString() || null,
      paymentRequest: paymentRequestDetails(saved),
    }
  }

  const status = hasValidExpiry ? 'completed' : 'inactive'
  if (saved.status !== status) await updateSubscriptionStatus(user.sub, status)
  return { active: false, status, currentEnd: expiresAt?.toISOString() || null }
}

async function createPaymentRequest(user) {
  const current = await getAccessStatus(user)
  if (current.active) throw new BillingError(409, 'Your one-month access is already active.')
  if (current.status === 'pending' || current.status === 'pending_review') return current

  const requestId = randomUUID()
  await savePaymentRequest(user, requestId)
  return {
    active: false,
    status: 'pending',
    currentEnd: current.currentEnd,
    paymentRequest: paymentRequestDetails({
      manual_payment_request_id: requestId,
      manual_payment_reference: null,
    }),
  }
}

async function submitPaymentReference(user, body) {
  const requestId = typeof body.requestId === 'string' ? body.requestId : ''
  const reference = typeof body.reference === 'string' ? body.reference.trim() : ''
  if (!/^[0-9A-Za-z-]{6,40}$/.test(reference)) {
    throw new BillingError(400, 'Enter a valid UPI transaction reference (6–40 letters or digits).')
  }

  const saved = await findUserSubscription(user.sub)
  if (!saved || saved.manual_payment_request_id !== requestId || saved.status !== 'pending') {
    throw new BillingError(409, 'Start a new payment request before submitting its transaction reference.')
  }

  const existing = await findPaymentReference(reference)
  if (existing && existing.google_sub !== user.sub) {
    throw new BillingError(409, 'That transaction reference has already been submitted.')
  }

  await updatePaymentReference(user.sub, requestId, reference)
  return getAccessStatus(user)
}

function paymentRequestDetails(saved) {
  return {
    requestId: saved.manual_payment_request_id,
    reference: saved.manual_payment_reference || null,
    upiId: process.env.MANUAL_PAYMENT_UPI_ID,
    payeeName: process.env.MANUAL_PAYMENT_PAYEE_NAME || 'TradeGuru',
    amount: monthlyPriceRupees,
  }
}

function inactiveStatus() {
  return { active: false, status: 'inactive', currentEnd: null }
}

function selectedSubscriptionFields() {
  return 'google_sub,email,name,manual_payment_request_id,manual_payment_reference,manual_payment_status,access_expires_at,status'
}

async function findUserSubscription(googleSub) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('google_sub', `eq.${googleSub}`)
  url.searchParams.set('select', selectedSubscriptionFields())
  const response = await supabaseRequest(url)
  const rows = await response.json()
  return rows[0] || null
}

async function findPaymentReference(reference) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('manual_payment_reference', `eq.${reference}`)
  url.searchParams.set('select', 'google_sub')
  const response = await supabaseRequest(url)
  const rows = await response.json()
  return rows[0] || null
}

async function savePaymentRequest(user, requestId) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('on_conflict', 'google_sub')
  await supabaseRequest(url, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      google_sub: user.sub,
      email: user.email,
      name: user.name,
      manual_payment_request_id: requestId,
      manual_payment_reference: null,
      manual_payment_status: 'pending',
      manual_payment_submitted_at: null,
      manual_payment_reviewed_at: null,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }),
  })
}

async function updatePaymentReference(googleSub, requestId, reference) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('google_sub', `eq.${googleSub}`)
  url.searchParams.set('manual_payment_request_id', `eq.${requestId}`)
  await supabaseRequest(url, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      manual_payment_reference: reference,
      manual_payment_status: 'pending_review',
      status: 'pending_review',
      manual_payment_submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  })
}

async function updateSubscriptionStatus(googleSub, status) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('google_sub', `eq.${googleSub}`)
  await supabaseRequest(url, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  })
}

async function supabaseRequest(url, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  let response
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  } catch {
    throw new BillingError(503, 'Payment review storage is temporarily unavailable.')
  }
  if (!response.ok) throw new BillingError(503, 'Payment review storage is not ready. Check the Supabase setup.')
  return response
}
