import { GoogleGenAI, Type } from '@google/genai'

const maxImageBytes = 10 * 1024 * 1024
const primaryModel = process.env.GEMINI_MODEL || 'models/gemini-3.8-flash'
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'models/gemini-3.5-flash-lite'
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    instrument: { type: Type.STRING },
    timeframe: { type: Type.STRING },
    bias: { type: Type.STRING, enum: ['LONG', 'SHORT', 'NO_TRADE'] },
    entry: { type: Type.NUMBER },
    entryY: { type: Type.NUMBER },
    stopLoss: { type: Type.NUMBER },
    stopLossY: { type: Type.NUMBER },
    target: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    rationale: { type: Type.STRING },
  },
  required: ['instrument', 'timeframe', 'bias', 'entry', 'entryY', 'stopLoss', 'stopLossY', 'target', 'confidence', 'rationale'],
}

function hasValidLevels(result) {
  if (result.bias === 'NO_TRADE') return true

  const positionsAreValid = [result.entryY, result.stopLossY]
    .every(value => Number.isFinite(value) && value >= 0 && value <= 100)
  const longLevelsAreValid = result.bias === 'LONG'
    && result.stopLoss < result.entry && result.entry < result.target
  const shortLevelsAreValid = result.bias === 'SHORT'
    && result.target < result.entry && result.entry < result.stopLoss

  return positionsAreValid && (longLevelsAreValid || shortLevelsAreValid)
}

function normalizeAnalysis(raw, requestedInstrument) {
  const result = JSON.parse(raw)
  const { bias, entry, entryY, stopLoss, stopLossY, target, confidence, rationale } = result
  if (!['LONG', 'SHORT', 'NO_TRADE'].includes(bias)
    || ![entry, stopLoss, target, confidence].every(Number.isFinite)
    || !hasValidLevels(result)
    || confidence < 0 || confidence > 100
    || typeof rationale !== 'string' || !rationale.trim()) {
    throw new Error('Gemini returned an incomplete chart analysis.')
  }

  return {
    instrument: typeof result.instrument === 'string' && result.instrument.trim()
      ? result.instrument.slice(0, 40)
      : requestedInstrument,
    timeframe: typeof result.timeframe === 'string' && result.timeframe.trim()
      ? result.timeframe.slice(0, 20)
      : '1H',
    bias,
    entry: bias === 'NO_TRADE' ? null : entry,
    entryY: bias === 'NO_TRADE' ? null : entryY,
    stopLoss: bias === 'NO_TRADE' ? null : stopLoss,
    stopLossY: bias === 'NO_TRADE' ? null : stopLossY,
    target: bias === 'NO_TRADE' ? null : target,
    confidence,
    rationale: rationale.slice(0, 600),
  }
}

async function generateAnalysis(ai, request) {
  try {
    return await ai.models.generateContent({ model: primaryModel, ...request })
  } catch (error) {
    if (error?.status !== 503 || primaryModel === fallbackModel) throw error
    return ai.models.generateContent({ model: fallbackModel, ...request })
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }
  if (!process.env.GEMINI_API_KEY) {
    response.status(503).json({ error: 'Gemini is not configured. Add GEMINI_API_KEY in Vercel environment variables.' })
    return
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}
    const { charts: chartInputs, instrument, tradeBias } = body
    if (!Array.isArray(chartInputs) || chartInputs.length !== 1) {
      response.status(400).json({ error: 'Provide one 1H chart image.' })
      return
    }

    const chart = chartInputs[0] || {}
    const { timeframe, mimeType, data } = chart
    if (timeframe !== '1H' || !['image/png', 'image/jpeg'].includes(mimeType)
      || typeof data !== 'string'
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      response.status(400).json({ error: 'Provide a valid PNG or JPG chart labeled 1H.' })
      return
    }

    const image = Buffer.from(data, 'base64')
    if (!image.length || image.length > maxImageBytes) {
      response.status(413).json({ error: 'The chart must be smaller than 10 MB.' })
      return
    }

    const requestedInstrument = typeof instrument === 'string' ? instrument.slice(0, 60) : 'Unknown instrument'
    const requestedBias = typeof tradeBias === 'string' ? tradeBias.slice(0, 40) : 'Both directions'
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    const result = await generateAnalysis(ai, {
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Analyze the supplied 1H trading chart image for ${requestedInstrument}. Use the 1H chart for trend, support/resistance, a potential entry, invalidation stop-loss, and first target. Set timeframe to 1H. Requested trade bias: ${requestedBias}. Read prices only when supported by the visible price axis; never invent a scale or levels. For each entry and stop-loss, also return entryY and stopLossY: the estimated vertical position of that price as a percentage of the full uploaded image height, from its top edge (0) to bottom edge (100). Account for the chart's visible plotting area within the image. The positions must correspond to the returned prices; do not guess if the image does not support a clear placement. Respect the requested bias. If the image is unreadable, lacks a legible price scale, or shows no clear setup, return bias NO_TRADE and set entry, entryY, stopLoss, stopLossY, and target to 0. Confidence is 0-100. Give a concise rationale citing visible chart evidence and uncertainty. These are approximate educational estimates, not financial advice.`,
          },
          { text: 'The following image is the 1H chart.' },
          { inlineData: { mimeType, data: image.toString('base64') } },
        ],
      }],
      config: { responseMimeType: 'application/json', responseSchema },
    })

    if (!result.text) throw new Error('Gemini returned no analysis.')
    response.status(200).json(normalizeAnalysis(result.text, requestedInstrument))
  } catch (error) {
    console.error('Chart analysis failed:', error)
    const status = error?.status >= 400 && error.status < 600 ? error.status : 502
    response.status(status).json({ error: error instanceof Error ? error.message : 'Gemini could not complete the request.' })
  }
}
