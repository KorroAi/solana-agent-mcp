import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://mainnet.helius-rpc.com/?api-key=4b439bb8-4a98-41db-9cf2-7054ed6f7dca";
const PUMP_FUN = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const tokens = [
  { mint: "DfcYAWqa8iVY8fq59fdehXVeMMu6cE8xRDX6JCGBpump", id: "#4", entry: 0.00000100, exit: 0.00003662 },
  { mint: "CrbdFYHReUsUG9VZjoTXYHYW7DtorbConQmwFBU3pump", id: "#2", entry: 0.00000100, exit: 0.00000839 },
  { mint: "4hgzvvPbBxagKwpqWTfZK95BbP8oE1LVco5DeHbZpump", id: "#1", entry: 0.00001123, exit: 0.00001917 },
  { mint: "H9thyFKhczdDvceCkaBLo2ypkFGQLBQoxpiiqyHUpump", id: "#3", entry: 0.00001223, exit: 0.00001187 },
  { mint: "3wZgPG5LSWj1Eu3sypvAaK452eGQuKqDSR6EPt3apump", id: "#6", entry: 0.00001325, exit: 0.00000936 },
  { mint: "DRSQ1pmQuTpB6gHvzhrPMjuzpYmwk3B3C4XDT4Npump", id: "#5", entry: 0.00000824, exit: 0.00000869 },
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
    const pnlIfSoldNow = t.entry ? ((r.priceUsd - t.entry) / t.entry * 100).toFixed(1) : 'N/A';
    console.log(`${t.id} ${t.mint.slice(0,12)}... ACTIVE price=$${r.priceUsd.toFixed(8)} | entry=$${t.entry?.toFixed(8)||'N/A'} realPnL=${pnlIfSoldNow}% | vSOL=${(r.vSol/1e9).toFixed(4)} rSOL=${(r.rSol/1e9).toFixed(4)}`);
  } else {
    console.log(`${t.id} ${t.mint.slice(0,12)}... GRADUATED | entry=$${(t.entry||0).toFixed(8)} exit=$${(t.exit||0).toFixed(8)}`);
  }
}
