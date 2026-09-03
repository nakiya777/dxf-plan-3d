import type { GridAxis, PlanEntity } from '../model/types';
import { CFG } from './config';

/**
 * 通り芯（設計書 §7.2 手順 7）。
 * 円（半径 150–400）の内側にラベル文字（`X1` `A` など）の挿入点があり、円周に線分の端点が乗っているもの。
 * 同じラベルの円は両端に 2 つあるので、ラベルごとに 1 本にまとめる（最初に見つかった円と線を採る）
 */
export function detectAxes(entities: PlanEntity[]): GridAxis[] {
  const { minR, maxR, label: labelRe, lineTouchTol } = CFG.axis;
  const circles = entities.filter(
    (e): e is Extract<PlanEntity, { kind: 'circle' }> => e.kind === 'circle' && e.radius >= minR && e.radius <= maxR,
  );
  const texts = entities.filter(
    (e): e is Extract<PlanEntity, { kind: 'text' }> => e.kind === 'text' && labelRe.test(e.text.trim()),
  );
  const lines = entities.filter((e): e is Extract<PlanEntity, { kind: 'line' }> => e.kind === 'line');
  const byLabel = new Map<string, GridAxis>();
  for (const c of circles) {
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - c.center.x, p.y - c.center.y);
    const text = texts.find((t) => dist(t.at) <= c.radius);
    if (!text) continue;
    const touching = lines.find((l) => [l.a, l.b].some((p) => Math.abs(dist(p) - c.radius) <= lineTouchTol));
    if (!touching) continue;
    const label = text.text.trim();
    if (!byLabel.has(label)) byLabel.set(label, { label, a: touching.a, b: touching.b, bubble: c.center });
  }
  return [...byLabel.values()];
}
