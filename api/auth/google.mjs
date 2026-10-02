import { authIsConfigured, createSessionCookie, verifyGoogleCredential } from '../_auth.mjs'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }
  if (!authIsConfigured()) {
    response.status(503).json({ error: 'Google sign-in is not configured on the server.' })
    return
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}
    const user = await verifyGoogleCredential(body.credential)
    response.setHeader('Set-Cookie', createSessionCookie(user))
    response.status(200).json({ user: { email: user.email, name: user.name } })
  } catch {
    response.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' })
  }
}