# -*- coding: utf-8 -*-
"""設計書 §7.2 の壁認識ヒューリスティクスを、サンプル DXF で否定実験する使い捨てプロトタイプ。
   ルール: 同一レイヤー・平行・距離 60–250 mm・重なり 300 mm 以上の線分対を壁候補とし、
   周期的に並ぶ線（タイル・ハッチ）と、帯の中央に線を持つもの（窓記号）を除外する"""
import sys, math, collections, ezdxf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

doc = ezdxf.readfile(sys.argv[1], encoding="cp932")
msp = doc.modelspace()
x0, y0, x1, y1 = [float(v) for v in sys.argv[3:7]]
out = sys.argv[2]

# 線分を (layer, 向き, 位置, 区間) に正規化。軸平行のみ（このサンプルは直交図面）
segs = []
for e in msp.query("LINE"):
    a, b = e.dxf.start, e.dxf.end
    if not (x0 <= a.x <= x1 and y0 <= a.y <= y1 and x0 <= b.x <= x1 and y0 <= b.y <= y1): continue
    if abs(a.y - b.y) < 0.5 and abs(a.x - b.x) >= 1:      # 水平
        segs.append((e.dxf.layer, "h", a.y, min(a.x, b.x), max(a.x, b.x)))
    elif abs(a.x - b.x) < 0.5 and abs(a.y - b.y) >= 1:    # 鉛直
        segs.append((e.dxf.layer, "v", a.x, min(a.y, b.y), max(a.y, b.y)))

def overlap(s, t): return min(s[4], t[4]) - max(s[3], t[3])

by_key = collections.defaultdict(list)
for s in segs: by_key[(s[0], s[1])].append(s)

accepted, rejected_periodic, window_like = [], [], []
for key, group in by_key.items():
    group.sort(key=lambda s: s[2])
    for i, s in enumerate(group):
        for t in group[i + 1:]:
            d = t[2] - s[2]
            if d > 250: break
            if d < 60 or overlap(s, t) < 300: continue
            # 周期性: 帯の外側に同じ間隔で同じレイヤーの平行線があれば、タイル・ハッチと見なす
            periodic = any(abs((u[2] - t[2]) - d) <= d * 0.15 and overlap(t, u) >= 300 for u in group if u is not t and u[2] > t[2]) \
                    or any(abs((s[2] - u[2]) - d) <= d * 0.15 and overlap(s, u) >= 300 for u in group if u is not s and u[2] < s[2])
            # 窓記号: 帯の中央付近に、帯とほぼ同じ長さの平行線がある
            center = any(abs(u[2] - (s[2] + t[2]) / 2) <= d * 0.25 and overlap(s, u) >= 0.8 * (min(s[4], t[4]) - max(s[3], t[3])) for u in group if u is not s and u is not t)
            band = (key[0], key[1], s[2], t[2], max(s[3], t[3]), min(s[4], t[4]))
            if periodic: rejected_periodic.append(band)
            elif center: window_like.append(band)
            else: accepted.append(band)

def summarize(name, bands):
    tot = collections.Counter(); n = collections.Counter()
    for b in bands: tot[b[0]] += b[5] - b[4]; n[b[0]] += 1
    print(f"--- {name}: {len(bands)} bands")
    for lay, L in tot.most_common(): print(f"   {lay:10} n={n[lay]:4d} total_len={L:8.0f} mm")
summarize("accepted (wall candidates)", accepted)
summarize("rejected as periodic (tile/hatch)", rejected_periodic)
summarize("window-like (center line)", window_like)
print("thickness histogram of accepted:", collections.Counter(round(b[3] - b[2]) for b in accepted).most_common(8))

# 描画: 元図を薄灰、壁候補を黒帯、窓記号を青帯、周期除外を赤帯
fig = plt.figure(figsize=(24, 24 * (y1 - y0) / (x1 - x0)), dpi=100)
ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(x0, x1); ax.set_ylim(y0, y1); ax.set_aspect("equal"); ax.axis("off")
for e in msp.query("LINE"):
    a, b = e.dxf.start, e.dxf.end
    if x0 <= a.x <= x1 and y0 <= a.y <= y1: ax.plot([a.x, b.x], [a.y, b.y], color="#bbbbbb", lw=0.5)
def draw(bands, color, alpha):
    for lay, o, p, q, lo, hi in bands:
        if o == "h": ax.fill([lo, hi, hi, lo], [p, p, q, q], color=color, alpha=alpha, lw=0)
        else:        ax.fill([p, q, q, p], [lo, lo, hi, hi], color=color, alpha=alpha, lw=0)
draw(rejected_periodic, "#e53935", 0.25); draw(window_like, "#1e88e5", 0.5); draw(accepted, "#000000", 0.6)
fig.savefig(out, facecolor="white"); print("rendered", out)
