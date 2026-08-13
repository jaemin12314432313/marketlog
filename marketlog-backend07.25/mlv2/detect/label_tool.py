"""박스 라벨 교정 GUI (Tkinter). 현장 사진의 정답을 만드는 도구.

`prelabel.py` 가 그려 놓은 초안을 **고치는** 데 최적화했다. 새로 그리는 것보다
지우고·옮기고·품목을 바꾸는 조작이 빨라야 한다.

## 설계에서 신경 쓴 것

- **저장을 의식하지 않게 한다.** 이미지를 넘길 때 자동 저장한다. 라벨링은 수백 장을
  반복하는 작업이라, 저장을 잊어 한 장을 날리는 것이 가장 뼈아프다.
- **손이 키보드를 떠나지 않게 한다.** 품목은 숫자키, 이동은 화살표. 마우스는 박스를
  그리고 옮기는 데만 쓴다.
- **외부 의존을 tkinter + PIL 로 제한한다.** labelImg 는 보관(archived) 상태이고
  CVAT 는 서버를 띄워야 한다. 사진 200장 라벨링에 그만한 설치는 과하다.
- **한글 경로·파일명에서 동작한다.** 이 프로젝트 경로에는 한글이 이중으로 들어 있다.
  PIL 은 파이썬이 경로를 다루므로 cv2 와 달리 문제가 없다(cv2 는 compat.imread 필요).

## 조작

    마우스 드래그(빈 곳)   새 박스
    클릭                   박스 선택 / 모서리 드래그로 크기 조절
    Delete, Backspace      선택 박스 삭제
    0~9                    선택 박스의 품목 지정 (없으면 마지막 박스)
    T                      이 사진의 **모든** 박스를 현재 품목으로 (일괄 변경)
    ← → (또는 A D)         이전/다음 사진 (자동 저장)
    Ctrl+S                 즉시 저장
    F                      이 사진을 '검수 완료'로 표시
    H                      도움말
    Q, Esc                 종료 (저장하고)

## 사용

    python -m mlv2.detect.label_tool --dir data/real_detect
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from mlv2.compat import setup_stdout
from mlv2.items import ITEM_CLASSES, IMAGE_EXTS

setup_stdout()

# 품목별 색. 10종이라 눈으로 구분되는 색을 직접 고른다(자동 생성하면 비슷한 색이 붙는다).
COLORS = [
    "#ff6b6b", "#ffa94d", "#ffd43b", "#a9e34b", "#51cf66",
    "#38d9a9", "#4dabf7", "#748ffc", "#da77f2", "#f783ac",
]
HANDLE = 7          # 모서리 핸들 히트박스 반경(px)
MIN_BOX = 6         # 이보다 작으면 실수로 찍은 것으로 보고 버린다


class Labeler(object):
    def __init__(self, root, work_dir, classes):
        import tkinter as tk

        self.tk = tk
        self.root = root
        self.dir = Path(work_dir)
        self.classes = classes
        self.img_dir = self.dir / "images"
        self.lab_dir = self.dir / "labels"
        self.lab_dir.mkdir(parents=True, exist_ok=True)
        self.done_file = self.dir / "reviewed.txt"

        self.files = [p for p in sorted(self.img_dir.rglob("*"))
                      if p.suffix.lower() in IMAGE_EXTS]
        if not self.files:
            raise SystemExit("이미지가 없다: {}".format(self.img_dir))
        self.reviewed = set()
        if self.done_file.is_file():
            self.reviewed = set(self.done_file.read_text(
                encoding="utf-8").split("\n")) - {""}

        self.idx = 0
        self.boxes = []          # [[cls, x0, y0, x1, y1]] — 원본 이미지 좌표
        self.sel = None
        self.drag = None         # ("new"|"move"|"resize", ...)
        self.cur_cls = 0
        self.photo = None
        self.scale = 1.0
        self.off = (0, 0)

        self._build()
        self._load(0)

    # ---------- UI ----------
    def _build(self):
        tk = self.tk
        self.root.title("mlv2 라벨 교정")
        self.root.geometry("1280x860")

        bar = tk.Frame(self.root, bg="#1e222b")
        bar.pack(side="top", fill="x")
        self.status = tk.Label(bar, text="", bg="#1e222b", fg="#e6e8ee",
                               anchor="w", font=("Malgun Gothic", 10))
        self.status.pack(side="left", padx=10, pady=6)
        self.clslabel = tk.Label(bar, text="", bg="#1e222b", fg="#6ee7a8",
                                 font=("Malgun Gothic", 10, "bold"))
        self.clslabel.pack(side="right", padx=10)

        self.canvas = tk.Canvas(self.root, bg="#0f1115", highlightthickness=0)
        self.canvas.pack(side="top", fill="both", expand=True)

        hint = ("드래그=새 박스  클릭=선택  Del=삭제  0~9=품목  T=전체품목변경  "
                "←/→=이전·다음(자동저장)  F=검수완료  H=도움말  Q=종료")
        tk.Label(self.root, text=hint, bg="#171a21", fg="#9aa3b2",
                 font=("Malgun Gothic", 9)).pack(side="bottom", fill="x")

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_move)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.canvas.bind("<Configure>", lambda e: self._redraw())

        r = self.root
        r.bind("<Key>", self.on_key)
        r.bind("<Left>", lambda e: self._go(-1))
        r.bind("<Right>", lambda e: self._go(1))
        r.bind("<Delete>", lambda e: self._delete())
        r.bind("<BackSpace>", lambda e: self._delete())
        r.bind("<Control-s>", lambda e: self._save())
        r.focus_set()

    # ---------- 좌표 변환 ----------
    def _to_canvas(self, x, y):
        return x * self.scale + self.off[0], y * self.scale + self.off[1]

    def _to_image(self, x, y):
        return ((x - self.off[0]) / self.scale, (y - self.off[1]) / self.scale)

    # ---------- 입출력 ----------
    def _label_path(self, i=None):
        p = self.files[self.idx if i is None else i]
        return self.lab_dir / (p.stem + ".txt")

    def _load(self, i):
        from PIL import Image

        self.idx = max(0, min(i, len(self.files) - 1))
        path = self.files[self.idx]
        self.pil = Image.open(str(path)).convert("RGB")
        self.iw, self.ih = self.pil.size

        self.boxes = []
        lp = self._label_path()
        if lp.is_file():
            for line in lp.read_text(encoding="utf-8").splitlines():
                f = line.split()
                if len(f) < 5:
                    continue
                c = int(float(f[0]))
                cx, cy, w, h = (float(v) for v in f[1:5])
                self.boxes.append([c,
                                   (cx - w / 2) * self.iw, (cy - h / 2) * self.ih,
                                   (cx + w / 2) * self.iw, (cy + h / 2) * self.ih])
        # 이 사진에서 가장 많은 품목을 '현재 품목'으로 둔다. 한 사진에 한 품목만 찍힌
        # 경우가 대부분이라, 새로 그리는 박스에 매번 숫자키를 누를 필요가 없어진다.
        if self.boxes:
            counts = {}
            for b in self.boxes:
                counts[b[0]] = counts.get(b[0], 0) + 1
            self.cur_cls = max(counts, key=lambda k: counts[k])

        self.sel = None
        self._redraw()

    def _save(self):
        lines = []
        for c, x0, y0, x1, y1 in self.boxes:
            x0, x1 = sorted((max(0, x0), min(self.iw, x1)))
            y0, y1 = sorted((max(0, y0), min(self.ih, y1)))
            w, h = (x1 - x0) / self.iw, (y1 - y0) / self.ih
            if w <= 0 or h <= 0:
                continue
            lines.append("{} {:.6f} {:.6f} {:.6f} {:.6f}".format(
                c, (x0 + x1) / 2 / self.iw, (y0 + y1) / 2 / self.ih, w, h))
        self._label_path().write_text("\n".join(lines), encoding="utf-8")
        self.done_file.write_text("\n".join(sorted(self.reviewed)),
                                  encoding="utf-8")

    def _go(self, d):
        self._save()
        self._load(self.idx + d)

    # ---------- 그리기 ----------
    def _redraw(self):
        from PIL import Image, ImageTk

        cw, ch = self.canvas.winfo_width(), self.canvas.winfo_height()
        # 창이 아직 배치되기 전에는 캔버스가 1x1 이다. 그 크기로 리사이즈하면
        # 폭·높이가 0 이 되어 PIL 이 ValueError 를 던진다(__init__ 에서 실제로 터졌다).
        # 여기서는 그리지 않고, 창이 잡힌 뒤 다시 부른다. <Configure> 도 오지만
        # 첫 호출을 놓치면 빈 화면이 남으므로 스스로도 재시도한다.
        if cw < 50 or ch < 50:
            self.root.after(50, self._redraw)
            return
        self.scale = min(cw / float(self.iw), ch / float(self.ih))
        nw = max(1, int(self.iw * self.scale))
        nh = max(1, int(self.ih * self.scale))
        self.off = ((cw - nw) // 2, (ch - nh) // 2)

        self.canvas.delete("all")
        self.photo = ImageTk.PhotoImage(
            self.pil.resize((nw, nh), Image.LANCZOS))
        self.canvas.create_image(self.off[0], self.off[1], anchor="nw",
                                 image=self.photo)

        for i, (c, x0, y0, x1, y1) in enumerate(self.boxes):
            a = self._to_canvas(x0, y0)
            b = self._to_canvas(x1, y1)
            col = COLORS[c % len(COLORS)]
            sel = (i == self.sel)
            self.canvas.create_rectangle(a[0], a[1], b[0], b[1],
                                         outline=col, width=3 if sel else 2)
            name = self.classes[c] if c < len(self.classes) else str(c)
            self.canvas.create_rectangle(a[0], a[1] - 18, a[0] + 9 * len(name) + 12,
                                         a[1], fill=col, outline=col)
            self.canvas.create_text(a[0] + 5, a[1] - 9, anchor="w", text=name,
                                    fill="#0b0d12", font=("Malgun Gothic", 9, "bold"))
            if sel:
                for hx, hy in ((a[0], a[1]), (b[0], a[1]), (a[0], b[1]), (b[0], b[1])):
                    self.canvas.create_rectangle(hx - 4, hy - 4, hx + 4, hy + 4,
                                                 fill="#ffffff", outline=col)
        self._status()

    def _status(self):
        name = self.files[self.idx].name
        mark = " ✔검수완료" if name in self.reviewed else ""
        self.status.config(text="[{}/{}] {}  박스 {}개{}".format(
            self.idx + 1, len(self.files), name, len(self.boxes), mark))
        cls = self.classes[self.cur_cls] if self.cur_cls < len(self.classes) else "?"
        self.clslabel.config(text="현재 품목: {} ({})  |  검수 {}/{}".format(
            cls, self.cur_cls, len(self.reviewed), len(self.files)))

    # ---------- 마우스 ----------
    def _hit(self, x, y):
        """(박스 인덱스, 모서리) — 모서리가 None 이면 내부 클릭."""
        for i in range(len(self.boxes) - 1, -1, -1):
            c, x0, y0, x1, y1 = self.boxes[i]
            a, b = self._to_canvas(x0, y0), self._to_canvas(x1, y1)
            for ci, (hx, hy) in enumerate(((a[0], a[1]), (b[0], a[1]),
                                           (a[0], b[1]), (b[0], b[1]))):
                if abs(x - hx) <= HANDLE and abs(y - hy) <= HANDLE:
                    return i, ci
            if min(a[0], b[0]) <= x <= max(a[0], b[0]) and \
               min(a[1], b[1]) <= y <= max(a[1], b[1]):
                return i, None
        return None, None

    def on_press(self, e):
        i, corner = self._hit(e.x, e.y)
        if i is None:
            ix, iy = self._to_image(e.x, e.y)
            self.boxes.append([self.cur_cls, ix, iy, ix, iy])
            self.sel = len(self.boxes) - 1
            self.drag = ("new",)
        elif corner is None:
            self.sel = i
            # 선택한 박스의 품목을 '현재 품목'으로 따라가게 한다. 이게 없으면 상단 표시와
            # 실제 박스가 어긋나 보여서, 다음에 그릴 박스에 엉뚱한 품목이 붙는다.
            self.cur_cls = self.boxes[i][0]
            ix, iy = self._to_image(e.x, e.y)
            self.drag = ("move", ix, iy, list(self.boxes[i]))
        else:
            self.sel = i
            self.cur_cls = self.boxes[i][0]
            self.drag = ("resize", corner)
        self._redraw()

    def on_move(self, e):
        if not self.drag or self.sel is None:
            return
        ix, iy = self._to_image(e.x, e.y)
        b = self.boxes[self.sel]
        if self.drag[0] == "new":
            b[3], b[4] = ix, iy
        elif self.drag[0] == "move":
            _, sx, sy, orig = self.drag
            dx, dy = ix - sx, iy - sy
            b[1], b[2] = orig[1] + dx, orig[2] + dy
            b[3], b[4] = orig[3] + dx, orig[4] + dy
        else:
            corner = self.drag[1]
            if corner in (0, 2):
                b[1] = ix
            else:
                b[3] = ix
            if corner in (0, 1):
                b[2] = iy
            else:
                b[4] = iy
        self._redraw()

    def on_release(self, e):
        if self.drag and self.sel is not None:
            b = self.boxes[self.sel]
            b[1], b[3] = sorted((b[1], b[3]))
            b[2], b[4] = sorted((b[2], b[4]))
            # 클릭 실수로 생긴 점 크기 박스는 버린다
            if (b[3] - b[1]) * self.scale < MIN_BOX or \
               (b[4] - b[2]) * self.scale < MIN_BOX:
                del self.boxes[self.sel]
                self.sel = None
        self.drag = None
        self._redraw()

    # ---------- 키보드 ----------
    def _delete(self):
        if self.sel is not None and 0 <= self.sel < len(self.boxes):
            del self.boxes[self.sel]
            self.sel = None
            self._redraw()

    def on_key(self, e):
        k = e.keysym.lower()
        if k in ("q", "escape"):
            self._save()
            self.root.destroy()
        elif k in ("d",):
            self._go(1)
        elif k in ("a",):
            self._go(-1)
        elif k == "f":
            name = self.files[self.idx].name
            if name in self.reviewed:
                self.reviewed.discard(name)
            else:
                self.reviewed.add(name)
            self._save()
            self._status()
        elif k == "t":
            # 이 사진의 박스를 전부 현재 품목으로. 파일명 자동 유추가 틀린 사진에서
            # 박스를 하나씩 고치는 것은 너무 느리다 — test_image 의 `cabbage.png` 가
            # 실제로는 배추라서 6개를 전부 바꿔야 했다.
            for b in self.boxes:
                b[0] = self.cur_cls
            self._redraw()
        elif k == "h":
            self._help()
        elif len(k) == 1 and k.isdigit():
            c = int(k)
            if c < len(self.classes):
                self.cur_cls = c
                tgt = self.sel if self.sel is not None else (
                    len(self.boxes) - 1 if self.boxes else None)
                if tgt is not None:
                    self.boxes[tgt][0] = c
                self._redraw()

    def _help(self):
        from tkinter import messagebox

        lines = ["품목 숫자키:"]
        for i, c in enumerate(self.classes):
            lines.append("  {} = {}".format(i, c))
        lines += ["", "드래그(빈 곳) = 새 박스", "클릭 = 선택, 모서리 드래그 = 크기 조절",
                  "T = 이 사진의 모든 박스를 현재 품목으로",
                  "Delete / BackSpace = 삭제", "← → (A/D) = 이전·다음 (자동 저장)",
                  "Ctrl+S = 즉시 저장", "F = 검수 완료 표시", "Q / Esc = 종료"]
        messagebox.showinfo("도움말", "\n".join(lines))


def main(argv=None):
    p = argparse.ArgumentParser(description="박스 라벨 교정 GUI")
    p.add_argument("--dir", default="data/real_detect",
                   help="prelabel.py 가 만든 폴더 (images/ labels/ classes.txt)")
    a = p.parse_args(argv)

    work = Path(a.dir)
    cf = work / "classes.txt"
    classes = (cf.read_text(encoding="utf-8").split()
               if cf.is_file() else list(ITEM_CLASSES))

    try:
        import tkinter as tk
    except ImportError:
        raise SystemExit("tkinter 가 없다. python 을 tk 포함으로 설치할 것.")

    root = tk.Tk()
    app = Labeler(root, work, classes)
    root.mainloop()
    print("검수 완료 {}/{}장 — {}".format(
        len(app.reviewed), len(app.files), work / "reviewed.txt"))


if __name__ == "__main__":
    main()
