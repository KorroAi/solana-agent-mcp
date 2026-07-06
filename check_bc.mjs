import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://mainnet.helius-rpc.com/?api-key=4b439bb8-4a98-41db-9cf2-7054ed6f7dca";
const PUMP_FUN = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const tokens = [
  { mint: "DfcYAWqa8iVY8fq2yVP4s1hu7MNmRRx2kDzSpF5npump", id: "#4" },
  { mint: "CrbdFYHReUsUG9VR2EVfTMoz3XQpYpSKB3Ama4vnpump", id: "#2" },
  { mint: "4hgzvvPbBxagKwpKNi4R2EBGDsLvB7nyLxPE5YKpump", id: "#1" },
  { mint: "H9thyFKhczdDvceCkaBLo2ypkFGQLBQoxpiiqyHUpump", id: "#3" },
  { mint: "3wZgPG5LSWj1Eu3sqmBXqEDn9xJLa5BZyr1bv9QPpump", id: "#6" },
  { mint: "DRSQ1pmQuTpB6gHQFYLz7Cmyk36j8j9aAFdf7gsHpump", id: "#5" },
];

const conn = new Connection(RPC, "confirmed");

async function getBC(mintStr) {
  const mint = new PublicKey(mintStr);
  const [bc] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_FUN
  );
  try {
    const info = await conn.getAccountInfo(bc);
    if (!info) return { exists: false };
    const data = info.data;
    const vtr = Number(data.readBigUInt64LE(8));
    const vsr = Number(data.readBigUInt64LE(16));
    const rtr = Number(data.readBigUInt64LE(24));
    const rsr = Number(data.readBigUInt64LE(32));
    const priceSol = vsr / vtr;
    const priceUsd = priceSol * 200;
    return { exists: true, vSol: vsr, vTok: vtr, rSol: rsr, rTok: rtr, priceUsd, priceSol };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

for (const t of tokens) {
  const r = await getBC(t.mint);
  if (r.exists) {
    console.log(`${t.id} ${t.mint.slice(0,12)}... price=$${r.priceUsd.toFixed(8)} (${r.priceSol.toFixed(12)} SOL) vSOL=${(r.vSol/1e9).toFixed(4)} vTOK=${(r.vTok/1e6).toFixed(0)} rSOL=${(r.rSol/1e9).toFixed(4)}`);
  } else {
    console.log(`${t.id} ${t.mint.slice(0,12)}... BONDING_CURVE_CLOSED`);
  }
}
