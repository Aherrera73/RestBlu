// Observación pasiva para la demo. No es PAD/prueba de vida certificada:
// dificulta una foto fija, pero un video o una cámara virtual pueden engañarla.
export class PassiveFaceObservation {
  reset() {
    this.phase = 'settling';
    this.openSince = 0;
    this.blinkSince = 0;
    this.releaseFrames = 0;
    this.referenceBox = null;
  }

  constructor() {
    this.reset();
  }

  update(sample, now) {
    if (sample.faces !== 1) {
      this.reset();
      return { ready: false, message: sample.faces > 1
        ? 'Debe haber una sola persona frente a la cámara.'
        : 'Sitúa el rostro completo frente a la cámara.' };
    }

    const eyesOpen = sample.blinkLeft < 0.25 && sample.blinkRight < 0.25;
    const eyesClosed = sample.blinkLeft > 0.55 && sample.blinkRight > 0.55;
    const box = sample.box;

    if (this.phase === 'settling') {
      this.openSince = eyesOpen ? this.openSince || now : 0;
      if (this.openSince && now - this.openSince >= 600) {
        this.phase = 'watching';
        this.referenceBox = box;
      }
      return { ready: false, message: 'Analizando el rostro de forma automática…' };
    }

    if (this.phase === 'watching') {
      if (eyesOpen) this.referenceBox = box;
      if (eyesClosed && this.referenceBox && stableBox(box, this.referenceBox)) {
        this.phase = 'blink';
        this.blinkSince = now;
      }
      return { ready: false, message: 'Observando señales naturales del rostro…' };
    }

    if (this.phase === 'blink') {
      if (now - this.blinkSince > 1_500 || !stableBox(box, this.referenceBox)) {
        this.phase = 'watching';
        this.releaseFrames = 0;
        return { ready: false, message: 'Observando señales naturales del rostro…' };
      }
      this.releaseFrames = eyesOpen ? this.releaseFrames + 1 : 0;
      if (this.releaseFrames >= 2) {
        this.phase = 'complete';
        return { ready: true, message: 'Señal facial natural detectada. Comparando rostro…' };
      }
    }

    return { ready: false, message: 'Observando señales naturales del rostro…' };
  }
}

function stableBox(current, reference) {
  if (!current || !reference) return false;
  return Math.abs(current.x - reference.x) < 0.08 &&
    Math.abs(current.y - reference.y) < 0.08 &&
    Math.abs(current.width - reference.width) < reference.width * 0.18 &&
    Math.abs(current.height - reference.height) < reference.height * 0.18;
}
