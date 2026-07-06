import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://api.mainnet-beta.solana.com";
const PUMP_FUN = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const tokens = [
  "EVJ9o4asjzCJkvM77c71HF3payxMsWJpex9GMttupump",
  "sBRr1CwcRYW2cE9WFNEhHRam5TVWq2pb8YgMHAFpump",
  "HQRpHpfTz61hm4CcJenKRB8vozGTA7ztBG72zdq2pump",
  "EmcxFTNVDqyLHp11NvwvLZ4D7LKGbG9i7B8RF7dwpump",
  "7pykXUmT2dWd3pTPT9pjVVN6dgTXzynv5BamHHCypump",
  "8nAmJGuGVdc7KFXXc1NyiUB71K7u2AhXkvxnsAXnpump",
];

const conn = new Connection(RPC, "confirmed");

async function check(mintStr) {
  const mint = new PublicKey(mintStr);
  const [bc] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_FUN
  );
  try {
    const info = await conn.getAccountInfo(bc);
    if (!info) return "GRADUATED";
    const data = info.data;
    const vtr = Number(data.readBigUInt64LE(8));
    const vsr = Number(data.readBigUInt64LE(16));
    const priceSol = vsr / vtr;
    const priceUsd = priceSol * 200;
    return `ACTIVE price=$${priceUsd.toFixed(8)} vSOL=${(vsr/1e9).toFixed(4)}`;
  } catch (e) {
    return `GRADUATED (closed)`;
  }
}

for (const t of tokens) {
  const label = t.slice(0, 12) + "...";
  const r = await check(t);
  console.log(`${label}: ${r}`);
}
