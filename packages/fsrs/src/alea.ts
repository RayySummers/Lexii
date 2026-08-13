/**
 * 确定性 PRNG（Alea），仅在 enable_fuzz 时使用。
 *
 * 移植自 seedrandom 的 Alea 实现（https://github.com/davidbau/seedrandom），
 * 与原作一致按 MIT 许可分发：
 *
 * Copyright (C) 2010 by Johannes Baagøe <baagoe@baagoe.org>
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * 必须逐位对齐官方 ts-fsrs 内置的 alea 实现——enable_fuzz 的差分验证
 * 依赖同一 seed 产生完全相同的浮点数序列。
 */

type AleaState = {
  c: number;
  s0: number;
  s1: number;
  s2: number;
};

class Alea {
  private c: number;
  private s0: number;
  private s1: number;
  private s2: number;

  constructor(seed?: number | string) {
    const mash = mashFactory();
    this.c = 1;
    this.s0 = mash(" ");
    this.s1 = mash(" ");
    this.s2 = mash(" ");
    if (seed == null) seed = Date.now();
    this.s0 -= mash(seed);
    if (this.s0 < 0) this.s0 += 1;
    this.s1 -= mash(seed);
    if (this.s1 < 0) this.s1 += 1;
    this.s2 -= mash(seed);
    if (this.s2 < 0) this.s2 += 1;
  }

  next(): number {
    const t = 2091639 * this.s0 + this.c * 2.3283064365386963e-10; // 2^-32
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.c = t | 0;
    this.s2 = t - this.c;
    return this.s2;
  }

  get state(): AleaState {
    return { c: this.c, s0: this.s0, s1: this.s1, s2: this.s2 };
  }

  set state(state: AleaState) {
    this.c = state.c;
    this.s0 = state.s0;
    this.s1 = state.s1;
    this.s2 = state.s2;
  }
}

function mashFactory() {
  let n = 0xefc8249d;
  return function mash(data: string | number): number {
    data = String(data);
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000; // 2^32
    }
    return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
  };
}

export type PRNG = () => number;

/** 以 seed 创建确定性 PRNG */
export function alea(seed?: number | string): PRNG {
  const xg = new Alea(seed);
  return () => xg.next();
}
