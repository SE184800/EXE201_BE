/* Android-only Web Speech adapter, injected by SupplyMindSpeechPlugin before page scripts.
 * Keeps the hosted FE usable without deploying it together with every APK update. */
(() => {
  const native = window.Capacitor?.Plugins?.SupplyMindSpeech;
  if (!native || window.SpeechRecognition?.supplyMindNative) return;
  let current = null;

  class SupplyMindSpeechRecognition extends EventTarget {
    static supplyMindNative = true;
    lang = 'vi-VN';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart = null;
    onaudioend = null;
    onresult = null;
    onerror = null;
    onend = null;
    sessionId = null;
    timer = null;

    emit(type, detail = {}) {
      const event = Object.assign(new Event(type), detail);
      this.dispatchEvent(event);
      if (typeof this['on' + type] === 'function') this['on' + type](event);
    }

    deadline(ms) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const sessionId = this.sessionId;
        if (!sessionId) return;
        void native.cancel({ sessionId }).catch(() => {});
        this.finish('error', {
          error: 'no-speech',
          message: 'Hết thời gian chờ giọng nói. Hãy thử lại.',
        });
      }, ms);
    }

    finish(type, detail) {
      if (!this.sessionId) return;
      this.sessionId = null;
      clearTimeout(this.timer);
      this.timer = null;
      if (current === this) current = null;
      try {
        this.emit(type, detail);
      } finally {
        this.emit('end');
      }
    }

    start() {
      if (current) throw new DOMException('Mic đang được sử dụng.', 'InvalidStateError');
      current = this;
      const sessionId = Date.now() + '-' + Math.random().toString(36).slice(2);
      this.sessionId = sessionId;
      this.deadline(45000);
      try {
        native.listen({ sessionId, language: this.lang || 'vi-VN' }, (data, error) => {
          if (this.sessionId !== sessionId) return;
          if (error) {
            this.finish('error', { error: error.code || 'audio-capture', message: error.message });
          } else if (data?.type === 'start') {
            this.deadline(25000);
            this.emit('start');
          } else if (data?.type === 'audioend') {
            this.deadline(12000);
            this.emit('audioend');
          } else if (data?.type === 'result') {
            const result = [{ transcript: data.transcript, confidence: 1 }];
            result.isFinal = true;
            this.finish('result', { resultIndex: 0, results: [result] });
          }
        });
      } catch (error) {
        this.finish('error', { error: 'audio-capture', message: error.message });
      }
    }

    stop() {
      const sessionId = this.sessionId;
      if (!sessionId) return;
      this.deadline(12000);
      void native.stop({ sessionId }).catch((error) => {
        if (this.sessionId === sessionId)
          this.finish('error', { error: 'audio-capture', message: error.message });
      });
    }

    abort() {
      const sessionId = this.sessionId;
      if (!sessionId) return;
      void native.cancel({ sessionId }).catch(() => {});
      this.finish('error', { error: 'aborted', message: 'Đã dừng nghe.' });
    }
  }

  window.SpeechRecognition = SupplyMindSpeechRecognition;
  window.webkitSpeechRecognition = SupplyMindSpeechRecognition;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) current?.abort();
  });
  window.addEventListener('pagehide', () => current?.abort());
})();
