import { BillingError, handleBillingAction } from './_billing.mjs'
import { readSession } from './_auth.mjs'

export function createBillingHandler(action, method) {
  return async function handler(request, response) {
    if (request.method !== method) {
      response.status(405).json({ error: 'Method not allowed.' })
      return
    }

    const user = readSession(request)
    if (!user) {
      response.status(401).json({ error: 'Sign in with Google to manage your subscription.' })
      return
    }

    try {
      const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}
      response.status(200).json(await handleBillingAction(action, user, body))
    } catch (error) {
      const status = error instanceof BillingError ? error.status : 502
      response.status(status).json({
        error: error instanceof BillingError ? error.message : 'Subscription service could not complete the request.',
      })
    }
  }
}
