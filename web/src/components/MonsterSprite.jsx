/** 個体コードから待機アニメ付きスプライトを描く共通コンポーネント。
 *  ref を渡すと SpriteAnim インスタンス(attack/hit/die/happy)を公開する。 */
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { genSprite, spritePalette } from "@monster-game/core";
import { SpriteAnim } from "@monster-game/core/render";

export const MonsterSprite = forwardRef(function MonsterSprite({ code, size = 96, facing = 1 }, ref) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  useEffect(() => {
    if (!code || !canvasRef.current) return;
    const anim = new SpriteAnim(canvasRef.current, genSprite(code), spritePalette(code), facing);
    animRef.current = anim;
    let raf;
    const loop = (t) => { anim.frame(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [code, facing]);
  useImperativeHandle(ref, () => ({
    attack: () => animRef.current?.attack(),
    hit: () => animRef.current?.hit(),
    die: () => animRef.current?.die(),
    happy: () => animRef.current?.happy(),
  }), []);
  return <canvas ref={canvasRef} width={size} height={size} style={{ width: size, height: size, borderRadius: 8 }} />;
});
