import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core'
import QRCode from 'qrcode'

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void
      renderButton(element: HTMLElement, options: { theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'rectangular'; width: number }): void
      disableAutoSelect(): void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentityServices
  }
}

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

interface SubscriptionStatus {
  active: boolean
  status: string
  currentEnd: string | null
  paymentRequest?: ManualPaymentRequest | null
}

interface ManualPaymentRequest {
  requestId: string
  reference: string | null
  payeeName: string
  amount: number
  upiUri: string
}

interface AdminPaymentReview {
  google_sub: string
  email: string
  name: string
  manual_payment_request_id: string
  manual_payment_reference: string
  manual_payment_submitted_at: string
}

type ChartTimeframe = '1H'

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
})
export class AppComponent implements AfterViewInit, OnDestroy {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  @ViewChild('googleButton') private readonly googleButton!: ElementRef<HTMLDivElement>

  authUser: { email: string; name: string } | null = null
  authLoading = true
  authError = ''
  subscription: SubscriptionStatus | null = null
  manualPayment: ManualPaymentRequest | null = null
  paymentQrDataUrl = ''
  transactionReference = ''
  subscriptionLoading = true
  billingBusy = false
  billingError = ''
  subscriptionDialogOpen = false
  isPaymentAdmin = false
  adminDialogOpen = false
  adminPayments: AdminPaymentReview[] = []
  adminLoading = false
  adminBusyRequestId = ''
  adminError = ''
  adminMessage = ''
  private subscriptionExpiryTimer: ReturnType<typeof setTimeout> | null = null
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

  ngAfterViewInit(): void {
    void this.initializeAuth()
  }

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
    if (!this.subscription?.active) {
      this.openSubscriptionDialog()
      return
    }
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
      if (response.status === 402) {
        await this.refreshSubscription()
        this.openSubscriptionDialog()
        return
      }
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

  async signOut(): Promise<void> {
    await fetch('/api/auth/session', { method: 'DELETE' })
    window.google?.accounts.id.disableAutoSelect()
    this.clearSubscriptionExpiryTimer()
    this.authUser = null
    this.subscription = null
    this.manualPayment = null
    this.paymentQrDataUrl = ''
    this.transactionReference = ''
    this.subscriptionDialogOpen = false
    this.adminDialogOpen = false
    this.isPaymentAdmin = false
    this.adminPayments = []
    this.analysis = null
    this.authError = ''
    this.authLoading = true
    this.changeDetector.markForCheck()
    await this.initializeAuth()
  }

  openSubscriptionDialog(): void {
    this.billingError = ''
    this.subscriptionDialogOpen = true
  }

  closeSubscriptionDialog(): void {
    this.subscriptionDialogOpen = false
  }

  openAdminDialog(): void {
    this.adminError = ''
    this.adminMessage = ''
    this.adminDialogOpen = true
    void this.refreshAdminPayments()
  }

  closeAdminDialog(): void {
    this.adminDialogOpen = false
  }

  async refreshAdminPayments(): Promise<void> {
    if (!this.authUser) return
    this.adminLoading = true
    this.adminError = ''
    try {
      const response = await fetch('/api/admin/payments')
      const result = await response.json() as { isAdmin?: boolean; payments?: AdminPaymentReview[]; error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not load payment reviews.')
      this.isPaymentAdmin = Boolean(result.isAdmin)
      this.adminPayments = result.payments || []
      if (!this.isPaymentAdmin) this.adminDialogOpen = false
    } catch (error) {
      this.adminError = error instanceof Error ? error.message : 'Could not load payment reviews.'
    } finally {
      this.adminLoading = false
      this.changeDetector.markForCheck()
    }
  }

  async reviewManualPayment(payment: AdminPaymentReview, decision: 'approve' | 'reject'): Promise<void> {
    if (!this.isPaymentAdmin || this.adminBusyRequestId) return
    if (decision === 'approve' && !window.confirm(`Confirm the ₹99 payment from ${payment.email} (${payment.manual_payment_reference}) has arrived in your account?`)) return

    this.adminBusyRequestId = payment.manual_payment_request_id
    this.adminError = ''
    this.adminMessage = ''
    try {
      const response = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleSub: payment.google_sub,
          requestId: payment.manual_payment_request_id,
          reference: payment.manual_payment_reference,
          decision,
          note: decision === 'approve' ? 'Verified as received in bank account' : 'Payment could not be verified',
        }),
      })
      const result = await response.json() as { payment?: AdminPaymentReview; error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not review this payment.')
      this.adminPayments = this.adminPayments.filter(item => item.manual_payment_request_id !== payment.manual_payment_request_id)
      this.adminMessage = decision === 'approve'
        ? `Payment approved. ${payment.email} now has one month of access.`
        : `Payment rejected. ${payment.email} can submit a new reference.`
      if (payment.email === this.authUser?.email) await this.refreshSubscription()
    } catch (error) {
      this.adminError = error instanceof Error ? error.message : 'Could not review this payment.'
    } finally {
      this.adminBusyRequestId = ''
      this.changeDetector.markForCheck()
    }
  }

  formatSubscriptionDate(value: string): string {
    return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' })
  }

  async startSubscription(): Promise<void> {
    if (!this.authUser || this.billingBusy) return

    this.billingBusy = true
    this.billingError = ''
    try {
      const response = await fetch('/api/subscription/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const result = await response.json() as SubscriptionStatus & { error?: string }
      if (!response.ok || !result.paymentRequest) {
        throw new Error(result.error || 'Could not load manual payment details.')
      }
      this.subscription = result
      await this.setManualPayment(result.paymentRequest)
    } catch (error) {
      this.billingError = error instanceof Error ? error.message : 'Could not load manual payment details.'
      this.billingBusy = false
    } finally {
      this.billingBusy = false
      this.changeDetector.markForCheck()
    }
  }

  onReferenceChange(event: Event): void {
    this.transactionReference = (event.target as HTMLInputElement).value
  }

  private async setManualPayment(request: ManualPaymentRequest | null | undefined): Promise<void> {
    this.manualPayment = request || null
    this.transactionReference = request?.reference || ''
    this.paymentQrDataUrl = ''
    if (!request || request.reference) return

    try {
      this.paymentQrDataUrl = await QRCode.toDataURL(request.upiUri, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 280,
      })
    } catch {
      this.billingError = 'Could not generate the payment QR. Please refresh and try again.'
    }
  }

  async submitManualPaymentReference(): Promise<void> {
    if (!this.manualPayment || this.billingBusy) return
    this.billingBusy = true
    this.billingError = ''
    try {
      const response = await fetch('/api/subscription/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: this.manualPayment.requestId,
          reference: this.transactionReference,
        }),
      })
      const result = await response.json() as SubscriptionStatus & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not submit the payment reference.')
      this.subscription = result
      await this.setManualPayment(result.paymentRequest || this.manualPayment)
    } catch (error) {
      this.billingError = error instanceof Error ? error.message : 'Could not submit the payment reference.'
    } finally {
      this.billingBusy = false
      this.changeDetector.markForCheck()
    }
  }

  async refreshSubscription(): Promise<void> {
    if (!this.authUser) return
    this.subscriptionLoading = true
    this.billingError = ''
    try {
      const response = await fetch('/api/subscription/status')
      const result = await response.json() as SubscriptionStatus & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not check your subscription.')
      this.subscription = result
      await this.setManualPayment(result.paymentRequest)
      if (result.status === 'completed') this.subscriptionDialogOpen = true
      this.scheduleSubscriptionExpiry()
    } catch (error) {
      this.clearSubscriptionExpiryTimer()
      this.subscription = null
      this.billingError = error instanceof Error ? error.message : 'Could not check your subscription.'
    } finally {
      this.subscriptionLoading = false
      this.changeDetector.markForCheck()
    }
  }

  private async initializeAuth(): Promise<void> {
    try {
      const [sessionResponse, configResponse] = await Promise.all([
        fetch('/api/auth/session'),
        fetch('/api/auth/config'),
      ])
      if (!sessionResponse.ok || !configResponse.ok) throw new Error('Could not connect to the sign-in service.')
      const session = await sessionResponse.json() as { user: { email: string; name: string } | null }
      const config = await configResponse.json() as { clientId: string }
      this.authUser = session.user

      if (this.authUser) {
        await this.refreshSubscription()
        await this.refreshAdminPayments()
      } else {
        this.subscriptionLoading = false
        if (!config.clientId) throw new Error('Google sign-in is not configured. Add GOOGLE_CLIENT_ID to the server environment.')
        await this.loadGoogleIdentityServices()
        window.google?.accounts.id.initialize({
          client_id: config.clientId,
          callback: response => { void this.completeGoogleSignIn(response.credential) },
        })
        window.google?.accounts.id.renderButton(this.googleButton.nativeElement, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 320,
        })
      }
    } catch (error) {
      this.authError = error instanceof Error ? error.message : 'Google sign-in could not be loaded.'
    } finally {
      this.authLoading = false
      this.changeDetector.markForCheck()
    }
  }

  private async completeGoogleSignIn(credential: string): Promise<void> {
    this.authLoading = true
    this.authError = ''
    this.changeDetector.markForCheck()
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      })
      const result = await response.json() as { user?: { email: string; name: string }; error?: string }
      if (!response.ok || !result.user) throw new Error(result.error || 'Google sign-in could not be completed.')
      this.authUser = result.user
      await this.refreshSubscription()
      await this.refreshAdminPayments()
    } catch (error) {
      this.authError = error instanceof Error ? error.message : 'Google sign-in could not be completed.'
    } finally {
      this.authLoading = false
      this.changeDetector.markForCheck()
    }
  }

  private loadGoogleIdentityServices(): Promise<void> {
    if (window.google) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection and reload.'))
      document.head.append(script)
    })
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
    this.clearSubscriptionExpiryTimer()
    this.releasePreview()
  }

  private scheduleSubscriptionExpiry(): void {
    this.clearSubscriptionExpiryTimer()
    if (!this.subscription?.active || !this.subscription.currentEnd) return

    const remaining = Date.parse(this.subscription.currentEnd) - Date.now()
    if (remaining <= 0) {
      this.subscription = { ...this.subscription, active: false, status: 'completed' }
      this.subscriptionDialogOpen = true
      return
    }

    this.subscriptionExpiryTimer = setTimeout(() => { void this.refreshSubscription() }, remaining)
  }

  private clearSubscriptionExpiryTimer(): void {
    if (this.subscriptionExpiryTimer) clearTimeout(this.subscriptionExpiryTimer)
    this.subscriptionExpiryTimer = null
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