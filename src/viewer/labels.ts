import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type Label = CSS2DObject & { setText: (text: string) => void };

/** 黒地・白文字の角丸ピル（設計書 §2.3）。ハンドルの直上に出す。空文字を渡すと隠れる */
export function makeLabel(): Label {
  const div = document.createElement('div');
  div.className = 'label';
  div.style.cssText = 'background:#222;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:3px 8px;border-radius:5px;white-space:nowrap;transform:translateY(-22px)';
  const obj = new CSS2DObject(div) as Label;
  obj.setText = (text) => { div.textContent = text; obj.visible = text !== ''; };
  obj.visible = false;
  return obj;
}
