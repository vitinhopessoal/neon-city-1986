export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const approach = (x, target, maximumDelta) => x + clamp(target - x, -maximumDelta, maximumDelta);
export const smooth = (x, target, responsePerSecond, dt) => x + (target - x) * (1 - Math.exp(-responsePerSecond * dt));
export const RPM_PER_RAD_S = 60 / (2 * Math.PI);
export const GRAVITY_MPS2 = 9.80665;

export function curve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [xb, yb] = points[i];
    if (x <= xb) {
      const [xa, ya] = points[i - 1];
      return ya + (yb - ya) * (x - xa) / (xb - xa);
    }
  }
  return points.at(-1)[1];
}

// Combined longitudinal/lateral budget. A general friction-circle approximation;
// the original wheel routine has a proportional combined cap, not recovered coefficients here.
export function frictionCircle(longitudinalN, lateralN, maximumN) {
  const magnitude = Math.hypot(longitudinalN, lateralN);
  const scale = magnitude > 0 ? Math.min(1, Math.max(0, maximumN) / magnitude) : 1;
  return {longitudinalN: longitudinalN * scale, lateralN: lateralN * scale, saturation: scale};
}

export function ackermann(angleRad, wheelbaseM, trackM) {
  if (Math.abs(angleRad) < 1e-8) return {frontLeftRad: 0, frontRightRad: 0};
  const sign = Math.sign(angleRad);
  const radius = wheelbaseM / Math.tan(Math.abs(angleRad));
  const inner = Math.atan2(wheelbaseM, Math.max(0.001, radius - trackM / 2));
  const outer = Math.atan2(wheelbaseM, radius + trackM / 2);
  return sign > 0 ? {frontLeftRad: inner, frontRightRad: outer}
    : {frontLeftRad: -outer, frontRightRad: -inner};
}

export function suspensionForce(compressionM, compressionVelocityMps, grounded, profile) {
  if (!grounded) return 0;
  return clamp(profile.springNPerM * Math.max(0, compressionM)
    + profile.damperNsPerM * compressionVelocityMps, 0, profile.maximumForceN);
}
