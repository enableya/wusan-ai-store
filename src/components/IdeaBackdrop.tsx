import { useEffect, useRef } from 'react';

export function IdeaBackdrop() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const scene = element.parentElement;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let frame = 0;
    let offset = 0;

    function draw() {
      if (!ctx) return;
      const dark = document.documentElement.dataset.theme === 'dark';
      const mobile = width <= 680;
      const scale = Math.min(width / 1440, 1.4, (height - 48) / 368) * 0.9;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width * (mobile ? 0.85 : 0.79) + offset, height * 0.49);
      ctx.scale(mobile ? 0.68 : scale, mobile ? 0.68 : scale);
      if (!mobile) ctx.rotate(-Math.PI / 45);

      const ink = dark ? '#b4d0bb' : '#285742';
      const line = dark ? '#425749' : '#d9e3d2';
      const fill = dark ? '#293d2e' : '#e9f0e1';
      const muted = dark ? '#91a68e' : '#879b7d';
      if (!mobile) {
        ctx.save();
        ctx.fillStyle = dark ? '#1c2820' : '#ffffff';
        ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(40, 87, 66, 0.1)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        ctx.beginPath();
        ctx.roundRect(-240, -172, 480, 368, 8);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.clip();
      }
      ctx.strokeStyle = dark ? '#7b8056' : '#b2a56d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-247, 112);
      ctx.bezierCurveTo(-205, 169, 131, 154, 231, -97);
      ctx.bezierCurveTo(253, -148, 179, -174, 136, -157);
      ctx.stroke();
      ctx.strokeStyle = dark ? '#3d4d3e' : '#dde5d5';
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.moveTo(-216, 134);
      ctx.bezierCurveTo(-125, 188, 199, 98, 242, -47);
      ctx.stroke();
      ctx.setLineDash([]);
      if (mobile) {
        ctx.restore();
        return;
      }

      const assistantMark = (x: number, y: number) => {
        if (!ctx) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(0.1, 0.1);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 13;
        ctx.lineJoin = 'round';
        for (let petal = 0; petal < 6; petal += 1) {
          ctx.save();
          ctx.rotate(petal * Math.PI / 3);
          ctx.beginPath();
          ctx.moveTo(7, -35);
          ctx.lineTo(52, -61);
          ctx.bezierCurveTo(86, -81, 121, -52, 112, -17);
          ctx.bezierCurveTo(108, -2, 96, 9, 83, 17);
          ctx.lineTo(55, 33);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      };
      assistantMark(-192, -132);
      ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      ctx.font = '600 18px "Segoe UI", sans-serif';
      ctx.fillText('ChatGPT', -170, -126);
      ctx.fillStyle = muted;
      ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('对话示意', 205, -129);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-208, -107);
      ctx.lineTo(207, -107);
      ctx.stroke();

      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(-43, -81, 250, 45, 8);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      ctx.font = '14px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('把好奇，变成新的可能。', -25, -53);

      assistantMark(-192, 2);
      ctx.fillStyle = ink;
      ctx.font = '15px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('从一个好问题开始。', -168, 7);
      ctx.fillStyle = line;
      for (const [y, length] of [[25, 318], [42, 240]]) {
        ctx.beginPath();
        ctx.roundRect(-168, y, length, 5, 2.5);
        ctx.fill();
      }
      ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      for (const [index, label] of ['探索', '表达', '创造'].entries()) {
        const x = -168 + index * 58;
        if (index > 0) {
          ctx.strokeStyle = line;
          ctx.beginPath();
          ctx.moveTo(x - 6, 67);
          ctx.lineTo(x - 6, 79);
          ctx.stroke();
        }
        ctx.fillStyle = muted;
        ctx.fillText(label, x, 78);
      }

      ctx.fillStyle = dark ? '#24332a' : '#f8f9f5';
      ctx.strokeStyle = line;
      ctx.beginPath();
      ctx.roundRect(-208, 109, 415, 48, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText('你的下一个想法…', -191, 138);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.roundRect(165, 117, 32, 32, 6);
      ctx.fill();
      ctx.strokeStyle = dark ? '#152019' : '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(181, 140);
      ctx.lineTo(181, 126);
      ctx.moveTo(175, 132);
      ctx.lineTo(181, 126);
      ctx.lineTo(187, 132);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('给灵感，多一点空间。', 205, 180);
      ctx.strokeStyle = dark ? '#a5bb8c' : '#819b6f';
      ctx.lineWidth = 1.6;
      for (let spoke = 0; spoke < 8; spoke += 1) {
        const angle = spoke * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(126 + Math.cos(angle) * 4, -149 + Math.sin(angle) * 4);
        ctx.lineTo(126 + Math.cos(angle) * 14, -149 + Math.sin(angle) * 14);
        ctx.stroke();
      }
      ctx.restore();
    }

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      const rect = element.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    };
    const move = (event: PointerEvent) => {
      if (motion.matches) return;
      const rect = element.getBoundingClientRect();
      offset = ((event.clientX - rect.left) / width - 0.5) * 14;
      schedule();
    };
    const reset = () => { offset = 0; schedule(); };
    const sizeObserver = new ResizeObserver(resize);
    const themeObserver = new MutationObserver(schedule);
    sizeObserver.observe(element);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    scene?.addEventListener('pointermove', move);
    scene?.addEventListener('pointerleave', reset);
    motion.addEventListener('change', reset);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      themeObserver.disconnect();
      scene?.removeEventListener('pointermove', move);
      scene?.removeEventListener('pointerleave', reset);
      motion.removeEventListener('change', reset);
    };
  }, []);

  return <canvas ref={canvas} className="idea-backdrop" aria-hidden="true" />;
}
