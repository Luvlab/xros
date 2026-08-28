/**
 * Hands-free voice: speech recognition for search + commands, and speech
 * synthesis for the intro / spoken feedback. Web Speech API (Chrome/Android;
 * needs https + mic permission). Degrades silently where unsupported.
 */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition

export class Voice {
  constructor() {
    this.onResult = null
    this.onStateChange = null
    this.listening = false
    this.rec = null
    if (SR) {
      this.rec = new SR()
      this.rec.lang = 'en-US'
      this.rec.interimResults = false
      this.rec.maxAlternatives = 1
      this.rec.continuous = false
      this.rec.onresult = (e) => {
        const text = e.results[0]?.[0]?.transcript?.trim()
        if (text) this.onResult?.(text)
      }
      this.rec.onend = () => this._setListening(false)
      this.rec.onerror = () => this._setListening(false)
    }
  }

  get supported() {
    return !!this.rec
  }

  _setListening(v) {
    this.listening = v
    this.onStateChange?.(v)
  }

  start() {
    if (!this.rec || this.listening) return
    try {
      this.rec.start()
      this._setListening(true)
    } catch {
      /* already started */
    }
  }

  stop() {
    if (this.rec && this.listening) this.rec.stop()
  }

  toggle() {
    this.listening ? this.stop() : this.start()
  }

  /** Speak text (TTS). Cancels anything queued. */
  speak(text) {
    try {
      const synth = window.speechSynthesis
      if (!synth) return
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.02
      u.pitch = 1
      synth.speak(u)
    } catch {
      /* no TTS */
    }
  }
}
