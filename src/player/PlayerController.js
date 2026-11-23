import * as THREE from 'three';
import { angleDelta, clamp, dampAngle } from '../utils/math.js';
import { BEACH } from '../world/Terrain.js';

/**
 * Controlador físico do personagem (cápsula aproximada por cilindro).
 * - Aceleração/desaceleração suaves, controle aéreo reduzido
 * - Gravidade, pulo com "coyote time" e buffer de entrada
 * - Detecção de solo com subida automática de degraus (meio-fio) e rampas
 * - Resolução de penetração horizontal via CollisionSystem
 * O modo de câmera NUNCA altera a posição física: apenas a orientação
 * desejada do corpo (facingMode).
 */
export class PlayerController {
  constructor(collision, world, config) {
    this.collision = collision;
    // Ambiente de mapa ativo (Sunset Beach ou mapa importado): água, superfícies e limites.
    this.env = world;
    this.cfg = config;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.turnRate = 0;
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airTime = 0;
    this.facingMode = 'movement';
    this.wading = false;
    this.waterDepth = 0;
    this.seaDepth = 0;
    // Estado SWIMMING: flutua na superfície, sem pulo, deslocamento lento.
    this.swimming = false;
    this.swimTime = 0;
    this.onSwimChange = null;
    this.boundaryHint = null;
    this.forwardSign = 1;
    this.lastSafe = new THREE.Vector3();
    this._safeTimer = 0;
    this._wish = new THREE.Vector3();
    this._pos2 = { x: 0, z: 0 };
    this.onJump = null;
    this.onLand = null;
  }

  /** Troca o mapa ativo (colisões + regras de água/limites). */
  setEnvironment(env) {
    this.env = env;
    this.collision = env.collision;
  }

  teleport(x, y, z, yaw = this.yaw) {
    if (this.swimming) this._setSwimming(false);
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.grounded = true;
    this.lastSafe.copy(this.position);
  }

  _setSwimming(on) {
    if (this.swimming === on) return;
    this.swimming = on;
    this.swimTime = 0;
    this.onSwimChange?.(on);
  }

  /** Superfície da água em (x, z): ondas sincronizadas quando o mapa as fornece. */
  _surface(x, z) {
    return this.env.waterHeight ? this.env.waterHeight(x, z) : BEACH.waterLevel;
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /**
   * input: { moveX, moveZ, run, jump } (jump = pressionado neste quadro)
   * cameraYaw: yaw da câmera (para movimento relativo à visão)
   */
  update(dt, input, cameraYaw) {
    if (input.jump) this.jumpBuffer = this.cfg.jumpBufferTime;
    const prevYaw = this.yaw;
    // Subpassos para estabilidade das colisões em quadros longos.
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this._step(h, input, cameraYaw);
    const rate = dt > 0 ? angleDelta(prevYaw, this.yaw) / dt : 0;
    this.turnRate += (rate - this.turnRate) * Math.min(1, dt * 12);
  }

  _step(dt, input, cameraYaw) {
    const c = this.cfg;
    const p = this.position;
    const v = this.velocity;

    // ------------------------------------------------ intenção de movimento
    const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);
    const w = this._wish.set(fx * input.moveZ + rx * input.moveX, 0, fz * input.moveZ + rz * input.moveX);
    const wl = w.length();
    if (wl > 1) w.divideScalar(wl);

    // Profundidade sob o jogador (fundo do mar) e lâmina d'água nos pés
    // (zero sobre píeres e conveses, mesmo com água funda embaixo).
    this.seaDepth = this.env.waterDepth(p.x, p.z, p.y);
    const level = this.env.waterLevel ?? BEACH.waterLevel;
    this.waterDepth = Math.max(0, Math.min(this.seaDepth, level - p.y));
    if (this.swimming) { this._swimStep(dt, input, w, wl, level); return; }
    this.wading = this.waterDepth > BEACH.wadeDepth;
    const canRun = input.run && !this.wading;
    let speed = canRun ? c.runSpeed : c.walkSpeed;
    if (this.wading) speed *= c.wadeSpeedMultiplier + (1 - c.wadeSpeedMultiplier) * clamp(1 - (this.waterDepth - BEACH.wadeDepth) / 0.6, 0, 1) * 0.4;
    // Andar de costas em primeira pessoa é mais lento.
    const facingX = Math.sin(this.yaw), facingZ = Math.cos(this.yaw);
    const back = this.facingMode === 'camera' && wl > 0.1 && (w.x * facingX + w.z * facingZ) < -0.3;
    if (back) speed *= 0.72;
    this.forwardSign = back ? -1 : 1;

    const tx = w.x * speed, tz = w.z * speed;
    let accel;
    if (this.grounded) accel = wl > 0.05 ? c.groundAcceleration : c.groundDeceleration;
    else accel = c.airAcceleration;
    if (this.grounded || wl > 0.05) {
      const dx = tx - v.x, dz = tz - v.z;
      const dl = Math.hypot(dx, dz);
      const maxStep = accel * dt;
      if (dl <= maxStep) { v.x = tx; v.z = tz; }
      else { v.x += (dx / dl) * maxStep; v.z += (dz / dl) * maxStep; }
    }

    // ------------------------------------------------------------- pulo
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.grounded && this.waterDepth >= 0.55 && c.climbReach && this._tryClimb(this.env.waterLevel ?? BEACH.waterLevel)) return;
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && this.waterDepth < 0.55) {
      v.y = c.jumpSpeed * (this.wading ? 0.8 : 1);
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.airTime = 0;
      this.onJump?.();
    }

    // ------------------------------------------------ movimento horizontal
    const ox = p.x, oz = p.z;
    p.x += v.x * dt;
    p.z += v.z * dt;
    const pos2 = this._pos2;
    pos2.x = p.x;
    pos2.z = p.z;
    const bx = pos2.x, bz = pos2.z;
    this.collision.resolveCircle(pos2, p.y, c.radius, c.height, c.stepHeight);
    const cx = pos2.x - bx, cz = pos2.z - bz;
    const cl = Math.hypot(cx, cz);
    if (cl > 1e-6) {
      // Remove a componente da velocidade que empurra contra o obstáculo.
      const nx = cx / cl, nz = cz / cl;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) { v.x -= nx * vn; v.z -= nz * vn; }
    }
    p.x = pos2.x;
    p.z = pos2.z;
    void ox; void oz;

    // Dicas de limite (água profunda / área bloqueada), definidas pelo mapa ativo.
    this.boundaryHint = this.env.boundaryHint ? this.env.boundaryHint(p.x, p.z, c.radius) : null;

    // ---------------------------------------------------------- vertical
    const ground = this.collision.getGroundHeight(p.x, p.z, p.y, c.stepHeight);
    if (this.grounded) {
      if (ground >= p.y - 0.45) {
        p.y = ground;
        v.y = 0;
      } else {
        this.grounded = false;
        this.coyote = c.coyoteTime;
        this.airTime = 0;
        v.y = Math.min(v.y, 0);
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      v.y = Math.max(v.y - c.gravity * dt, -c.maxFallSpeed);
      let ny = p.y + v.y * dt;
      if (v.y > 0) {
        const ceil = this.collision.getCeilingHeight(p.x, p.z, p.y + c.height, c.radius * 0.7);
        if (ny + c.height > ceil) {
          ny = ceil - c.height;
          v.y = 0;
        }
      }
      const g2 = this.collision.getGroundHeight(p.x, p.z, Math.max(p.y, ny), c.stepHeight);
      if (ny <= g2 && v.y <= 0) {
        const impact = -v.y;
        p.y = g2;
        v.y = 0;
        this.grounded = true;
        this.onLand?.(impact, this.airTime);
      } else {
        p.y = ny;
      }
    }

    // Água funda: o pé deixa o fundo (andando praia adentro ou caindo do píer).
    const swimY = level - (c.swimFloat ?? 1.22);
    if (c.swimDepth && this.seaDepth > c.swimDepth && p.y <= swimY + 0.05) {
      p.y = swimY;
      v.y = 0;
      this.grounded = true;
      this._setSwimming(true);
    }

    // Rede de segurança: nunca cair abaixo do mundo.
    if (p.y < -6) {
      this.teleport(this.lastSafe.x, this.lastSafe.y + 0.5, this.lastSafe.z, this.yaw);
      this.grounded = false;
    }
    this._safeTimer -= dt;
    if (this.grounded && this._safeTimer <= 0 && this.waterDepth < 0.3) {
      this.lastSafe.copy(p);
      this._safeTimer = 0.5;
    }

    this._orient(dt, wl, cameraYaw);
  }

  /** Nado: flutua acompanhando as ondas, colide com estacas/cascos, sobe em píeres. */
  _swimStep(dt, input, w, wl, level) {
    const c = this.cfg, p = this.position, v = this.velocity;
    this.swimTime += dt;
    this.wading = true;
    const speed = input.run ? c.swimFastSpeed : c.swimSpeed;
    const tx = w.x * speed, tz = w.z * speed;
    const dx = tx - v.x, dz = tz - v.z, dl = Math.hypot(dx, dz);
    const maxStep = (c.swimAcceleration ?? 5) * dt * (wl > 0.05 ? 1 : 0.6);
    if (dl <= maxStep) { v.x = tx; v.z = tz; } else { v.x += (dx / dl) * maxStep; v.z += (dz / dl) * maxStep; }
    v.y = 0;
    p.x += v.x * dt;
    p.z += v.z * dt;
    const pos2 = this._pos2;
    pos2.x = p.x; pos2.z = p.z;
    const bx = pos2.x, bz = pos2.z;
    this.collision.resolveCircle(pos2, p.y, c.radius, c.height, 0.05);
    const cx = pos2.x - bx, cz = pos2.z - bz, cl = Math.hypot(cx, cz);
    if (cl > 1e-6) { const nx = cx / cl, nz = cz / cl, vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= nx * vn; v.z -= nz * vn; } }
    p.x = pos2.x; p.z = pos2.z;
    this.boundaryHint = this.env.boundaryHint ? this.env.boundaryHint(p.x, p.z, c.radius) : null;
    const surf = this._surface(p.x, p.z);
    const swimY = surf - c.swimFloat;
    p.y += (swimY - p.y) * Math.min(1, dt * 6);
    this.grounded = true;
    this.airTime = 0;
    this.seaDepth = this.env.waterDepth(p.x, p.z, p.y);
    // Pé volta a tocar o fundo: sai do nado andando.
    const ground = this.collision.getGroundHeight(p.x, p.z, level - c.swimFloat, 0.08);
    if (ground >= level - c.swimFloat - 0.06 || this.seaDepth < c.swimDepth - 0.12) {
      p.y = Math.max(ground, p.y);
      this._setSwimming(false);
    } else if (input.jump) {
      this._tryClimb(level);
    }
    this.waterDepth = Math.max(0, level - p.y);
    this._orient(dt, wl, null);
  }

  /** Espaço junto a um píer/convés baixo (nadando ou com água no peito): sobe para fora da água. */
  _tryClimb(level) {
    const c = this.cfg, p = this.position, v = this.velocity;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const r of [0.6, 0.9, 1.2]) {
      const x = p.x + fx * r, z = p.z + fz * r;
      const g = this.collision.getGroundHeight(x, z, level - 0.2, c.climbReach);
      if (g > level - 0.4 && g < level + c.climbReach - 0.2 && g > p.y + 0.5) {
        p.set(x, g, z);
        v.set(0, 0, 0);
        this._setSwimming(false);
        this.grounded = true;
        this.jumpBuffer = 0;
        this.onLand?.(2, 0.3);
        return true;
      }
    }
    return false;
  }

  _orient(dt, wl, cameraYaw) {
    const c = this.cfg, v = this.velocity;
    // -------------------------------------------------------- orientação
    const hs = Math.hypot(v.x, v.z);
    if (this.facingMode === 'camera' && cameraYaw !== null) {
      this.yaw = dampAngle(this.yaw, cameraYaw + Math.PI, 22, dt);
    } else if (hs > 0.25 && (this.grounded || wl > 0.05)) {
      const target = Math.atan2(v.x, v.z);
      const sharp = this.grounded ? c.turnSpeed : c.turnSpeed * 0.35;
      this.yaw = dampAngle(this.yaw, target, sharp, dt);
    }
  }
}
