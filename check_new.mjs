import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://mainnet.helius-rpc.com/?api-key=4b439bb8-4a98-41db-9cf2-7054ed6f7dca";
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

async function check(mintStr, label) {
  const mint = new PublicKey(mintStr);
  const [bc] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_FUN
  );
  try {
    const info = await conn.getAccountInfo(bc);
    if (!info) return `${label}: GRADUATED`;
    const data = info.data;
    const vtr = Number(data.readBigUInt64LE(8));
    const vsr = Number(data.readBigUInt64LE(16));
    const priceSol = vsr / vtr;
    const priceUsd = priceSol * 200;
    return `${label}: ACTIVE price=$${priceUsd.toFixed(8)} vSOL=${(vsr/1e9).toFixed(4)}`;
  } catch (e) {
    return `${label}: ERROR ${e.message}`;
  }
}

for (let i = 0; i < tokens.length; i++) {
  const t = tokens[i];
  const label = t.slice(0, 12) + "...";
  console.log(await check(t, label));
}
