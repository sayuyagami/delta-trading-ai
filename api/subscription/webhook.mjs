import { BillingError, handlePhonePeWebhook } from '../_billing.mjs'

export const config = { api: { bodyParser: false } }

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 1024 * 1024) throw new BillingError(413, 'Webhook payload is too large.')
      chunks.push(chunk)
    }
    const rawBody = Buffer.concat(chunks).toString('utf8')
    response.status(200).json(await handlePhonePeWebhook(rawBody, request.headers.authorization))
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 502
    response.status(status).json({
      error: error instanceof BillingError ? error.message : 'PhonePe callback could not be processed.',
    })
  }
}
