import { BillingError, handleAdminPaymentAction, isManualPaymentAdmin } from '../_manual-payment.mjs'
import { readSession } from '../_auth.mjs'

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }

  const user = readSession(request)
  if (!user) {
    response.status(401).json({ error: 'Sign in to continue.' })
    return
  }
  if (request.method === 'GET' && !isManualPaymentAdmin(user)) {
    response.status(200).json({ isAdmin: false, payments: [] })
    return
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}
    const result = await handleAdminPaymentAction(request.method === 'GET' ? 'list' : 'review', user, body)
    response.status(200).json({ isAdmin: true, ...result })
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 502
    response.status(status).json({
      error: error instanceof BillingError ? error.message : 'Could not process the admin payment request.',
    })
  }
}
