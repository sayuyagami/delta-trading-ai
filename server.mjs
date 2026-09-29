import { createServer } from 'node:http'
import { GoogleGenAI, Type } from '@google/genai'

const port = Number(process.env.API_PORT || 3001)
const maxImageBytes = 10 * 1024 * 1024
const maxRequestBytes = 14 * 1024 * 1024
const apiKey = process.env.GEMINI_API_KEY
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    instrument: { type: Type.STRING },
    timeframe: { type: Type.STRING },
    bias: { type: Type.STRING, enum: ['LONG', 'SHORT', 'NO_TRADE'] },
    entry: { type: Type.NUMBER },
    stopLoss: { type: Type.NUMBER },
    target: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    rationale: { type: Type.STRING },
  },
  required: ['instrument', 'timeframe', 'bias', 'entry', 'stopLoss', 'target', 'confidence', 'rationale'],
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxRequestBytes) throw Object.assign(new Error('Image exceeds the 10 MB limit.'), { status: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 })
  }
}

function normalizeAnalysis(raw, requestedInstrument) {
  const result = JSON.parse(raw)
  const { bias, entry, stopLoss, target, confidence, rationale } = result
  if (!['LONG', 'SHORT', 'NO_TRADE'].includes(bias)
    || ![entry, stopLoss, target, confidence].every(Number.isFinite)
    || confidence < 0 || confidence > 100
    || typeof rationale !== 'string' || !rationale.trim()) {
    throw new Error('Gemini returned an incomplete chart analysis.')
  }

  if (bias !== 'NO_TRADE') {
    const validLong = bias === 'LONG' && stopLoss < entry && entry < target
    const validShort = bias === 'SHORT' && target < entry && entry < stopLoss
    if (!validLong && !validShort) throw new Error('Gemini returned inconsistent entry, stop-loss, or target levels.')
  }

  return {
    instrument: typeof result.instrument === 'string' && result.instrument.trim()
      ? result.instrument.slice(0, 40)
      : requestedInstrument,
    timeframe: typeof result.timeframe === 'string' && result.timeframe.trim()
      ? result.timeframe.slice(0, 20)
      : 'Unknown timeframe',
    bias,
    entry: bias === 'NO_TRADE' ? null : entry,
    stopLoss: bias === 'NO_TRADE' ? null : stopLoss,
    target: bias === 'NO_TRADE' ? null : target,
    confidence,
    rationale: rationale.slice(0, 600),
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/api/analyze') {
    sendJson(response, 404, { error: 'Not found.' })
    return
  }
  if (!ai) {
    sendJson(response, 503, { error: 'Gemini is not configured. Add GEMINI_API_KEY to .env and restart the app.' })
    return
  }

  try {
    const body = await readJson(request)
    const { mimeType, data, instrument, tradeBias } = body
    if (!['image/png', 'image/jpeg'].includes(mimeType) || typeof data !== 'string'
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      sendJson(response, 400, { error: 'Provide a valid PNG or JPG chart image.' })
      return
    }

    const image = Buffer.from(data, 'base64')
    if (!image.length || image.length > maxImageBytes) {
      sendJson(response, 413, { error: 'Image must be smaller than 10 MB.' })
      return
    }

    const requestedInstrument = typeof instrument === 'string' ? instrument.slice(0, 60) : 'Unknown instrument'
    const requestedBias = typeof tradeBias === 'string' ? tradeBias.slice(0, 40) : 'Both directions'
    const result = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Analyze this trading-chart screenshot. Requested instrument: ${requestedInstrument}. Trade bias: ${requestedBias}. Read price values only when the visible axis supports them; never invent a scale or levels. Identify the latest visible price action and a technically plausible entry, invalidation stop-loss, and first target. Respect the requested bias. If the chart is unreadable, lacks a legible price scale, or has no clear setup, return bias NO_TRADE and set entry, stopLoss, and target to 0. Confidence is 0-100. Give a concise rationale that states relevant chart evidence and any uncertainty. This is educational chart analysis, not financial advice.`,
          },
          { inlineData: { mimeType, data: image.toString('base64') } },
        ],
      }],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    })

    if (!result.text) throw new Error('Gemini returned no analysis.')
    sendJson(response, 200, normalizeAnalysis(result.text, requestedInstrument))
  } catch (error) {
    const status = error?.status || 502
    const message = status < 500 && error instanceof Error
      ? error.message
      : 'Chart analysis failed. Check the Gemini API key and try again.'
    console.error('Chart analysis failed:', error)
    sendJson(response, status, { error: message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Chart analysis API listening on http://127.0.0.1:${port}`)
  if (!apiKey) console.warn('GEMINI_API_KEY is not configured; chart analysis requests will be rejected.')
})