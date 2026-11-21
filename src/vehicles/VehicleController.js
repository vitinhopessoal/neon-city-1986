import { damp } from '../utils/math.js';

/**
 * Motorista humano: traduz o teclado em comandos ABSTRATOS do veículo
 * (throttle −1..1, brake 0..1, steer −1..1, handbrake). Uma IA de trânsito
 * futura preencherá os mesmos campos (vehicle.controls) sem tocar na física.
 *
 * S freia enquanto o carro anda para a frente; parado (ou já em ré), engata
 * a ré após um breve instante. W com o carro em ré freia antes de acelerar.
 * Acelerador e freio sobem de forma progressiva (pedal, não interruptor).
 */
export class PlayerDriver {
  constructor() {
    this.reverseHold = 0;
    this.throttle = 0;
    this.brake = 0;
  }

  reset(vehicle) {
    this.reverseHold = 0;
    this.throttle = this.brake = 0;
    if (vehicle) Object.assign(vehicle.controls, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  }

  update(dt, input, vehicle) {
    const v = vehicle.physics ? vehicle.physics.vLong : 0;
    const fwd = input.isDown('forward'), back = input.isDown('back');
    let tThrottle = 0, tBrake = 0;
    if (fwd && !back) {
      this.reverseHold = 0;
      if (v < -0.8) tBrake = 1; else tThrottle = 1;
    } else if (back && !fwd) {
      if (v > 0.8) { tBrake = 1; this.reverseHold = 0; } else {
        this.reverseHold += dt;
        if (this.reverseHold > 0.15 || v < -0.3) tThrottle = -1; else tBrake = 1;
      }
    } else {
      this.reverseHold = 0;
    }
    // Pedais progressivos (aceleração suave; soltar é imediato no freio).
    this.throttle = Math.sign(tThrottle) !== Math.sign(this.throttle) ? tThrottle * 0.15 : damp(this.throttle, tThrottle, 6, dt);
    if (tThrottle === 0) this.throttle = damp(this.throttle, 0, 14, dt);
    this.brake = tBrake > this.brake ? damp(this.brake, tBrake, 12, dt) : tBrake;
    const c = vehicle.controls;
    c.throttle = Math.abs(this.throttle) < 0.02 ? 0 : this.throttle;
    c.brake = this.brake < 0.02 ? 0 : this.brake;
    c.steer = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    c.handbrake = input.isDown('handbrake');
  }
}
