import { clearSessionCookie, readSession } from '../_auth.mjs'

export default function handler(request, response) {
  if (request.method === 'GET') {
    const session = readSession(request)
    response.status(200).json({ user: session ? { email: session.email, name: session.name } : null })
    return
  }
  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', clearSessionCookie())
    response.status(200).json({ user: null })
    return
  }
  response.status(405).json({ error: 'Method not allowed.' })
}