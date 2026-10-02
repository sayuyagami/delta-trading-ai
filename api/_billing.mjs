import { randomUUID } from 'node:crypto'
import { CallbackType, Env, MetaInfo, StandardCheckoutClient, StandardCheckoutPayRequest } from '@phonepe-pg/pg-sdk-node'

const subscriptionTable = 'user_subscriptions'
const monthlyPricePaise = 9900

export class BillingError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function billingIsConfigured() {
  return Boolean(process.env.PHONEPE_CLIENT_ID
    && process.env.PHONEPE_CLIENT_SECRET
    && process.env.PHONEPE_CLIENT_VERSION
    && Number.isInteger(Number(process.env.PHONEPE_CLIENT_VERSION))
    && process.env.SUPABASE_URL
    && process.env.SUPABASE_SERVICE_ROLE_KEY
    && process.env.PHONEPE_WEBHOOK_USERNAME
    && process.env.PHONEPE_WEBHOOK_PASSWORD
    && ['SANDBOX', 'PRODUCTION'].includes(process.env.PHONEPE_ENV || 'SANDBOX')
    && publicAppUrlIsValid())
}

export async function handleBillingAction(action, user, body = {}) {
  if (!billingIsConfigured()) {
    throw new BillingError(503, 'PhonePe payments are not configured yet. Please try again later.')
  }
  switch (action) {
    case 'status':
      return getAccessStatus(user)
    case 'create':
      return createPaymentOrder(user)
    case 'verify':
      return verifyPayment(user, body)
    default:
      throw new BillingError(404, 'Payment action not found.')
  }
}

export async function handlePhonePeWebhook(rawBody, authorization) {
  const username = process.env.PHONEPE_WEBHOOK_USERNAME
  const password = process.env.PHONEPE_WEBHOOK_PASSWORD
  if (!username || !password) throw new BillingError(503, 'PhonePe webhook authentication is not configured.')

  let callback
  try {
    callback = getPhonePe().validateCallback(username, password, authorization || '', rawBody)
  } catch {
    throw new BillingError(401, 'PhonePe webhook authentication failed.')
  }

  const { event, payload } = callback || {}
  const isOrderEvent = event === 'checkout.order.completed'
    || event === 'checkout.order.failed'
    || callback?.type === CallbackType.CHECKOUT_ORDER_COMPLETED
    || callback?.type === CallbackType.CHECKOUT_ORDER_FAILED
    || callback?.type === 'CHECKOUT_ORDER_COMPLETED'
    || callback?.type === 'CHECKOUT_ORDER_FAILED'
  if (!isOrderEvent || typeof payload?.merchantOrderId !== 'string') {
    return { received: true }
  }

  const saved = await findPendingOrder(payload.merchantOrderId)
  if (!saved) return { received: true }

  const orderStatus = await getPhonePe().getOrderStatus(payload.merchantOrderId)
  await applyOrderStatus(saved, orderStatus)
  return { received: true }
}

async function getAccessStatus(user) {
  let saved = await findUserSubscription(user.sub)
  if (!saved) return inactiveStatus()

  if (saved.phonepe_merchant_order_id) {
    const orderStatus = await getPhonePe().getOrderStatus(saved.phonepe_merchant_order_id)
    await applyOrderStatus(saved, orderStatus)
    saved = await findUserSubscription(user.sub)
    if (!saved) return inactiveStatus()
    if (saved.phonepe_merchant_order_id) {
      const expiresAt = saved.access_expires_at ? new Date(saved.access_expires_at) : null
      const isActive = Boolean(expiresAt && expiresAt.getTime() > Date.now())
      return {
        active: isActive,
        status: isActive ? 'active' : 'pending',
        currentEnd: expiresAt?.toISOString() || null,
      }
    }
  }

  const expiresAt = saved.access_expires_at ? new Date(saved.access_expires_at) : null
  const isActive = Boolean(expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > Date.now())
  const status = isActive ? 'active' : expiresAt ? 'completed' : 'inactive'
  if (saved.status !== status) await updateSubscriptionStatus(user.sub, status)
  return { active: isActive, status, currentEnd: expiresAt?.toISOString() || null }
}

async function createPaymentOrder(user) {
  const current = await getAccessStatus(user)
  if (current.active) throw new BillingError(409, 'Your one-month access is already active.')
  if (current.status === 'pending') {
    throw new BillingError(409, 'A PhonePe payment is already pending. Check its status before starting another payment.')
  }

  const merchantOrderId = randomUUID()
  const metaInfo = MetaInfo.builder().udf1(user.sub).build()
  const request = StandardCheckoutPayRequest.builder()
    .merchantOrderId(merchantOrderId)
    .amount(monthlyPricePaise)
    .metaInfo(metaInfo)
    .redirectUrl(createReturnUrl(merchantOrderId))
    .expireAfter(1800)
    .build()

  let order
  try {
    order = await getPhonePe().pay(request)
  } catch {
    throw new BillingError(502, 'PhonePe could not start checkout. Please try again.')
  }
  if (order.state !== 'PENDING' || typeof order.redirectUrl !== 'string' || !order.redirectUrl.startsWith('https://')) {
    throw new BillingError(502, 'PhonePe returned an invalid checkout response.')
  }

  await savePendingOrder(user, merchantOrderId)
  return { merchantOrderId, redirectUrl: order.redirectUrl }
}

async function verifyPayment(user, body) {
  const { merchantOrderId } = body
  if (typeof merchantOrderId !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(merchantOrderId)) {
    throw new BillingError(400, 'PhonePe order details are invalid.')
  }

  const saved = await findUserSubscription(user.sub)
  if (!saved) throw new BillingError(403, 'This payment does not belong to the signed-in account.')
  if (saved.phonepe_last_merchant_order_id === merchantOrderId
    && saved.access_expires_at && new Date(saved.access_expires_at).getTime() > Date.now()) {
    return getAccessStatus(user)
  }
  if (saved.phonepe_merchant_order_id !== merchantOrderId) {
    throw new BillingError(403, 'This payment does not belong to the signed-in account.')
  }

  const orderStatus = await getPhonePe().getOrderStatus(merchantOrderId)
  await applyOrderStatus(saved, orderStatus)
  return getAccessStatus(user)
}

async function applyOrderStatus(saved, orderStatus) {
  const user = {
    sub: saved.google_sub,
    email: saved.email,
    name: saved.name,
  }
  if (orderStatus.merchantOrderId !== saved.phonepe_merchant_order_id
    || orderStatus.amount !== monthlyPricePaise
    || orderStatus.metaInfo?.udf1 !== user.sub) {
    throw new BillingError(403, 'PhonePe returned an order that does not match this account.')
  }

  if (orderStatus.state === 'FAILED') {
    await clearPendingOrder(saved, 'failed')
    return
  }
  if (orderStatus.state !== 'COMPLETED') return

  const payment = (orderStatus.paymentDetails || []).find(detail =>
    detail.state === 'COMPLETED' && detail.amount === monthlyPricePaise && detail.transactionId)
  if (!payment) throw new BillingError(402, 'PhonePe has not confirmed a completed payment yet.')

  if (saved.phonepe_last_merchant_order_id === orderStatus.merchantOrderId && saved.access_expires_at) return

  const paidAt = Number.isFinite(payment.timestamp) ? new Date(payment.timestamp) : new Date()
  const expiresAt = addOneCalendarMonth(paidAt)
  await saveCompletedPayment(user, {
    merchantOrderId: orderStatus.merchantOrderId,
    transactionId: payment.transactionId,
    expiresAt: expiresAt.toISOString(),
  })
}

function addOneCalendarMonth(date) {
  const expiration = new Date(date)
  const dayOfMonth = expiration.getUTCDate()
  expiration.setUTCDate(1)
  expiration.setUTCMonth(expiration.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(expiration.getUTCFullYear(), expiration.getUTCMonth() + 1, 0)).getUTCDate()
  expiration.setUTCDate(Math.min(dayOfMonth, lastDay))
  return expiration
}

function createReturnUrl(merchantOrderId) {
  const baseUrl = process.env.PUBLIC_APP_URL || 'http://localhost:4200'
  const url = new URL('/', baseUrl)
  url.searchParams.set('phonepe_order_id', merchantOrderId)
  return url.toString()
}

function publicAppUrlIsValid() {
  if (process.env.VERCEL && !process.env.PUBLIC_APP_URL) return false
  try {
    const url = new URL(process.env.PUBLIC_APP_URL || 'http://localhost:4200')
    return url.protocol === 'https:' || (process.env.PHONEPE_ENV || 'SANDBOX') === 'SANDBOX'
  } catch {
    return false
  }
}

function inactiveStatus() {
  return { active: false, status: 'inactive', currentEnd: null }
}

async function findUserSubscription(googleSub) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('google_sub', `eq.${googleSub}`)
  url.searchParams.set('select', 'google_sub,email,name,phonepe_merchant_order_id,phonepe_last_merchant_order_id,phonepe_payment_transaction_id,access_expires_at,status')
  const response = await supabaseRequest(url)
  const rows = await response.json()
  return rows[0] || null
}

async function findPendingOrder(merchantOrderId) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('phonepe_merchant_order_id', `eq.${merchantOrderId}`)
  url.searchParams.set('select', 'google_sub,email,name,phonepe_merchant_order_id,phonepe_last_merchant_order_id,phonepe_payment_transaction_id,access_expires_at,status')
  const response = await supabaseRequest(url)
  const rows = await response.json()
  return rows[0] || null
}

async function savePendingOrder(user, merchantOrderId) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('on_conflict', 'google_sub')
  await supabaseRequest(url, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      google_sub: user.sub,
      email: user.email,
      name: user.name,
      phonepe_merchant_order_id: merchantOrderId,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }),
  })
}

async function saveCompletedPayment(user, payment) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('on_conflict', 'google_sub')
  await supabaseRequest(url, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      google_sub: user.sub,
      email: user.email,
      name: user.name,
      phonepe_merchant_order_id: null,
      phonepe_last_merchant_order_id: payment.merchantOrderId,
      phonepe_payment_transaction_id: payment.transactionId,
      access_expires_at: payment.expiresAt,
      status: 'active',
      updated_at: new Date().toISOString(),
    }),
  })
}

async function clearPendingOrder(saved, status) {
  const url = new URL(`/rest/v1/${subscriptionTable}`, process.env.SUPABASE_URL)
  url.searchParams.set('google_sub', `eq.${saved.google_sub}`)
  url.searchParams.set('phonepe_merchant_order_id', `eq.${saved.phonepe_merchant_order_id}`)
  await supabaseRequest(url, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ phonepe_merchant_order_id: null, status, updated_at: new Date().toISOString() }),
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
    throw new BillingError(503, 'Subscription storage is temporarily unavailable.')
  }
  if (!response.ok) throw new BillingError(503, 'Subscription storage is not ready. Check the billing setup.')
  return response
}

let phonePeClient
function getPhonePe() {
  if (!phonePeClient) {
    const environment = (process.env.PHONEPE_ENV || 'SANDBOX') === 'PRODUCTION' ? Env.PRODUCTION : Env.SANDBOX
    phonePeClient = StandardCheckoutClient.getInstance(
      process.env.PHONEPE_CLIENT_ID,
      process.env.PHONEPE_CLIENT_SECRET,
      Number(process.env.PHONEPE_CLIENT_VERSION),
      environment,
    )
  }
  return phonePeClient
}
