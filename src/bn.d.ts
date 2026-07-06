declare module "bn.js" {
  class BN {
    constructor(value: string | number | Buffer | Uint8Array, base?: number);
    toString(base?: number): string;
    toNumber(): number;
    add(n: BN): BN;
    sub(n: BN): BN;
    mul(n: BN): BN;
    div(n: BN): BN;
    mod(n: BN): BN;
    lt(n: BN): boolean;
    gt(n: BN): boolean;
    lte(n: BN): boolean;
    gte(n: BN): boolean;
    eq(n: BN): boolean;
    isZero(): boolean;
    isNeg(): boolean;
    toArrayLike(T: any, endian?: string): any;
    toBuffer(endian?: string): Buffer;
  }
  export = BN;
}
