# -*- coding: utf-8 -*-
"""内部识别本地服务：直接复用电脑版 plan_reader.trace_interior 的算法。
平板通过 adb reverse 访问 http://127.0.0.1:8081/interior 。
"""
import base64, json, sys, os
sys.path.insert(0, r"D:\zuodianship\.pylibs")
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
import cv2


def interior_lines(img_bgr, crop, outer):
    H, W = img_bgr.shape[:2]
    if crop:
        x0, y0, x1, y1 = [int(v) for v in crop]
    else:
        x0, y0, x1, y1 = 0, 0, W, H
    x0 = max(0, min(W - 1, x0)); x1 = max(x0 + 1, min(W, x1))
    y0 = max(0, min(H - 1, y0)); y1 = max(y0 + 1, min(H, y1))
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    red1 = cv2.inRange(hsv, (0, 40, 80), (15, 255, 255))
    red2 = cv2.inRange(hsv, (165, 40, 80), (180, 255, 255))
    red = cv2.dilate(cv2.bitwise_or(red1, red2), np.ones((5, 5), np.uint8), iterations=2)
    sub = (gray[y0:y1, x0:x1] < 190).astype(np.uint8) * 255
    sub[red[y0:y1, x0:x1] > 0] = 0
    sh, sw = sub.shape

    xs = [p for s in outer for p in (s["a"][0], s["b"][0])]
    ys = [p for s in outer for p in (s["a"][1], s["b"][1])]
    if not xs:
        return []
    bx0 = max(0, int(min(xs)) - x0 + 8)
    bx1 = min(sw, int(max(xs)) - x0 - 8)
    by0 = max(0, int(min(ys)) - y0 + 8)
    by1 = min(sh, int(max(ys)) - y0 - 8)

    khc = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1))
    kvc = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 25))
    horc = cv2.morphologyEx(sub, cv2.MORPH_CLOSE, khc)
    verc = cv2.morphologyEx(sub, cv2.MORPH_CLOSE, kvc)
    hord = cv2.morphologyEx(horc, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (10, 1)))
    verd = cv2.morphologyEx(verc, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 10)))

    cands = []
    for mask, horizontal in ((hord, True), (verd, False)):
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for c in cnts:
            x, y, ww, hh = cv2.boundingRect(c)
            if horizontal:
                if ww < 50:
                    continue
                my = y + hh / 2
                mx_c = x + ww / 2
                if not (bx0 <= mx_c <= bx1 and by0 <= my <= by1):
                    continue
                cands.append(("H", x, x + ww, my))
            else:
                if hh < 50:
                    continue
                mx = x + ww / 2
                my_c = y + hh / 2
                if not (by0 <= my_c <= by1 and bx0 <= mx <= bx1):
                    continue
                cands.append(("V", y, y + hh, mx))

    def far_from_outer(seg):
        typ, a0, a1, c = seg
        if typ == "H":
            pts = [((a0 + a1) / 2 + x0, c + y0)]
        else:
            pts = [(c + x0, (a0 + a1) / 2 + y0)]
        for s in outer:
            ax, ay = s["a"]; bx, by = s["b"]
            hh = abs(ay - by) < 3
            for px, py in pts:
                if hh:
                    if abs(py - ay) <= 6 and min(ax, bx) - 6 <= px <= max(ax, bx) + 6:
                        return False
                else:
                    if abs(px - ax) <= 6 and min(ay, by) - 6 <= py <= max(ay, by) + 6:
                        return False
        return True

    cands = [c for c in cands if far_from_outer(c)]

    minx_o, maxx_o = min(xs), max(xs)
    miny_o, maxy_o = min(ys), max(ys)

    def to_img(seg):
        typ, a0, a1, c = seg
        if typ == "H":
            xa = min(max(a0 + x0, minx_o), maxx_o)
            xb = min(max(a1 + x0, minx_o), maxx_o)
            yy = c + y0
            return {"a": [float(xa), float(yy)], "b": [float(xb), float(yy)]}
        ya = min(max(a0 + y0, miny_o), maxy_o)
        yb = min(max(a1 + y0, miny_o), maxy_o)
        xx = c + x0
        return {"a": [float(xx), float(ya)], "b": [float(xx), float(yb)]}

    inner = [to_img(c) for c in cands]

    def connected(pt, segs, tol=14):
        px, py = pt
        for s in segs:
            ax, ay = s["a"]; bx, by = s["b"]
            if abs(ay - by) < 3:
                if abs(py - ay) <= tol and min(ax, bx) - tol <= px <= max(ax, bx) + tol:
                    return True
            else:
                if abs(px - ax) <= tol and min(ay, by) - tol <= py <= max(ay, by) + tol:
                    return True
        return False

    kept = []
    for s in inner:
        L = ((s["b"][0] - s["a"][0]) ** 2 + (s["b"][1] - s["a"][1]) ** 2) ** 0.5
        others = [x for x in outer + inner if x is not s]
        if (connected(s["a"], others) and connected(s["b"], others)) or L >= 250:
            kept.append(s)
    return kept


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n).decode("utf-8"))
            img = req["image"]
            if "," in img:
                img = img.split(",", 1)[1]
            raw = base64.b64decode(img)
            arr = np.frombuffer(raw, np.uint8)
            bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            crop = req.get("crop")
            outer = req.get("outer") or []
            segs = interior_lines(bgr, crop, outer)
            out = json.dumps({"segments": segs}).encode("utf-8")
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        except Exception as e:
            out = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8081), Handler).serve_forever()
