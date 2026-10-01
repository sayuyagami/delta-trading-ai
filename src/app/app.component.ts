import { ChangeDetectorRef, Component, OnDestroy } from '@angular/core'

interface ChartAnalysis {
  instrument: string
  timeframe: string
  bias: 'LONG' | 'SHORT' | 'NO_TRADE'
  entry: number | null
  entryY: number | null
  stopLoss: number | null
  stopLossY: number | null
  target: number | null
  confidence: number
  rationale: string
}

type ChartTimeframe = '1H'

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
})
export class AppComponent implements OnDestroy {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  oneHourFile: File | null = null
  oneHourFileName = 'No 1H chart selected'
  oneHourPreview: string | null = null
  oneHourImageAspectRatio = 1.8
  analysis: ChartAnalysis | null = null
  analysisError = ''
  analyzing = false
  riskAmount = 100
  instrument = 'FARTCOINUSD perpetual'
  tradeBias = 'Both directions'

  get hasCharts(): boolean {
    return Boolean(this.oneHourFile)
  }

  onFileChange(event: Event, timeframe: ChartTimeframe): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    this.analysis = null
    this.analysisError = ''
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      this.releasePreview()
      this.setChartFile(null)
      this.setChartFileName(`No ${timeframe} chart selected`)
      input.value = ''
      this.analysisError = `Choose a PNG or JPG ${timeframe} chart smaller than 10 MB.`
      return
    }

    this.releasePreview()
    this.setChartFile(file)
    this.setChartFileName(file.name)
    this.setChartPreview(URL.createObjectURL(file))
  }

  removeChart(input: HTMLInputElement, timeframe: ChartTimeframe): void {
    this.releasePreview()
    this.setChartFile(null)
    this.setChartFileName(`No ${timeframe} chart selected`)
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
      const file = this.chartFile()
      const charts = file
        ? [{ timeframe: '1H', mimeType: file.type, data: await this.readImage(file) }]
        : []
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

  onPreviewLoad(event: Event): void {
    const image = event.target as HTMLImageElement
    if (image.naturalWidth && image.naturalHeight) {
      this.oneHourImageAspectRatio = image.naturalWidth / image.naturalHeight
    }
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
    this.releasePreview()
  }

  private chartFile(): File | null {
    return this.oneHourFile
  }

  private setChartFile(file: File | null): void {
    this.oneHourFile = file
  }

  private setChartFileName(fileName: string): void {
    this.oneHourFileName = fileName
  }

  private setChartPreview(preview: string | null): void {
    this.oneHourPreview = preview
  }

  private releasePreview(): void {
    const preview = this.oneHourPreview
    if (preview) URL.revokeObjectURL(preview)
    this.setChartPreview(null)
  }
}