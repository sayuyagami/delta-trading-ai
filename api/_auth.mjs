import { createHmac, timingSafeEqual } from 'node:crypto'

const sessionCookieName = 'tradeguru_session'
const sessionLifetimeSeconds = 7 * 24 * 60 * 60

export function authIsConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.AUTH_SESSION_SECRET?.length >= 32)
}

export async function verifyGoogleCredential(credential) {
  if (typeof credential !== 'string' || !credential) throw new Error('Missing Google credential.')

  const url = new URL('https://oauth2.googleapis.com/tokeninfo')
  url.searchParams.set('id_token', credential)
  const response = await fetch(url)
  if (!response.ok) throw new Error('Google rejected the sign-in credential.')

  const identity = await response.json()
  const expiration = Number(identity.exp)
  if (identity.aud !== process.env.GOOGLE_CLIENT_ID
    || !['accounts.google.com', 'https://accounts.google.com'].includes(identity.iss)
    || identity.email_verified !== 'true'
    || typeof identity.sub !== 'string'
    || typeof identity.email !== 'string'
    || !Number.isFinite(expiration)
    || expiration <= Math.floor(Date.now() / 1000)) {
    throw new Error('Google returned an invalid or expired identity.')
  }

  return {
    sub: identity.sub,
    email: identity.email,
    name: typeof identity.name === 'string' && identity.name ? identity.name : identity.email,
  }
}

export function createSessionCookie(user) {
  const secret = process.env.AUTH_SESSION_SECRET
  if (!secret) throw new Error('AUTH_SESSION_SECRET is not configured.')

  const payload = Buffer.from(JSON.stringify({
    ...user,
    exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds,
  })).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${sessionCookieName}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}${secureCookieSuffix()}`
}

export function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`
}

export function readSession(request) {
  const cookieHeader = request.headers?.cookie || ''
  const cookie = cookieHeader.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${sessionCookieName}=`))
  if (!cookie) return null

  const [payload, signature] = cookie.slice(sessionCookieName.length + 1).split('.')
  const secret = process.env.AUTH_SESSION_SECRET
  if (!payload || !signature || !secret) return null

  const expected = createHmac('sha256', secret).update(payload).digest()
  let actual
  try {
    actual = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof session.sub !== 'string' || typeof session.email !== 'string'
      || !Number.isFinite(session.exp) || session.exp <= Math.floor(Date.now() / 1000)) return null
    return { sub: session.sub, email: session.email, name: session.name }
  } catch {
    return null
  }
}

function secureCookieSuffix() {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : ''
}