import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core'

interface ChartAnalysis {
  instrument: string
  timeframe: string
  bias: 'LONG' | 'SHORT' | 'NO_TRADE'
  entry: number | null
  stopLoss: number | null
  target: number | null
  confidence: number
  rationale: string
}

type ChartTimeframe = '1D' | '1H'

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
})
export class AppComponent implements OnDestroy {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  dailyFile: File | null = null
  hourlyFile: File | null = null
  dailyFileName = 'No 1D chart selected'
  hourlyFileName = 'No 1H chart selected'
  dailyPreview: string | null = null
  hourlyPreview: string | null = null
  analysis: ChartAnalysis | null = null
  analysisError = ''
  analyzing = false
  riskAmount = 100
  instrument = 'FARTCOINUSD perpetual'
  tradeBias = 'Both directions'

  get hasCharts(): boolean {
    return Boolean(this.dailyFile || this.hourlyFile)
  }

  onFileChange(event: Event, timeframe: ChartTimeframe): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    this.analysis = null
    this.analysisError = ''
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      this.releasePreview(timeframe)
      this.setChartFile(timeframe, null)
      this.setChartFileName(timeframe, `No ${timeframe} chart selected`)
      input.value = ''
      this.analysisError = `Choose a PNG or JPG ${timeframe} chart smaller than 10 MB.`
      return
    }

    this.releasePreview(timeframe)
    this.setChartFile(timeframe, file)
    this.setChartFileName(timeframe, file.name)
    this.setChartPreview(timeframe, URL.createObjectURL(file))
  }

  removeChart(input: HTMLInputElement, timeframe: ChartTimeframe): void {
    this.releasePreview(timeframe)
    this.setChartFile(timeframe, null)
    this.setChartFileName(timeframe, `No ${timeframe} chart selected`)
    this.analysis = null
    this.analysisError = ''
    input.value = ''
  }

  async onAnalyze(): Promise<void> {
    if (!this.hasCharts || this.analyzing) return

    this.analysis = null
    this.analysisError = ''
    this.analyzing = true

    try {
      const charts = []
      for (const timeframe of ['1D', '1H'] as const) {
        const file = this.chartFile(timeframe)
        if (file) charts.push({ timeframe, mimeType: file.type, data: await this.readImage(file) })
      }
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          charts,
          instrument: this.instrument,
          tradeBias: this.tradeBias,
        }),
      })
      const result = await response.json() as ChartAnalysis | { error?: string }
      if (!response.ok) {
        throw new Error('error' in result ? result.error : undefined)
      }
      this.analysis = result as ChartAnalysis
    } catch (error) {
      this.analysisError = error instanceof Error
        ? error.message
        : 'Could not analyze this chart. Please try again.'
    } finally {
      this.analyzing = false
      this.changeDetector.markForCheck()
    }
  }

  onRiskChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value)
    if (Number.isFinite(value) && value > 0) this.riskAmount = value
  }

  formatPrice(value: number | null | undefined): string {
    if (value == null) return '--'
    return value.toLocaleString(undefined, { maximumFractionDigits: 8 })
  }

  get suggestedSize(): string {
    if (this.analysis?.entry == null || this.analysis.stopLoss == null) return '--'
    const distance = Math.abs(this.analysis.entry - this.analysis.stopLoss)
    if (distance === 0) return '--'
    return (this.riskAmount / distance).toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  get riskReward(): string {
    if (this.analysis?.entry == null || this.analysis.stopLoss == null || this.analysis.target == null) return '--'
    const risk = Math.abs(this.analysis.entry - this.analysis.stopLoss)
    if (risk === 0) return '--'
    return `${(Math.abs(this.analysis.target - this.analysis.entry) / risk).toFixed(2)} : 1`
  }

  private readImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result
        if (typeof dataUrl !== 'string') {
          reject(new Error('Could not read the selected image.'))
          return
        }
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
      }
      reader.onerror = () => reject(new Error('Could not read the selected image.'))
      reader.readAsDataURL(file)
    })
  }

  ngOnDestroy(): void {
    this.releasePreview('1D')
    this.releasePreview('1H')
  }

  private chartFile(timeframe: ChartTimeframe): File | null {
    return timeframe === '1D' ? this.dailyFile : this.hourlyFile
  }

  private setChartFile(timeframe: ChartTimeframe, file: File | null): void {
    if (timeframe === '1D') this.dailyFile = file
    else this.hourlyFile = file
  }

  private setChartFileName(timeframe: ChartTimeframe, fileName: string): void {
    if (timeframe === '1D') this.dailyFileName = fileName
    else this.hourlyFileName = fileName
  }

  private setChartPreview(timeframe: ChartTimeframe, preview: string | null): void {
    if (timeframe === '1D') this.dailyPreview = preview
    else this.hourlyPreview = preview
  }

  private releasePreview(timeframe: ChartTimeframe): void {
    const preview = timeframe === '1D' ? this.dailyPreview : this.hourlyPreview
    if (preview) URL.revokeObjectURL(preview)
    this.setChartPreview(timeframe, null)
  }
}