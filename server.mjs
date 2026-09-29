import { createServer } from 'node:http'
import { GoogleGenAI, Type } from '@google/genai'

const port = Number(process.env.API_PORT || 3001)
const maxImageBytes = 10 * 1024 * 1024
const maxRequestBytes = 28 * 1024 * 1024
const apiKey = process.env.GEMINI_API_KEY
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null
const primaryModel = process.env.GEMINI_MODEL || 'models/gemini-3.8-flash'
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'models/gemini-3.5-flash-lite'

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
    if (size > maxRequestBytes) throw Object.assign(new Error('Chart images exceed the combined 20 MB limit.'), { status: 413 })
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

async function generateAnalysis(request) {
  try {
    return await ai.models.generateContent({ model: primaryModel, ...request })
  } catch (error) {
    if (error?.status !== 503 || primaryModel === fallbackModel) throw error

    console.warn(`Gemini model ${primaryModel} returned 503; retrying with ${fallbackModel}.`)
    return ai.models.generateContent({ model: fallbackModel, ...request })
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
    const { charts: chartInputs, instrument, tradeBias } = body
    if (!Array.isArray(chartInputs) || chartInputs.length < 1 || chartInputs.length > 2) {
      sendJson(response, 400, { error: 'Provide one or two chart images labeled 1D or 1H.' })
      return
    }

    const seenTimeframes = new Set()
    const charts = []
    let totalImageBytes = 0
    for (const chart of chartInputs) {
      const { timeframe, mimeType, data } = chart || {}
      if (!['1D', '1H'].includes(timeframe) || seenTimeframes.has(timeframe)
        || !['image/png', 'image/jpeg'].includes(mimeType) || typeof data !== 'string'
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
        sendJson(response, 400, { error: 'Provide valid PNG or JPG charts labeled 1D or 1H.' })
        return
      }

      seenTimeframes.add(timeframe)
      const image = Buffer.from(data, 'base64')
      totalImageBytes += image.length
      if (!image.length || image.length > maxImageBytes || totalImageBytes > maxImageBytes * 2) {
        sendJson(response, 413, { error: 'Each chart must be smaller than 10 MB.' })
        return
      }
      charts.push({ timeframe, mimeType, data: image.toString('base64') })
    }

    const requestedInstrument = typeof instrument === 'string' ? instrument.slice(0, 60) : 'Unknown instrument'
    const requestedBias = typeof tradeBias === 'string' ? tradeBias.slice(0, 40) : 'Both directions'
    const result = await generateAnalysis({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Analyze the supplied trading chart images for ${requestedInstrument}. Each image is labeled with its timeframe. Use the 1D chart for broader trend and major support/resistance, and the 1H chart for a potential entry, invalidation stop-loss, and first target. Set timeframe to the supplied timeframe labels joined together, such as 1D + 1H. Requested trade bias: ${requestedBias}. Read prices only when supported by the visible price axis; never invent a scale or levels. If the charts disagree about current price, state that uncertainty in the rationale. Respect the requested bias. If the images are unreadable, lack a legible price scale, or show no clear setup, return bias NO_TRADE and set entry, stopLoss, and target to 0. Confidence is 0-100. Give a concise rationale citing visible chart evidence and uncertainty. These are approximate educational estimates, not financial advice.`,
          },
          ...charts.flatMap(chart => [
            { text: `The following image is the ${chart.timeframe} chart.` },
            { inlineData: { mimeType: chart.mimeType, data: chart.data } },
          ]),
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
    let message = 'Gemini could not complete the request. Try again shortly.'
    if (status === 503) {
      message = 'Gemini is temporarily overloaded on the primary and fallback models. Try again shortly.'
    } else if (status === 429) {
      message = 'Gemini request quota reached. Check your API quota or try again later.'
    } else if (status === 401 || status === 403) {
      message = 'Gemini rejected the API key. Verify GEMINI_API_KEY and restart the API server.'
    } else if (status < 500 && error instanceof Error) {
      message = error.message
    }
    console.error('Chart analysis failed:', error)
    sendJson(response, status, { error: message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Chart analysis API listening on http://127.0.0.1:${port}`)
  if (!apiKey) console.warn('GEMINI_API_KEY is not configured; chart analysis requests will be rejected.')
})