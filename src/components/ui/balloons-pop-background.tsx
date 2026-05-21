import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type ColorSet = {
  base: string;
  light: string;
  dark: string;
};

export function BalloonsPopBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx = maybeCtx;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let balloons: Balloon[] = [];
    let particles: Particle[] = [];
    let animationFrame = 0;
    const mouse = { x: -2000, y: -2000 };
    const balloonCount = prefersReducedMotion ? 10 : 26;

    const colors: ColorSet[] = [
      { base: "#ff4f9a", light: "#ff9bc8", dark: "#b8145c" },
      { base: "#00b8ff", light: "#8be4ff", dark: "#006a92" },
      { base: "#ffd43b", light: "#fff1a3", dark: "#b8860b" },
      { base: "#a855f7", light: "#d8b4fe", dark: "#6b21a8" },
      { base: "#32d583", light: "#a6f7c1", dark: "#087443" },
      { base: "#ff8a3d", light: "#ffc08a", dark: "#b84c10" },
    ];

    class Particle {
      x: number;
      y: number;
      size: number;
      speedX: number;
      speedY: number;
      gravity = 0.18;
      opacity = 1;
      color: string;

      constructor(x: number, y: number, color: string) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = Math.random() * 3 + 1;
        this.speedX = (Math.random() - 0.5) * 10;
        this.speedY = (Math.random() - 0.5) * 10;
      }

      update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.speedY += this.gravity;
        this.opacity -= 0.025;
      }

      draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.opacity);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    class Balloon {
      x = 0;
      y = 0;
      r = 0;
      speed = 0;
      angle = 0;
      wobbleSpeed = 0;
      popped = false;
      colorSet = colors[0];
      tailMidY = 0;
      tailEndY = 0;
      tailVelMid = 0;
      tailVelEnd = 0;
      prevX = 0;

      constructor(first = true) {
        this.init(first);
      }

      init(firstLoad: boolean) {
        this.r = Math.random() * 14 + 26;
        this.x = Math.random() * window.innerWidth;
        this.y = firstLoad
          ? Math.random() * window.innerHeight
          : window.innerHeight + this.r + 160;
        this.colorSet = colors[Math.floor(Math.random() * colors.length)];
        this.speed = Math.random() * 0.75 + 0.28;
        this.wobbleSpeed = Math.random() * 0.02 + 0.01;
        this.angle = Math.random() * Math.PI * 2;
        this.popped = false;
        this.prevX = this.x;
        this.tailMidY = this.r + 34;
        this.tailEndY = this.r + 98;
        this.tailVelMid = 0;
        this.tailVelEnd = 0;
      }

      drawBalloonPath(r: number) {
        ctx.beginPath();
        ctx.moveTo(0, r);
        ctx.bezierCurveTo(-r * 1.2, r * 0.8, -r * 1.3, -r * 1.2, 0, -r * 1.2);
        ctx.bezierCurveTo(r * 1.3, -r * 1.2, r * 1.2, r * 0.8, 0, r);
        ctx.closePath();
      }

      drawString() {
        const dx = this.x - this.prevX;
        this.prevX = this.x;
        const stiffness = 0.08;
        const damping = 0.85;
        const gravity = 0.3;
        const midTarget = this.r + 34 + Math.abs(dx) * 8;
        const endTarget = this.r + 104 + Math.abs(dx) * 14;
        const sway = Math.sin(this.angle * 1.8) * 6 + dx * 4;

        this.tailVelMid += (midTarget - this.tailMidY) * stiffness;
        this.tailVelMid *= damping;
        this.tailMidY += this.tailVelMid;
        this.tailVelEnd += (endTarget - this.tailEndY) * stiffness;
        this.tailVelEnd *= damping;
        this.tailVelEnd += gravity;
        this.tailEndY += this.tailVelEnd;

        ctx.beginPath();
        ctx.moveTo(0, this.r + 5);
        ctx.bezierCurveTo(
          sway,
          this.tailMidY * 0.5,
          -sway,
          this.tailMidY,
          sway * 0.6,
          this.tailEndY,
        );
        ctx.strokeStyle = "rgba(24,24,27,0.18)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      pop() {
        if (this.popped || prefersReducedMotion) return;
        this.popped = true;

        for (let index = 0; index < 18; index += 1) {
          particles.push(new Particle(this.x, this.y, this.colorSet.base));
        }

        window.setTimeout(() => this.init(false), 900 + Math.random() * 900);
      }

      update() {
        if (this.popped) return;
        this.y -= this.speed;
        this.angle += this.wobbleSpeed;
        this.x += Math.sin(this.angle * 0.6) * 0.65;

        const dx = this.x - mouse.x;
        const dy = this.y - this.r * 0.2 - mouse.y;
        if (Math.sqrt(dx * dx + dy * dy) < this.r + 10) this.pop();
        if (this.y < -this.r - 140) this.init(false);

        this.draw();
      }

      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(Math.sin(this.angle) * 0.06);
        this.drawString();
        this.drawBalloonPath(this.r);

        const gradient = ctx.createRadialGradient(
          -this.r * 0.3,
          -this.r * 0.5,
          this.r * 0.1,
          0,
          0,
          this.r * 1.5,
        );
        gradient.addColorStop(0, this.colorSet.light);
        gradient.addColorStop(0.42, this.colorSet.base);
        gradient.addColorStop(1, this.colorSet.dark);
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.78;
        ctx.fill();
        ctx.restore();
      }
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      balloons = Array.from({ length: balloonCount }, () => new Balloon(true));
    };

    const animate = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles = particles.filter((particle) => particle.opacity > 0);
      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });
      balloons.forEach((balloon) => balloon.update());
      animationFrame = requestAnimationFrame(animate);
    };

    const onMouseMove = (event: MouseEvent) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    };

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);
    resize();
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-white", className)}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
